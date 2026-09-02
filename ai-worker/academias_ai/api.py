"""O cliente HTTP do worker — a única forma de falar com o Academias.

O worker não tem credenciais da base nem do Storage: pede tudo à API com o
token de worker, e o que recebe são links assinados com prazo. É o que permite
mover este processo para uma GPU na cloud sem tocar em mais nada.
"""

from __future__ import annotations

import gzip
import json
import tempfile
from pathlib import Path
from typing import Any

import requests

from . import config

_session = requests.Session()


def _headers() -> dict[str, str]:
    return {"x-ai-worker-token": config.TOKEN}


def _post(path: str, body: dict[str, Any]) -> Any:
    res = _session.post(f"{config.API_URL}{path}", json=body, headers=_headers(), timeout=60)
    res.raise_for_status()
    return res.json() if res.text else None


def claim(kinds: list[str]) -> dict[str, Any] | None:
    """Pede o trabalho mais antigo que este worker saiba fazer. `None` = fila vazia."""
    return _post("/api/ai/worker/claim", {"worker": config.WORKER_NAME, "kinds": kinds})


def heartbeat(job_id: str, progress: int | None = None) -> None:
    body: dict[str, Any] = {}
    if progress is not None:
        body["progress"] = max(0, min(100, int(progress)))
    _post(f"/api/ai/worker/jobs/{job_id}/heartbeat", body)


def complete(job_id: str, result: dict[str, Any], model_versions: dict[str, str] | None = None) -> None:
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


def upload_json_gz(job_id: str, rel_path: str, payload: Any) -> str:
    """Guarda um derivado (ex.: posições de um track) no Storage da análise.

    Devolve a chave do objecto — é o que se escreve em `dataKey`. O caminho é
    relativo à pasta `derived/` da análise; a API recusa qualquer tentativa de
    sair dela.
    """
    signed = _post(f"/api/ai/worker/jobs/{job_id}/upload-url", {"path": rel_path, "contentType": "application/gzip"})
    data = gzip.compress(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    res = _session.put(signed["url"], data=data, headers={"Content-Type": "application/gzip"}, timeout=300)
    res.raise_for_status()
    return signed["key"]


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
