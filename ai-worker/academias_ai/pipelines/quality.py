"""quality_check — a primeira etapa, e a que decide se vale a pena continuar.

Mede o que se consegue medir sem modelos pesados: resolução, FPS, nitidez,
luz, contraste, estabilidade da câmara e visibilidade do terreno. Do lado do
produto isto vira o painel "Qualidade do vídeo" e trava (com aviso, não em
silêncio) o processamento de matéria-prima má.

## Nunca fingir precisão

Cada dimensão devolve a medição **e** a viabilidade prevista (0–1). Um vídeo
escuro não "falha": diz-se escuro, a viabilidade do tracking desce, e o
treinador decide com números à frente. As notas são frases para humanos.
"""

from __future__ import annotations

import cv2
import numpy as np

from typing import Any, Callable
from pathlib import Path

from .. import video as videolib

MODELS = [
    {"task": "quality", "name": "opencv-metrics", "version": cv2.__version__, "license": "Apache-2.0",
     "source": "https://opencv.org"},
]

SAMPLES = 24


def run(job: dict[str, Any], video_path: Path, progress: Callable[[int], None]) -> dict[str, Any]:
    meta = videolib.probe(video_path)
    progress(10)

    samples = videolib.sample_frames(video_path, SAMPLES)
    if not samples:
        raise RuntimeError("Não foi possível ler frames do vídeo — o ficheiro pode estar corrompido")
    progress(40)

    sharpness: list[float] = []
    brightness: list[float] = []
    contrast: list[float] = []
    clipped: list[float] = []
    field_cover: list[float] = []
    motion: list[float] = []

    for i, (frame, follow) in enumerate(samples):
        small = _shrink(frame, 640)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

        sharpness.append(float(cv2.Laplacian(gray, cv2.CV_64F).var()))
        brightness.append(float(gray.mean()))
        contrast.append(float(gray.std()))
        clipped.append(float(((gray < 8).mean() + (gray > 247).mean())))
        field_cover.append(_field_coverage(small))

        if follow is not None:
            motion.append(_camera_motion(gray, cv2.cvtColor(_shrink(follow, 640), cv2.COLOR_BGR2GRAY)))

        progress(40 + int(50 * (i + 1) / len(samples)))

    metrics = {
        "width": meta.width,
        "height": meta.height,
        "fps": round(meta.fps, 2),
        "durationSec": round(meta.duration_sec, 1),
        "sharpness": round(float(np.median(sharpness)), 1),
        "brightness": round(float(np.median(brightness)), 1),
        "contrast": round(float(np.median(contrast)), 1),
        "clippedFraction": round(float(np.median(clipped)), 4),
        "fieldCoverage": round(float(np.median(field_cover)), 3),
        "cameraMotionPx": round(float(np.median(motion)), 2) if motion else None,
        "metaReliable": meta.reliable,
    }

    feasibility, notes = _assess(metrics)
    verdict = _verdict(feasibility)

    return {
        "video": {
            "durationSec": metrics["durationSec"],
            "width": meta.width,
            "height": meta.height,
            "fps": metrics["fps"],
        },
        "verdict": verdict,
        "feasibility": feasibility,
        "metrics": metrics,
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# Medições
# ---------------------------------------------------------------------------

def _shrink(frame: np.ndarray, max_w: int) -> np.ndarray:
    h, w = frame.shape[:2]
    if w <= max_w:
        return frame
    scale = max_w / w
    return cv2.resize(frame, (max_w, int(h * scale)), interpolation=cv2.INTER_AREA)


def _field_coverage(frame_bgr: np.ndarray) -> float:
    """Fração do frame que parece terreno de jogo.

    Relva (matiz verde) ou piso de pavilhão (matiz quente e uniforme) — cobre
    futebol e futsal, que são o arranque. É deliberadamente uma heurística: a
    detecção de campo a sério (keypoints + homography) é uma fase própria, e
    esta medição só responde a "o enquadramento mostra jogo ou mostra bancada?".
    """
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    grass = cv2.inRange(hsv, (30, 40, 40), (90, 255, 255))
    court = cv2.inRange(hsv, (5, 40, 60), (25, 200, 255))
    return float(np.maximum(grass, court).mean() / 255.0)


def _camera_motion(gray_a: np.ndarray, gray_b: np.ndarray) -> float:
    """Deslocamento mediano da câmara entre dois frames próximos, em pixels.

    Optical flow denso numa imagem encolhida: barato e chega para separar
    "tripé", "pan normal de quem filma o jogo" e "telemóvel na mão a tremer".
    A mediana ignora os jogadores — eles movem-se, o fundo não.
    """
    flow = cv2.calcOpticalFlowFarneback(gray_a, gray_b, None, 0.5, 3, 15, 3, 5, 1.2, 0)
    magnitude = np.linalg.norm(flow, axis=2)
    return float(np.median(magnitude))


# ---------------------------------------------------------------------------
# Avaliação
# ---------------------------------------------------------------------------

def _assess(m: dict[str, Any]) -> tuple[dict[str, float], list[str]]:
    notes: list[str] = []

    res_score = _ramp(min(m["width"], m["height"] * 16 / 9), 640, 1280)
    if res_score < 0.6:
        notes.append(f"Resolução baixa ({m['width']}×{m['height']}) — jogadores pequenos custam tracking.")

    fps_score = _ramp(m["fps"], 15, 25)
    if m["fps"] and m["fps"] < 24:
        notes.append(f"{m['fps']:.0f} FPS — abaixo de 24, movimentos rápidos perdem-se entre frames.")

    sharp_score = _ramp(m["sharpness"], 30, 120)
    if sharp_score < 0.5:
        notes.append("Imagem pouco nítida (desfoque ou compressão forte).")

    light_score = _ramp(m["brightness"], 50, 90) * (1 - _ramp(m["clippedFraction"], 0.05, 0.25))
    if m["brightness"] < 60:
        notes.append("Vídeo escuro — iluminação fraca degrada a detecção.")
    elif m["clippedFraction"] > 0.15:
        notes.append("Zonas queimadas ou totalmente pretas — contraluz ou exposição errada.")

    field_score = _ramp(m["fieldCoverage"], 0.25, 0.55)
    if field_score < 0.5:
        notes.append("O terreno de jogo ocupa pouco do enquadramento — filmar de posição mais alta ajuda.")

    if m["cameraMotionPx"] is None:
        stab_score = 0.6
        notes.append("Não foi possível medir a estabilidade da câmara.")
    else:
        stab_score = 1 - _ramp(m["cameraMotionPx"], 2.0, 12.0)
        if stab_score < 0.5:
            notes.append("Câmara instável — um tripé melhora todas as etapas seguintes.")

    if not m["metaReliable"]:
        notes.append("Sem ffprobe no worker — duração e FPS são estimativas do OpenCV.")

    base = res_score * 0.25 + fps_score * 0.15 + sharp_score * 0.2 + light_score * 0.2 + stab_score * 0.2

    feasibility = {
        "player_tracking": round(_clamp01(base * (0.7 + 0.3 * field_score)), 2),
        "field_detection": round(_clamp01(field_score * 0.6 + (res_score + sharp_score) * 0.2), 2),
        # A bola é minúscula: a resolução e a nitidez pesam o dobro, e o tecto
        # é deliberadamente mais baixo — prometer 95% aqui seria mentir.
        "ball_tracking": round(_clamp01((res_score * 0.4 + sharp_score * 0.3 + fps_score * 0.3) * 0.8), 2),
        "individual_analysis": round(_clamp01(base), 2),
    }
    return feasibility, notes


def _verdict(feasibility: dict[str, float]) -> str:
    # A bola fica fora do veredicto: é a dimensão mais difícil e não pode
    # chumbar sozinha um vídeo que serve para tudo o resto.
    core = [v for k, v in feasibility.items() if k != "ball_tracking"]
    worst = min(core) if core else 0.0
    if worst >= 0.7:
        return "good"
    if worst >= 0.45:
        return "acceptable"
    return "poor"


def _ramp(value: float, low: float, high: float) -> float:
    """0 abaixo de `low`, 1 acima de `high`, linear no meio."""
    if high <= low:
        return 1.0
    return _clamp01((value - low) / (high - low))


def _clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))
