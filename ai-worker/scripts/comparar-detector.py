#!/usr/bin/env python
"""Medir a troca velocidade/precisão num clip real, antes de a decidir.

    python scripts/comparar-detector.py um-clip.mp4 [--frames 40]

Corre várias configurações do detector sobre **os mesmos frames** e diz, para
cada uma, quanto custou e quantas pessoas encontrou. A segunda metade é a que
costuma ficar por medir: é fácil ver que uma configuração é três vezes mais
rápida, e não reparar que passou a ver dois terços dos jogadores.

A referência é a configuração mais cuidadosa (lado curto a 800 px, Faster
R-CNN); as outras dizem quanto dela mantiveram — em número de detecções e em
sobreposição das caixas.
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

SCORE = 0.5


def amostrar(caminho: Path, quantos: int) -> list[np.ndarray]:
    """Frames espalhados pelo clip — não os primeiros, que são genéricos."""
    cap = cv2.VideoCapture(str(caminho))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if total <= 0:
        cap.release()
        raise SystemExit(f"Não consegui ler frames de {caminho}")
    posicoes = np.linspace(total * 0.05, total * 0.95, num=quantos).astype(int)
    frames = []
    for pos in posicoes:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(pos))
        ok, frame = cap.read()
        if ok and frame is not None:
            frames.append(frame)
    cap.release()
    return frames


def construir(nome: str, short: int, max_size: int, device: str):
    det = torchvision.models.detection
    if nome == "ssdlite":
        m = det.ssdlite320_mobilenet_v3_large(
            weights=det.SSDLite320_MobileNet_V3_Large_Weights.DEFAULT, score_thresh=SCORE,
        )
    elif device == "cuda":
        m = det.fasterrcnn_resnet50_fpn_v2(
            weights=det.FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT,
            box_score_thresh=SCORE, min_size=short, max_size=max_size,
        )
    else:
        m = det.fasterrcnn_mobilenet_v3_large_fpn(
            weights=det.FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT,
            box_score_thresh=SCORE, min_size=short, max_size=max_size,
        )
    return m.eval().to(device)


@torch.inference_mode()
def correr(model, frames, device: str, half: bool, batch: int):
    """Devolve (segundos por frame, caixas por frame)."""
    tensores = [
        torch.from_numpy(cv2.cvtColor(f, cv2.COLOR_BGR2RGB)).permute(2, 0, 1).to(device).float().div_(255)
        for f in frames
    ]
    caixas: list[np.ndarray] = []

    # Aquecer: a primeira passagem paga alocações e escolha de algoritmos.
    with torch.autocast(device_type=device, dtype=torch.float16, enabled=half):
        model(tensores[: min(batch, len(tensores))])
    if device == "cuda":
        torch.cuda.synchronize()

    t0 = time.perf_counter()
    with torch.autocast(device_type=device, dtype=torch.float16, enabled=half):
        for i in range(0, len(tensores), batch):
            for out in model(tensores[i : i + batch]):
                keep = out["labels"] == 1
                caixas.append(out["boxes"][keep].float().cpu().numpy())
    if device == "cuda":
        torch.cuda.synchronize()
    return (time.perf_counter() - t0) / len(tensores), caixas


def iou_medio(referencia: list[np.ndarray], candidato: list[np.ndarray]) -> float:
    """Quanto das caixas da referência é que o candidato reencontrou.

    Para cada caixa da referência, a melhor sobreposição no candidato. Uma
    configuração que veja as mesmas pessoas nos mesmos sítios fica perto de 1;
    uma que perca metade dos jogadores desce a 0,5 por muito rápida que seja.
    """
    total, contados = 0.0, 0
    for ref, cand in zip(referencia, candidato):
        for a in ref:
            contados += 1
            if len(cand) == 0:
                continue
            xx1 = np.maximum(a[0], cand[:, 0]); yy1 = np.maximum(a[1], cand[:, 1])
            xx2 = np.minimum(a[2], cand[:, 2]); yy2 = np.minimum(a[3], cand[:, 3])
            inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
            area_a = (a[2] - a[0]) * (a[3] - a[1])
            area_b = (cand[:, 2] - cand[:, 0]) * (cand[:, 3] - cand[:, 1])
            total += float(np.max(inter / (area_a + area_b - inter + 1e-9)))
    return total / max(1, contados)


def main() -> None:
    ap = argparse.ArgumentParser(description="Compara configurações do detector no mesmo clip.")
    ap.add_argument("video", type=Path)
    ap.add_argument("--frames", type=int, default=40, help="quantos frames amostrar (por omissão 40)")
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    frames = amostrar(args.video, args.frames)
    h, w = frames[0].shape[:2]
    fonte = min(w, h)
    print(f"{args.video.name} · {w}×{h} · {len(frames)} frames · {device}\n")

    configs = [
        ("referência — 800 px, lote 1", "fasterrcnn", 800, False, 1),
        ("800 px + fp16 + lote", "fasterrcnn", 800, device == "cuda", 8 if device == "cuda" else 2),
        ("ampliação 1.5× + fp16 + lote", "fasterrcnn", int(min(fonte * 1.5, 800)), device == "cuda", 8 if device == "cuda" else 2),
        ("ampliação 1.25× + fp16 + lote", "fasterrcnn", int(min(fonte * 1.25, 800)), device == "cuda", 8 if device == "cuda" else 2),
        ("resolução da fonte", "fasterrcnn", fonte, device == "cuda", 8 if device == "cuda" else 2),
        ("ssdlite320", "ssdlite", 320, device == "cuda", 8 if device == "cuda" else 2),
    ]

    print(f"{'configuração':<32}{'ms/frame':>10}{'fps':>8}{'ganho':>8}{'pessoas':>10}{'iou':>7}")
    print("-" * 75)

    base_t = base_c = None
    referencia = None
    for nome, det, short, half, batch in configs:
        max_size = int(round(short * (max(w, h) / max(1, fonte))))
        model = construir(det, short, max_size, device)
        seg, caixas = correr(model, frames, device, half, batch)
        pessoas = sum(len(c) for c in caixas) / len(caixas)
        if referencia is None:
            referencia, base_t, base_c = caixas, seg, pessoas
            iou, ganho, rel = 1.0, 1.0, 1.0
        else:
            iou = iou_medio(referencia, caixas)
            ganho = base_t / seg
            rel = pessoas / max(1e-9, base_c)
        print(f"{nome:<32}{seg*1000:>10.1f}{1/seg:>8.1f}{ganho:>7.1f}x{pessoas:>9.1f}{iou:>7.2f}"
              + ("" if referencia is caixas else f"   ({rel*100:.0f}% das da referência)"))
        del model

    print("\n  pessoas = detecções por frame · iou = quanto das caixas da referência foi reencontrado")
    print("  Uma configuração rápida com iou baixo está a perder jogadores, não a poupar trabalho.")


if __name__ == "__main__":
    main()
