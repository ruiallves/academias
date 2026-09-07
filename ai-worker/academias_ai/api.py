"""O cliente HTTP do worker — a única forma de falar com o Academias.

O worker não tem credenciais da base nem do Storage: pede tudo à API com o
token de worker, e o que recebe são links assinados com prazo. É o que permite
mover este processo para uma GPU na cloud sem tocar em mais nada.
"""

from __future__ import annotations

import gzip
import json
import tempfile
import time
from pathlib import Path
from typing import Any

import requests

from . import config

_session = requests.Session()


class JobGone(Exception):
    """O job já não existe do lado da API — apagado, cancelado ou já concluído.

    É diferente de uma falha de rede, e o worker trata-o ao contrário: numa
    falha de rede insiste-se, aqui pára-se já. Uma análise apagada a meio do
    processamento deixava o worker a moer uma hora e meia de vídeo para um
    destino que não existe — e a fila parada atrás dele, porque um worker faz
    um job de cada vez.
    """

# Quantas vezes se repete um pedido que falhou por rede, e o recuo entre elas.
#
# Isto custou duas horas de trabalho para se aprender. O worker acabou uma
# análise de 111 minutos, começou a arrumar, e **um** pedido à API demorou mais
# de 60 segundos: `ReadTimeout`, o job falhou, a fila repô-lo, e a detecção
# recomeçou do princípio. Um pedido perdido não pode custar uma tarde de GPU.
#
# Três tentativas com recuo de 2, 4 e 8 segundos cobrem o que estas falhas são
# quase sempre — a API ocupada num pico, um soluço na rede. O que não passa em
# três tentativas é uma avaria a sério, e essa tem de subir.
TENTATIVAS = 3
RECUO_BASE = 2.0


def _headers() -> dict[str, str]:
    return {"x-ai-worker-token": config.TOKEN}


def _com_repeticao(descricao: str, fazer):
    """Repete um pedido de rede antes de desistir dele.

    Só repete o que faz sentido repetir: tempos esgotados, ligações caídas e
    erros 5xx do servidor. Um 4xx é o servidor a dizer que o pedido está errado
    — repeti-lo dá o mesmo erro três vezes e atrasa a resposta a quem espera.
    """
    ultimo: Exception | None = None
    for tentativa in range(1, TENTATIVAS + 1):
        try:
            return fazer()
        except (requests.Timeout, requests.ConnectionError) as erro:
            ultimo = erro
        except requests.HTTPError as erro:
            if erro.response is None or erro.response.status_code < 500:
                raise
            ultimo = erro
        if tentativa < TENTATIVAS:
            espera = RECUO_BASE * (2 ** (tentativa - 1))
            print(f"[api] {descricao} falhou ({type(ultimo).__name__}); repito em {espera:.0f}s "
                  f"({tentativa}/{TENTATIVAS - 1})")
            time.sleep(espera)
    raise ultimo  # type: ignore[misc]


def _post(path: str, body: dict[str, Any], timeout: int = 60) -> Any:
    def fazer():
        res = _session.post(f"{config.API_URL}{path}", json=body, headers=_headers(), timeout=timeout)
        res.raise_for_status()
        return res.json() if res.text else None

    return _com_repeticao(f"POST {path}", fazer)


def claim(kinds: list[str]) -> dict[str, Any] | None:
    """Pede o trabalho mais antigo que este worker saiba fazer. `None` = fila vazia."""
    return _post("/api/ai/worker/claim", {"worker": config.WORKER_NAME, "kinds": kinds})


def heartbeat(job_id: str, progress: int | None = None) -> None:
    """Diz que ainda cá está — e ouve a resposta.

    O 404 é a única forma que a API tem de dizer "esse job desapareceu": não há
    canal do servidor para o worker, e inventar um (websocket, fila de comandos)
    para uma mensagem que já cabe aqui era construir infra-estrutura a mais. O
    heartbeat já bate de cinco em cinco segundos; é o sítio certo para ouvir.
    """
    body: dict[str, Any] = {"worker": config.WORKER_NAME}
    if progress is not None:
        body["progress"] = max(0, min(100, int(progress)))
    try:
        _post(f"/api/ai/worker/jobs/{job_id}/heartbeat", body)
    except requests.HTTPError as error:
        if error.response is not None and error.response.status_code == 404:
            raise JobGone(job_id) from error
        raise


LOTE_TRACKS = 400


def send_tracks(job_id: str, tracks: list[dict[str, Any]]) -> None:
    """Os tracks, em lotes, antes do `complete`.

    Iam dentro do `complete`, e o corpo desse pedido passou a depender do jogo:
    um jogo filmado de longe produz milhares de tracks e o JSON passou os 16 MB
    que a API aceita. **413**, job dado por falhado, duas horas de deteccao
    deitadas fora depois de estarem feitas. Aconteceu.

    Em lotes o tamanho de cada pedido e uma constante nossa. O primeiro leva
    `reset`, que substitui os automaticos e preserva os corrigidos — o que o
    `complete` fazia.
    """
    for i in range(0, max(1, len(tracks)), LOTE_TRACKS):
        _post(
            f"/api/ai/worker/jobs/{job_id}/tracks",
            {"tracks": tracks[i : i + LOTE_TRACKS], "reset": i == 0},
        )


def complete(job_id: str, result: dict[str, Any], model_versions: dict[str, str] | None = None) -> None:
    # Os tracks seguem à parte; o `complete` fica com o resumo, que é pequeno e
    # não cresce com o jogo.
    tracks = result.get("tracks")
    if isinstance(tracks, list):
        send_tracks(job_id, tracks)
        result = {**result, "tracks": [], "trackCount": len(tracks)}

    body: dict[str, Any] = {"result": result}
    if model_versions:
        body["modelVersions"] = model_versions
    _post(f"/api/ai/worker/jobs/{job_id}/complete", body)


def fail(job_id: str, error: str) -> None:
    _post(f"/api/ai/worker/jobs/{job_id}/fail", {"error": error[:2000]})


def register_model(task: str, name: str, version: str, license_: str, source: str | None = None) -> None:
    """Anuncia um modelo antes de o usar — proveniência e licença ficam na base."""
    _post(
        "/api/ai/worker/models",
        {"task": task, "name": name, "version": version, "license": license_, **({"source": source} if source else {})},
    )


def upload_bytes(job_id: str, rel_path: str, data: bytes, content_type: str) -> str:
    """Guarda um derivado no Storage da análise — bytes, seja o que forem.

    Devolve a chave do objecto. O caminho é relativo à pasta `derived/` da
    análise; a API recusa qualquer tentativa de sair dela. É o caminho comum a
    tudo o que o worker produz: JSON comprimido, folhas de recortes, e o que
    vier — um só sítio a saber pedir o URL e a repetir quando a rede falha.
    """

    def enviar():
        # O URL assinado pede-se **dentro** da repetição: se a subida falhar por
        # ele ter caducado, tentar outra vez com o mesmo não resolve nada.
        signed = _post(f"/api/ai/worker/jobs/{job_id}/upload-url", {"path": rel_path, "contentType": content_type})
        res = _session.put(signed["url"], data=data, headers={"Content-Type": content_type}, timeout=600)
        res.raise_for_status()
        return signed["key"]

    return _com_repeticao(f"subir {rel_path} ({len(data) / 1048576:.1f} MB)", enviar)


def upload_json_gz(job_id: str, rel_path: str, payload: Any) -> str:
    """Um JSON comprimido — posições, índices, embeddings. Ver `upload_bytes`."""
    data = gzip.compress(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    return upload_bytes(job_id, rel_path, data, "application/gzip")


def video_received(
    video_id: str,
    *,
    size_bytes: int,
    duration_sec: int | None,
    width: int | None,
    height: int | None,
    fps: float | None,
) -> Any:
    """O vídeo chegou inteiro a este worker — é o que põe a análise na fila."""
    body: dict[str, Any] = {"worker": config.WORKER_NAME, "sizeBytes": int(size_bytes)}
    if duration_sec is not None:
        body["durationSec"] = int(duration_sec)
    if width:
        body["width"] = int(width)
    if height:
        body["height"] = int(height)
    if fps:
        body["fps"] = float(fps)
    return _post(f"/api/ai/worker/videos/{video_id}/received", body)


def download_derived(job_id: str, rel_path: str) -> bytes | None:
    """Lê um derivado da análise — recortes, índices, embeddings.

    O espelho de `upload_bytes`: pede-se um link de leitura à API (preso à
    pasta `derived/` desta análise, como o de escrita) e descarrega-se. `None`
    quando o ficheiro não existe — a etapa que o produzia não correu, ou a
    análise é anterior a ela. Quem chama decide se isso é erro.
    """

    def buscar():
        signed = _post(f"/api/ai/worker/jobs/{job_id}/download-url", {"path": rel_path})
        if not signed or not signed.get("url"):
            return None
        res = _session.get(signed["url"], timeout=600)
        if res.status_code in (400, 404):
            return None
        res.raise_for_status()
        return res.content

    return _com_repeticao(f"ler {rel_path}", buscar)


def download_video(url: str, suffix: str = ".mp4") -> Path:
    """Descarrega o vídeo do link assinado para um ficheiro temporário, em stream.

    Quem chama é responsável por apagar o ficheiro no fim — um jogo são
    gigabytes, e um worker que não limpa enche o disco em duas semanas.
    """
    handle = tempfile.NamedTemporaryFile(prefix="academias-ai-", suffix=suffix, delete=False)
    path = Path(handle.name)
    try:
        with _session.get(url, stream=True, timeout=600) as res:
            res.raise_for_status()
            for chunk in res.iter_content(chunk_size=1 << 20):
                handle.write(chunk)
    finally:
        handle.close()
    return path
