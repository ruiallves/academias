"""O ciclo do worker: perguntar, trabalhar, responder, repetir.

    claim → download do vídeo → pipeline (com heartbeats) → complete/fail

Um processo, um job de cada vez — de propósito. A GPU não ganha nada em fazer
dois vídeos ao mesmo tempo, e um worker simples é um worker que se percebe às
três da manhã. Paralelismo a sério faz-se com mais processos, aqui ou na
cloud: a fila trata do resto.
"""

from __future__ import annotations

import sys
import time
import traceback
from typing import Any

import requests

from . import api, config, pipelines


def main() -> None:
    config.validate()

    kinds = pipelines.available()
    print(f"Academias AI worker '{config.WORKER_NAME}' — etapas: {', '.join(kinds)}")
    if "detect_track" not in kinds:
        print("  (sem torch/torchvision/supervision — só qualidade de vídeo; ver README)")

    # A proveniência primeiro: que modelos, que versões, que licenças.
    for model in pipelines.model_manifest(kinds):
        try:
            api.register_model(model["task"], model["name"], model["version"], model["license"], model.get("source"))
        except requests.RequestException as error:
            print(f"Não foi possível registar modelos na API: {error}", file=sys.stderr)
            raise SystemExit(1) from error

    while True:
        try:
            job = api.claim(list(kinds))
        except requests.RequestException as error:
            print(f"API indisponível ({error}) — volto a tentar em 15 s", file=sys.stderr)
            time.sleep(15)
            continue

        if not job:
            time.sleep(config.POLL_SECONDS)
            continue

        _work(job, kinds[job["kind"]])


def _work(job: dict[str, Any], pipeline: Any) -> None:
    job_id = job["id"]
    title = job.get("analysis", {}).get("title", "?")
    print(f"[{job_id}] {job['kind']} — «{title}» (tentativa {job.get('attempt', 1)})")

    last_beat = 0.0

    def progress(value: int) -> None:
        # Heartbeats com tecto de cadência: a API não precisa de saber cada frame.
        nonlocal last_beat
        now = time.monotonic()
        if now - last_beat >= 5:
            last_beat = now
            try:
                api.heartbeat(job_id, value)
            except requests.RequestException:
                pass  # um heartbeat perdido não é razão para parar o trabalho

    video_path = None
    try:
        api.heartbeat(job_id, 0)
        video_path = api.download_video(job["video"]["url"], suffix=_suffix(job["video"].get("mimeType", "")))
        result = pipeline.run(job, video_path, progress)
        api.complete(job_id, result, _versions(pipeline))
        print(f"[{job_id}] concluído")
    except Exception as error:  # noqa: BLE001 — a fronteira do job reporta tudo
        traceback.print_exc()
        try:
            api.fail(job_id, f"{type(error).__name__}: {error}")
        except requests.RequestException:
            print(f"[{job_id}] não consegui reportar a falha — a API repõe o job por heartbeat", file=sys.stderr)
    finally:
        if video_path is not None:
            video_path.unlink(missing_ok=True)


def _suffix(mime: str) -> str:
    return {"video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm", "video/x-matroska": ".mkv"}.get(mime, ".mp4")


def _versions(pipeline: Any) -> dict[str, str]:
    return {m["task"]: f"{m['name']}@{m['version']}" for m in getattr(pipeline, "MODELS", [])}


if __name__ == "__main__":
    main()
