"""Metadados e leitura de frames — FFmpeg primeiro, OpenCV como rede.

O `ffprobe` mede duração e FPS a partir do contentor, que é a verdade; o
OpenCV estima-os a partir do stream e engana-se com VFR (o vídeo de um
telemóvel é quase sempre VFR). Por isso a ordem é esta — e quando só há
OpenCV, o resultado di-lo na confiança, não finge.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np


@dataclass
class VideoMeta:
    duration_sec: float
    width: int
    height: int
    fps: float
    frame_count: int
    reliable: bool  # True quando veio do ffprobe


def probe(path: Path) -> VideoMeta:
    meta = _ffprobe(path)
    if meta:
        return meta
    return _opencv_meta(path)


def _ffprobe(path: Path) -> VideoMeta | None:
    if not shutil.which("ffprobe"):
        return None
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height,avg_frame_rate,nb_frames:format=duration",
                "-of", "json", str(path),
            ],
            capture_output=True, text=True, timeout=120, check=True,
        )
        data = json.loads(out.stdout)
        stream = data["streams"][0]
        num, _, den = (stream.get("avg_frame_rate") or "0/1").partition("/")
        fps = float(num) / float(den or 1) if float(den or 1) else 0.0
        duration = float(data.get("format", {}).get("duration") or 0.0)
        frames = int(stream.get("nb_frames") or 0) or int(duration * fps)
        return VideoMeta(
            duration_sec=duration,
            width=int(stream.get("width") or 0),
            height=int(stream.get("height") or 0),
            fps=fps,
            frame_count=frames,
            reliable=True,
        )
    except Exception:
        return None


def _opencv_meta(path: Path) -> VideoMeta:
    cap = cv2.VideoCapture(str(path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 0.0
        frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        return VideoMeta(
            duration_sec=frames / fps if fps else 0.0,
            width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0),
            height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0),
            fps=fps,
            frame_count=frames,
            reliable=False,
        )
    finally:
        cap.release()


def sample_frames(path: Path, count: int, pair_gap: int = 3) -> list[tuple[np.ndarray, np.ndarray | None]]:
    """`count` pares de frames espalhados pelo vídeo.

    Cada amostra traz o frame e, quando possível, o que vem `pair_gap` frames
    depois — é o par que permite medir a estabilidade da câmara por optical
    flow. Frames em BGR, como o OpenCV os dá.
    """
    cap = cv2.VideoCapture(str(path))
    samples: list[tuple[np.ndarray, np.ndarray | None]] = []
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total <= 0:
            return samples
        # Evita o primeiro e o último por cento: genéricos, ecrãs pretos, logos.
        positions = np.linspace(total * 0.02, total * 0.97, num=count).astype(int)
        for pos in positions:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(pos))
            ok, frame = cap.read()
            if not ok or frame is None:
                continue
            follow: np.ndarray | None = None
            for _ in range(pair_gap):
                ok2, nxt = cap.read()
                if ok2 and nxt is not None:
                    follow = nxt
            samples.append((frame, follow))
    finally:
        cap.release()
    return samples
