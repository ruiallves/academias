"""O registo das etapas do pipeline.

Cada módulo expõe `run(job, video_path, progress) -> dict` e diz de si próprio
se as dependências estão instaladas. O worker anuncia à API só o que sabe
fazer — um job de tracking numa máquina sem torch fica na fila para quem o
souber, em vez de falhar ou de se fingir feito.
"""

from __future__ import annotations

from typing import Any, Callable, Protocol


class Pipeline(Protocol):
    def run(self, job: dict[str, Any], video_path: Any, progress: Callable[[int], None]) -> dict[str, Any]: ...


def available() -> dict[str, Any]:
    """kind → módulo, só com as dependências satisfeitas."""
    from . import quality

    kinds: dict[str, Any] = {"quality_check": quality}

    try:
        from . import detect_track

        if detect_track.dependencies_ok():
            kinds["detect_track"] = detect_track
    except Exception:
        pass

    return kinds


def model_manifest(kinds: dict[str, Any]) -> list[dict[str, str]]:
    """Os modelos que estas etapas usam — para registar proveniência na base."""
    manifest: list[dict[str, str]] = []
    for module in kinds.values():
        manifest.extend(getattr(module, "MODELS", []))
    return manifest
