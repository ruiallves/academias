#!/usr/bin/env python
"""Quanto do jogo é que o detector vê, e a que velocidade — por configuração.

    python scripts/medir-recall.py jogo.mp4 [--frames 60] [--desde-min 20]

A pergunta do `comparar-detector.py` era "quanto custa"; esta é "quanto vê".
Num jogo de onze filmado de cima há ~22 pessoas em campo; a medida é quantas
o detector encontra por frame, e quanto custa cada frame. É o que decide se
a análise consegue acompanhar o vídeo a correr (5 FPS processados por cada
segundo de jogo) e com que recall.

Os frames vêm do meio do jogo, não do início — os primeiros minutos são
aquecimento, bancos e pessoas a passar.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch
import torchvision

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from academias_ai.pipelines.detect_track import _tile_grid  # noqa: E402  (o detector constrói-se aqui, sem a bola)

TARGET_FPS = 5.0


def amostrar(caminho: Path, quantos: int, desde_min: float) -> list[np.ndarray]:
    cap = cv2.VideoCapture(str(caminho))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    if total <= 0:
        cap.release()
        raise SystemExit(f"Não consegui ler frames de {caminho}")
    inicio = min(total * 0.9, desde_min * 60 * fps)
    posicoes = np.linspace(inicio, total * 0.95, num=quantos).astype(int)
    frames = []
    for pos in posicoes:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(pos))
        ok, frame = cap.read()
        if ok and frame is not None:
            frames.append(frame)
    cap.release()
    return frames


def construir(short: int, max_size: int, score: float, device: str):
    det = torchvision.models.detection
    if device == "cuda":
        m = det.fasterrcnn_resnet50_fpn_v2(
            weights=det.FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT,
            box_score_thresh=score, min_size=short, max_size=max_size,
        )
    else:
        m = det.fasterrcnn_mobilenet_v3_large_fpn(
            weights=det.FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT,
            box_score_thresh=score, min_size=short, max_size=max_size,
        )
    m.eval().to(device)
    if device == "cuda":
        torch.backends.cudnn.benchmark = True
    return m


def _tensor(rgb: np.ndarray, device: str):
    return torch.from_numpy(np.ascontiguousarray(rgb)).permute(2, 0, 1).to(device).float().div_(255)


@torch.inference_mode()
def correr(model, frames, device: str, batch: int, tiles: int):
    """Devolve (segundos por frame, pessoas por frame)."""
    pessoas: list[int] = []

    def detectar(lote_frames):
        lote, origem = [], []
        for k, f in enumerate(lote_frames):
            rgb = cv2.cvtColor(f, cv2.COLOR_BGR2RGB)
            if tiles <= 1:
                lote.append(_tensor(rgb, device)); origem.append((k, 0, 0))
            else:
                for x1, y1, x2, y2 in _tile_grid(rgb.shape[0], rgb.shape[1], tiles):
                    lote.append(_tensor(rgb[y1:y2, x1:x2], device)); origem.append((k, x1, y1))
        with torch.autocast(device_type=device, dtype=torch.float16, enabled=device == "cuda"):
            saidas = model(lote)
        por_frame: list[list] = [[] for _ in lote_frames]
        for (k, dx, dy), out in zip(origem, saidas):
            keep = out["labels"] == 1
            b = out["boxes"][keep].float()
            if dx or dy:
                b = b + torch.tensor([dx, dy, dx, dy], device=b.device)
            por_frame[k].append((b, out["scores"][keep].float()))
        contagem = []
        for partes in por_frame:
            boxes = torch.cat([b for b, _ in partes]); scores = torch.cat([s for _, s in partes])
            if tiles > 1 and len(boxes) > 1:
                boxes = boxes[torchvision.ops.nms(boxes, scores, 0.5)]
            contagem.append(len(boxes))
        return contagem

    detectar(frames[:batch])  # aquecer
    if device == "cuda":
        torch.cuda.synchronize()
    t0 = time.perf_counter()
    for i in range(0, len(frames), batch):
        pessoas.extend(detectar(frames[i : i + batch]))
    if device == "cuda":
        torch.cuda.synchronize()
    return (time.perf_counter() - t0) / len(frames), pessoas


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--frames", type=int, default=60)
    ap.add_argument("--desde-min", type=float, default=20.0)
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    frames = amostrar(args.video, args.frames, args.desde_min)
    h, w = frames[0].shape[:2]
    fonte = min(w, h)
    batch = 8 if device == "cuda" else 2
    print(f"{args.video.name} · {w}×{h} · {len(frames)} frames · {device}\n")

    # (nome, lado curto, limiar, mosaicos)
    configs = [
        ("800 px · 0.5 · sem mosaicos (hoje)", 800, 0.5, 1),
        ("800 px · 0.4 · sem mosaicos", 800, 0.4, 1),
        ("1080 px · 0.4 · sem mosaicos", 1080, 0.4, 1),
        ("1333 px · 0.4 · sem mosaicos", 1333, 0.4, 1),
        ("800 px · 0.4 · mosaicos 2×2 (.env)", 800, 0.4, 2),
    ]

    print(f"{'configuração':<40}{'ms/frame':>10}{'fps':>7}{'× tempo real':>14}{'pessoas':>10}")
    print("-" * 81)
    for nome, short, score, tiles in configs:
        short = min(short, 1333)
        max_size = int(round(short * (max(w, h) / max(1, fonte))))
        model = construir(short, max_size, score, device)
        seg, pessoas = correr(model, frames, device, batch, tiles)
        fps = 1 / seg
        print(f"{nome:<40}{seg*1000:>10.1f}{fps:>7.1f}{fps / TARGET_FPS:>13.2f}×{np.mean(pessoas):>10.1f}")
        del model
        if device == "cuda":
            torch.cuda.empty_cache()

    print("\n  × tempo real = fps processados ÷ 5 (a cadência da análise). Abaixo de 1 não acompanha o vídeo.")
    print("  pessoas = detecções por frame; num jogo de onze filmado de cima, 22 é ver tudo.")


if __name__ == "__main__":
    main()
