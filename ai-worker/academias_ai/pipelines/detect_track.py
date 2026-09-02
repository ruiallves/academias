"""detect_track — detecção de pessoas + tracking persistente.

A primeira etapa com modelos a sério, e a fundação de tudo o que vem depois
(identificação, métricas, eventos). Corre a ~5 FPS de propósito: é o Pass 1 da
pipeline — os momentos interessantes serão reprocessados a FPS alto numa fase
futura, e processar 90 minutos inteiros a 30 FPS é dinheiro queimado.

## Modelos (licenças em LICENSES.md)

- Detector: torchvision Faster R-CNN (BSD-3, pesos COCO descarregados do hub
  oficial na primeira execução). Na CPU usa-se a variante MobileNet; com CUDA,
  a ResNet50-v2. O Ultralytics YOLO ficou fora por ser AGPL.
- Tracker: ByteTrack via `supervision` (MIT).

## O que esta etapa NÃO faz — e diz que não faz

- Não identifica jogadores (fase 5): `identityConfidence` vai vazio e o
  produto pede revisão humana, que é o desenho.
- Não separa equipas ainda: `side = "unknown"`. Inventar um lado seria pior
  do que não ter lado.
- Não segue a bola: `ballTracking.status = "not_attempted"` no resultado, em
  vez de um número fingido.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np

from .. import api
from .. import video as videolib

try:
    import torch
    import torchvision
    import supervision as sv

    _DEPS = True
except ImportError:
    _DEPS = False

TARGET_FPS = 5.0
MIN_TRACK_SEC = 2.0
SCORE_THRESHOLD = 0.5


def dependencies_ok() -> bool:
    return _DEPS


MODELS: list[dict[str, str]] = (
    [
        {
            "task": "detection",
            "name": "torchvision-fasterrcnn",
            "version": torchvision.__version__,
            "license": "BSD-3-Clause",
            "source": "https://pytorch.org/vision",
        },
        {
            "task": "tracking",
            "name": "supervision-bytetrack",
            "version": sv.__version__,
            "license": "MIT",
            "source": "https://github.com/roboflow/supervision",
        },
    ]
    if _DEPS
    else []
)


def run(job: dict[str, Any], video_path: Path, progress: Callable[[int], None]) -> dict[str, Any]:
    meta = videolib.probe(video_path)
    if meta.fps <= 0 or meta.frame_count <= 0:
        raise RuntimeError("Não foi possível ler a cadência do vídeo")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = _load_detector(device)
    tracker = sv.ByteTrack(frame_rate=int(TARGET_FPS))

    stride = max(1, round(meta.fps / TARGET_FPS))
    tracks: dict[int, list[tuple[int, float, float, float, float, float]]] = {}
    frames_processed = 0
    detections_total = 0

    cap = cv2.VideoCapture(str(video_path))
    try:
        index = 0
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                break
            if index % stride != 0:
                index += 1
                continue

            ts_ms = int(index / meta.fps * 1000)
            detections = _detect_people(model, frame, device)
            detections_total += len(detections)
            tracked = tracker.update_with_detections(detections)

            for xyxy, conf, tid in zip(tracked.xyxy, tracked.confidence, tracked.tracker_id):
                x1, y1, x2, y2 = (float(v) for v in xyxy)
                tracks.setdefault(int(tid), []).append(
                    (ts_ms, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, float(conf)),
                )

            frames_processed += 1
            if frames_processed % 40 == 0:
                progress(int(95 * index / meta.frame_count))
            index += 1
    finally:
        cap.release()

    if frames_processed == 0:
        raise RuntimeError("Nenhum frame processado — o vídeo pode estar corrompido")

    result_tracks, confidences = _summarise(job, tracks, meta)
    progress(98)

    return {
        "tracks": result_tracks,
        "confidence": {"player_tracking": _overall_confidence(confidences, frames_processed, detections_total)},
        "ballTracking": {"status": "not_attempted"},
        "stats": {
            "framesProcessed": frames_processed,
            "detections": detections_total,
            "strideFrames": stride,
            "device": device,
            "videoW": meta.width,
            "videoH": meta.height,
        },
    }


# ---------------------------------------------------------------------------


def _load_detector(device: str):
    """CPU leva a variante leve; CUDA aguenta a pesada. Ambas BSD, pesos COCO."""
    if device == "cuda":
        weights = torchvision.models.detection.FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT
        model = torchvision.models.detection.fasterrcnn_resnet50_fpn_v2(
            weights=weights, box_score_thresh=SCORE_THRESHOLD,
        )
    else:
        weights = torchvision.models.detection.FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT
        model = torchvision.models.detection.fasterrcnn_mobilenet_v3_large_fpn(
            weights=weights, box_score_thresh=SCORE_THRESHOLD,
        )
    model.eval()
    model.to(device)
    return model


@torch.inference_mode() if _DEPS else (lambda f: f)
def _detect_people(model, frame_bgr: np.ndarray, device: str) -> "sv.Detections":
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div(255).to(device)
    output = model([tensor])[0]

    # COCO: classe 1 = pessoa. O resto (bancos, bolas de outra classe) sai já aqui.
    keep = output["labels"] == 1
    boxes = output["boxes"][keep].cpu().numpy()
    scores = output["scores"][keep].cpu().numpy()

    return sv.Detections(
        xyxy=boxes.reshape(-1, 4),
        confidence=scores,
        class_id=np.zeros(len(scores), dtype=int),
    )


def _summarise(
    job: dict[str, Any],
    tracks: dict[int, list[tuple[int, float, float, float, float, float]]],
    meta: videolib.VideoMeta,
) -> tuple[list[dict[str, Any]], list[float]]:
    """Dos pontos crus aos registos que a API guarda.

    As posições por frame sobem para o Storage (`dataKey`) — meio milhão de
    linhas não é um dado relacional; na base fica o resumo.
    """
    records: list[dict[str, Any]] = []
    confidences: list[float] = []

    for tid, points in sorted(tracks.items()):
        first_ms, last_ms = points[0][0], points[-1][0]
        span_sec = (last_ms - first_ms) / 1000
        if span_sec < MIN_TRACK_SEC:
            continue  # ruído: uma detecção fantasma de meia dúzia de frames

        confs = [p[5] for p in points]
        expected = max(1, (last_ms - first_ms) / 1000 * TARGET_FPS)
        continuity = min(1.0, len(points) / expected)
        track_conf = round(float(np.mean(confs)) * (0.6 + 0.4 * continuity), 3)
        confidences.append(track_conf)

        data_key = api.upload_json_gz(
            job["id"],
            f"tracks/track-{tid}.json.gz",
            {
                "trackNumber": tid,
                "videoSize": [meta.width, meta.height],
                "targetFps": TARGET_FPS,
                # (tsMs, cx, cy, w, h, conf) em pixels da imagem — a conversão
                # para metros chega com a homography, numa fase própria.
                "points": [[p[0], round(p[1], 1), round(p[2], 1), round(p[3], 1), round(p[4], 1), round(p[5], 3)] for p in points],
            },
        )

        records.append(
            {
                "trackNumber": tid,
                "side": "unknown",  # separar equipas é fase futura; inventar um lado seria pior
                "firstMs": first_ms,
                "lastMs": last_ms,
                "frameCount": len(points),
                "trackConfidence": track_conf,
                "dataKey": data_key,
                "summary": {
                    "avgX": round(float(np.mean([p[1] for p in points])) / max(1, meta.width), 3),
                    "avgY": round(float(np.mean([p[2] for p in points])) / max(1, meta.height), 3),
                    "meanDetectionConfidence": round(float(np.mean(confs)), 3),
                    "continuity": round(continuity, 3),
                },
            },
        )

    return records, confidences


def _overall_confidence(track_confs: list[float], frames: int, detections: int) -> float:
    """Uma estimativa honesta da qualidade do tracking, não uma promessa.

    Combina a confiança média dos tracks com a densidade de detecções (um jogo
    filmado de longe com 3 detecções por frame não está a ver o jogo todo).
    """
    if not track_confs:
        return 0.0
    density = min(1.0, (detections / max(1, frames)) / 12)  # ~12 pessoas visíveis é saudável
    return round(min(1.0, float(np.mean(track_confs)) * (0.7 + 0.3 * density)), 2)
