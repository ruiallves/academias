#!/usr/bin/env python
"""Quanto do que o detector vê é que o tracker segura — num troço real.

    python scripts/medir-tracking.py jogo.mp4 [--desde-min 20] [--segundos 60]

O `medir-recall.py` conta detecções por frame; isto corre a pipeline inteira
(detector + ByteTrack, como no worker) sobre um troço contínuo e compara as
duas contagens frame a frame. Se o detector vê 16 e o tracker devolve 2, o
problema não é de resolução nem de mosaicos — é da associação a 5 FPS, e
afina-se no `_build_tracker`.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np
import torch

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from academias_ai import video as videolib  # noqa: E402
from academias_ai.pipelines import detect_track as dt  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("video", type=Path)
    ap.add_argument("--desde-min", type=float, default=20.0)
    ap.add_argument("--segundos", type=float, default=60.0)
    args = ap.parse_args()

    meta = videolib.probe(args.video)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    plano = dt._plan(device, meta)
    model = dt._load_detector(device, plano)
    tracker = dt._build_tracker()
    camara = dt.CameraMotion()
    pessoas = dt.PersonRegistry(meta)
    bola = dt.BallTracker(meta)
    equipas = dt.TeamClassifier()
    pids: set[int] = set()
    com_bola = 0
    stride = max(1, round(meta.fps / dt.TARGET_FPS))
    print(f"{args.video.name} · {meta.width}×{meta.height} · {device} · plano: {plano}\n")

    inicio = int(args.desde_min * 60 * meta.fps)
    fim = inicio + int(args.segundos * meta.fps)

    def frames():
        """Como `_frames` do worker, mas só o troço pedido."""
        cap = cv2.VideoCapture(str(args.video))
        cap.set(cv2.CAP_PROP_POS_FRAMES, inicio)
        index = inicio
        try:
            while index < fim and cap.grab():
                if index % stride == 0:
                    ok, frame = cap.retrieve()
                    if ok and frame is not None:
                        yield index, int(index / meta.fps * 1000), frame
                index += 1
        finally:
            cap.release()

    detectadas: list[int] = []
    seguidas: list[int] = []
    ids: set[int] = set()
    # Onde se gasta o tempo na CPU, por peça. A detecção corre numa thread, um
    # lote à frente (ver `_pipeline`), e por isso não se mede aqui — o que conta
    # é o tempo total contra o tempo de vídeo.
    tempos = {"câmara+tracker+pessoas": 0.0, "bola (zoom)": 0.0}

    def sync() -> float:
        if device == "cuda":
            torch.cuda.synchronize()
        return time.perf_counter()

    t0 = time.perf_counter()
    for _index, ts, frame, det, _bolas in dt._pipeline(frames(), model, device, plano, plano["batch"]):
        t = sync()
        detectadas.append(len(det))
        pessoas.move(camara.compensate(frame, tracker))
        seg = tracker.update_with_detections(det)
        camara.remember(det)
        atribuidas = pessoas.assign(frame, ts, seg)
        pids.update(p for p, _b, _c in atribuidas)
        for p, b, _c in atribuidas:
            if (len(seguidas) + p) % 3 == 0:
                equipas.observe(p, frame, b)
        equipas.refresh(ts)
        caixas = [b for _p, b, _c in atribuidas]
        t2 = sync()
        tempos["câmara+tracker+pessoas"] += t2 - t
        candidatas = list(_bolas)
        if len(seguidas) % (3 if bola.where() is not None else 2) == 0:
            candidatas += dt._ball_zoom(model, frame, device, plano, bola.where(), caixas)
        if bola.update(ts, candidatas, caixas) is not None:
            com_bola += 1
        tempos["bola (zoom)"] += sync() - t2
        seguidas.append(len(seg))
        ids.update(int(t) for t in seg.tracker_id)
    segundos = time.perf_counter() - t0

    n = len(seguidas)
    print(f"{n} frames processados em {segundos:.0f} s ({n / segundos / dt.TARGET_FPS:.2f}× tempo real)")
    print("  " + " · ".join(f"{nome} {valor / max(1, n) * 1000:.0f} ms/frame" for nome, valor in tempos.items()))
    print(f"detectadas por frame: {np.mean(detectadas):.1f}   seguidas por frame: {np.mean(seguidas):.1f}")
    print(f"tracks abertos no troço: {len(ids)}  (num jogo bem seguido, ~22 mais as entradas e saídas)")
    print(f"pessoas numeradas no troço: {len(pids)}  (o número que o ecrã mostra; quanto mais perto de 22, melhor)")
    print(f"frames sem nenhum track: {sum(1 for s in seguidas if s == 0)} de {n}")
    print(f"bola vista: {com_bola} de {n} frames ({100 * com_bola / max(1, n):.0f} %)")
    grupos = {g: sum(1 for p in pids if equipas.group_of(p) == g) for g in ("A", "B", "other")}
    print(f"equipas pela cor: {grupos} · cores {equipas.palette()}")


if __name__ == "__main__":
    main()
