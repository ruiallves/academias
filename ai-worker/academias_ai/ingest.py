"""A porta por onde o vídeo entra — directamente do browser para este disco.

## Porque é que o worker recebe o vídeo

Um jogo são gigabytes de imagem de menores. Guardá-los num bucket do Supabase
só para o worker os ir buscar era pagar armazenamento por uma cópia que
ninguém volta a ler — e o plano gratuito nem os aceita (50 MB por ficheiro).
O único processo que precisa dos pixels é este. Por isso é este que os recebe:
o browser envia o ficheiro em blocos para aqui, o ficheiro vive nesta pasta
enquanto se processa, e apaga-se no fim. No Supabase ficam os derivados —
tracks de uns megabytes.

## Como é que se confia no browser

Não se confia. O que se verifica é o **bilhete** que a API lhe deu (ver
`ai-ticket.ts` do lado da API): um HMAC com o mesmo `AI_WORKER_TOKEN` que já
autentica este worker, a dizer que vídeo, que tamanho, que tipo, e até quando.
Sem bilhete válido, 401. Com bilhete, aceita-se exactamente o tamanho
anunciado — nem um byte a mais.

## O protocolo — pequeno de propósito

    POST /ingest/{bilhete}            abre (ou reabre) o ficheiro → {received}
    GET  /ingest/{bilhete}            quantos bytes já cá estão → {received}
    PUT  /ingest/{bilhete}?offset=N   um bloco, a partir de N → {received}
    POST /ingest/{bilhete}/complete   verifica, mede, avisa a API → {ok}

E uma quinta, que não é do browser mas da API:

    DELETE /video/{videoId}           apaga já — com o token do worker

Cada bloco é uma escrita a partir de um offset que tem de ser exactamente o
que já cá está: um bloco fora de sítio dá 409 com o `received` certo, e o
browser continua daí. É isto que torna o carregamento retomável — uma ligação
que cai aos 90 % de um jogo de duas horas continua dos 90 %, não do zero. Sem
TUS nem biblioteca: são quatro verbos, e os dois lados são nossos.

## Limpeza

O ficheiro apaga-se por três caminhos, e é de propósito que sejam três:

1. **Depois de processar** — a API enfileira `purge_video` e o worker apaga.
2. **Quando alguém apaga a análise** — a API bate aqui directamente
   (`DELETE /video/{videoId}`, com o token do worker). Pela fila não dava: a
   análise desaparece, e um job dela desaparece com ela. Apagar dados tem de
   apagar mesmo, e não daqui a três dias.
3. **O zelador** — o que tiver mais de `AI_WORKER_SPOOL_TTL_HOURS` vai abaixo,
   aconteça o que acontecer. É a rede por baixo das outras duas: um
   carregamento abandonado a meio não pertence a nenhuma delas.

Um worker que não limpa enche o disco em duas semanas.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import shutil
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import requests

from . import api, config
from . import video as videolib

# Um bloco maior do que isto é recusado: o browser manda 8 MB, e um pedido de
# um gigabyte de uma vez é alguém a testar o disco, não a consola.
MAX_CHUNK = 64 * 1024 * 1024

SUFFIX = {"video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-matroska": ".mkv"}

_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(video_id: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(video_id, threading.Lock())


# ---------------------------------------------------------------------------
# O bilhete
# ---------------------------------------------------------------------------


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def verify_ticket(token: str) -> dict[str, Any] | None:
    """O mesmo formato de `issueTicket`: `base64url(JSON).base64url(HMAC-SHA256)`."""
    try:
        payload, sig = token.split(".", 1)
    except ValueError:
        return None
    expected = base64.urlsafe_b64encode(
        hmac.new(config.TOKEN.encode("utf-8"), payload.encode("ascii"), hashlib.sha256).digest()
    ).rstrip(b"=").decode("ascii")
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        data = json.loads(_b64url_decode(payload))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("v"), str) or not isinstance(data.get("e"), (int, float)):
        return None
    if data["e"] < time.time():
        return None
    return data


# ---------------------------------------------------------------------------
# O ficheiro
# ---------------------------------------------------------------------------


def spool_path(video_id: str, mime: str) -> Path:
    """Onde o vídeo `video_id` vive neste worker — o mesmo caminho para quem recebe e para quem processa."""
    return config.SPOOL / f"{video_id}{SUFFIX.get(mime, '.mp4')}"


def _received(path: Path) -> int:
    return path.stat().st_size if path.exists() else 0


def purge(video_id: str, mime: str | None = None) -> bool:
    """Apaga o ficheiro deste vídeo, seja qual for a extensão. True se havia algo."""
    removed = False
    for candidate in config.SPOOL.glob(f"{video_id}.*"):
        candidate.unlink(missing_ok=True)
        removed = True
    return removed


def janitor(ttl_hours: float) -> None:
    """Apaga o que já ninguém quer: ficheiros mais velhos do que o prazo."""
    if ttl_hours <= 0:
        return
    limit = time.time() - ttl_hours * 3600
    for f in config.SPOOL.iterdir():
        try:
            if f.is_file() and f.stat().st_mtime < limit:
                f.unlink()
                print(f"[spool] apagado por idade: {f.name}")
        except OSError:
            pass


# ---------------------------------------------------------------------------
# O servidor
# ---------------------------------------------------------------------------


class _Handler(BaseHTTPRequestHandler):
    server_version = "AcademiasAI-ingest/1"

    # O log do servidor de HTTP é ruído a cada bloco; o que interessa diz-se à mão.
    def log_message(self, format: str, *args: Any) -> None:  # noqa: A002
        return

    # --- respostas ------------------------------------------------------------

    def _cors(self) -> None:
        # Sem cookies, sem sessão: a autorização é o bilhete. Qualquer origem
        # pode tentar; sem bilhete válido leva 401 antes de custar um byte.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")

    def _json(self, status: int, body: dict[str, Any]) -> None:
        data = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _drain(self) -> None:
        """Lê e deita fora o corpo — um erro a meio de um PUT não pode deixar a ligação a meio."""
        length = int(self.headers.get("Content-Length") or 0)
        while length > 0:
            chunk = self.rfile.read(min(length, 1 << 20))
            if not chunk:
                break
            length -= len(chunk)

    # --- rotas ----------------------------------------------------------------

    def _route(self) -> tuple[str, str | None, str | None, dict[str, list[str]]]:
        parts = urlsplit(self.path)
        segs = [s for s in parts.path.split("/") if s]
        query = parse_qs(parts.query)
        if len(segs) >= 2 and segs[0] == "ingest":
            return "ingest", segs[1], (segs[2] if len(segs) > 2 else None), query
        if segs == ["health"]:
            return "health", None, None, query
        return "?", None, None, query

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_DELETE(self) -> None:  # noqa: N802
        """Apagar já um vídeo — a API a dizer que a análise dele deixou de existir.

        Autentica-se com o token do worker, e não com um bilhete: quem pede não
        é o browser, é a API, que não tem bilhete nenhum (nem faria sentido —
        um bilhete autoriza *carregar*, isto é o contrário).
        """
        self._drain()
        parts = urlsplit(self.path)
        segs = [s for s in parts.path.split("/") if s]
        if len(segs) != 2 or segs[0] != "video":
            return self._json(404, {"error": "não há nada aqui"})

        dado = (self.headers.get("x-ai-worker-token") or "").strip()
        if not config.TOKEN or not hmac.compare_digest(dado, config.TOKEN):
            return self._json(401, {"error": "token de worker inválido"})

        apagado = purge(segs[1])
        print(f"[ingest] apagado a pedido da API: {segs[1]} ({'havia ficheiro' if apagado else 'já não havia'})")
        return self._json(200, {"ok": True, "purged": apagado})

    def do_GET(self) -> None:  # noqa: N802
        kind, token, action, _ = self._route()
        if kind == "health":
            free = shutil.disk_usage(config.SPOOL).free
            return self._json(200, {"ok": True, "worker": config.WORKER_NAME, "spoolFreeBytes": free})
        if kind != "ingest" or action is not None:
            return self._json(404, {"error": "não há nada aqui"})
        ticket = verify_ticket(token or "")
        if not ticket:
            return self._json(401, {"error": "bilhete inválido ou caducado"})
        return self._json(200, {"received": _received(spool_path(ticket["v"], ticket.get("m", "")))})

    def do_POST(self) -> None:  # noqa: N802
        kind, token, action, _ = self._route()
        self._drain()
        if kind != "ingest":
            return self._json(404, {"error": "não há nada aqui"})
        ticket = verify_ticket(token or "")
        if not ticket:
            return self._json(401, {"error": "bilhete inválido ou caducado"})

        path = spool_path(ticket["v"], ticket.get("m", ""))

        if action is None:
            # Abrir. Se já cá está uma parte (retoma depois de fechar o separador),
            # diz-se quanto — o browser continua daí.
            config.SPOOL.mkdir(parents=True, exist_ok=True)
            free = shutil.disk_usage(config.SPOOL).free
            expected = int(ticket.get("s") or 0)
            if expected and free < expected - _received(path) + (256 << 20):
                return self._json(507, {"error": f"sem espaço em disco no worker para {expected} bytes"})
            if not path.exists():
                path.touch()
            return self._json(200, {"received": _received(path), "chunkSize": 8 * 1024 * 1024})

        if action == "complete":
            return self._complete(ticket, path)

        return self._json(404, {"error": "acção desconhecida"})

    def do_PUT(self) -> None:  # noqa: N802
        kind, token, action, query = self._route()
        if kind != "ingest" or action is not None:
            self._drain()
            return self._json(404, {"error": "não há nada aqui"})
        ticket = verify_ticket(token or "")
        if not ticket:
            self._drain()
            return self._json(401, {"error": "bilhete inválido ou caducado"})

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_CHUNK:
            self._drain()
            return self._json(413, {"error": f"bloco tem de ter entre 1 byte e {MAX_CHUNK} bytes"})

        try:
            offset = int(query.get("offset", ["-1"])[0])
        except ValueError:
            offset = -1

        path = spool_path(ticket["v"], ticket.get("m", ""))
        expected = int(ticket.get("s") or 0)

        with _lock_for(ticket["v"]):
            received = _received(path)
            if offset != received:
                # Fora de sítio: diz-se onde estamos, e o browser realinha-se.
                self._drain()
                return self._json(409, {"received": received})
            if expected and received + length > expected:
                self._drain()
                return self._json(413, {"error": "mais bytes do que o bilhete anuncia", "received": received})

            with path.open("ab") as fh:
                remaining = length
                while remaining > 0:
                    chunk = self.rfile.read(min(remaining, 1 << 20))
                    if not chunk:
                        break
                    fh.write(chunk)
                    remaining -= len(chunk)
            received = _received(path)

        return self._json(200, {"received": received})

    # --- fechar ---------------------------------------------------------------

    def _complete(self, ticket: dict[str, Any], path: Path) -> None:
        expected = int(ticket.get("s") or 0)
        received = _received(path)
        if received == 0 or (expected and received != expected):
            return self._json(409, {"error": "o ficheiro ainda não está inteiro", "received": received, "expected": expected})

        # Medir antes de avisar: a API guarda a duração e a resolução já aqui,
        # e um ficheiro que o ffprobe não lê nem chega a entrar na fila.
        try:
            meta = videolib.probe(path)
        except Exception as error:  # noqa: BLE001
            return self._json(422, {"error": f"não foi possível ler o vídeo: {error}"})
        # Sem largura e altura não é vídeo — o OpenCV, sem ffprobe, inventa uma
        # cadência para bytes ao acaso, mas dimensões não inventa.
        if meta.width <= 0 or meta.height <= 0 or (meta.duration_sec <= 0 and meta.frame_count <= 0):
            return self._json(422, {"error": "o ficheiro não parece ser um vídeo legível"})

        try:
            api.video_received(
                ticket["v"],
                size_bytes=received,
                duration_sec=int(meta.duration_sec) if meta.duration_sec else None,
                width=meta.width or None,
                height=meta.height or None,
                fps=round(meta.fps, 3) if meta.fps else None,
            )
        except requests.RequestException as error:
            print(f"[ingest] a API recusou a recepção de {ticket['v']}: {error}", file=sys.stderr)
            return self._json(502, {"error": "a API não confirmou a recepção — tenta outra vez"})

        print(f"[ingest] recebido {ticket['v']} — {received / 1048576:.0f} MB, {meta.duration_sec / 60:.0f} min")
        return self._json(200, {"ok": True, "received": received, "durationSec": meta.duration_sec})


class _Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start() -> None:
    """Arranca o servidor numa thread própria e o zelador noutra. Não bloqueia."""
    if config.INGEST_PORT <= 0:
        print("[ingest] desligado (AI_WORKER_INGEST_PORT=0) — só o caminho pelo Storage")
        return

    config.SPOOL.mkdir(parents=True, exist_ok=True)
    server = _Server(("0.0.0.0", config.INGEST_PORT), _Handler)
    threading.Thread(target=server.serve_forever, name="ingest", daemon=True).start()
    print(f"[ingest] a receber vídeo em http://0.0.0.0:{config.INGEST_PORT}/ingest — pasta {config.SPOOL}")

    def _sweep() -> None:
        while True:
            janitor(config.SPOOL_TTL_HOURS)
            time.sleep(3600)

    threading.Thread(target=_sweep, name="spool-janitor", daemon=True).start()
