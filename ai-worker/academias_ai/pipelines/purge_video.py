"""purge_video — apagar o ficheiro do vídeo deste worker.

A API pede-o depois de o processamento acabar (ou falhar de vez). O que fica
são os dados; o vídeo — imagem de menores, gigabytes — não tem razão para ficar.
Não é uma etapa de análise: não lê o vídeo, não tem modelos, e o resultado é
só "apaguei".
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .. import ingest

MODELS: list[dict[str, str]] = []


def run(job: dict[str, Any], video_path: Path, progress: Callable[[int], None]) -> dict[str, Any]:
    video_id = job.get("video", {}).get("id") or job.get("params", {}).get("videoId")
    if not video_id:
        raise RuntimeError("purge_video sem id de vídeo")
    removed = ingest.purge(video_id)
    progress(100)
    return {"purged": removed, "videoId": video_id}
