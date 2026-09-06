"""detect_track — detecção de pessoas + tracking persistente.

A primeira etapa com modelos a sério, e a fundação de tudo o que vem depois
(identificação, métricas, eventos). Corre a ~5 FPS de propósito: é o Pass 1 da
pipeline — os momentos interessantes serão reprocessados a FPS alto numa fase
futura, e processar 90 minutos inteiros a 30 FPS é dinheiro queimado.

## Modelos (licenças em LICENSES.md)

- Detector: torchvision (BSD-3, pesos COCO descarregados do hub oficial na
  primeira execução). Faster R-CNN ResNet50-v2 com CUDA, MobileNet em CPU, e
  SSDlite quando se pede velocidade acima de tudo. O Ultralytics YOLO ficou
  fora por ser AGPL.
- Tracker: ByteTrack via `supervision` (MIT).

## Onde é que o tempo se gastava

Um jogo de 111 minutos demorava **1h51m numa RTX 5050** — e a GPU estava a
92 %, ou seja, não era ela que faltava. Era o trabalho que lhe dávamos, medido
em quatro sítios:

1. **O reescalonamento por omissão.** O torchvision leva o lado curto de cada
   frame a 800 px antes de detectar. Um vídeo de 640×360 era **ampliado para
   ~1422×800** — quase cinco vezes os píxeis da fonte, sem uma única informação
   nova. Era, de longe, o maior custo.
2. **Um frame de cada vez.** `model([frame])` deixa a GPU a fazer kernels
   pequenos e a esperar entre eles.
3. **Precisão dupla desnecessária.** A detecção é robusta a fp16; a fp32 custa
   o dobro da largura de banda por nada.
4. **Descodificar tudo, usar um sexto.** `read()` descodifica *e* converte cada
   frame; a 5 FPS num vídeo de 30, cinco em cada seis eram convertidos para
   nada. (Medido: é o menor dos quatro — 0,9 min por jogo — mas é grátis
   corrigi-lo com `grab()`.)

Medido na mesma máquina, no mesmo vídeo: 5,7 → 8,5 FPS só com fp16 e lotes
(**sem tocar na precisão**), e 11,5 FPS com a resolução de trabalho ajustada.

## A resolução de trabalho, e porque é que não é «a da fonte»

A tentação é mandar o frame como ele vem. Mas num vídeo de 360p filmado de
longe um jogador tem 30 px de altura, e o detector foi treinado com âncoras
que esperam objectos maiores — ampliar **ajuda mesmo** a encontrá-lo. O que
não ajuda é ampliar 2,2×.

Por isso a regra é um tecto, não uma igualdade: amplia-se até `MAX_UPSCALE`
(1,5× por omissão), nunca acima de `MAX_SHORT` (800 px, o valor para que os
pesos foram treinados), nunca abaixo de `MIN_SHORT`. Um vídeo de 1080p passa a
ser **reduzido**, que é ganho puro; um de 360p sobe a 540 em vez de 800, e
poupa metade do trabalho.

Tudo isto se afina por ambiente sem tocar no código — ver `config.py`. E a
troca velocidade/precisão mede-se em vez de se assumir:
`scripts/comparar-detector.py` corre duas configurações no mesmo clip e diz
quantas pessoas cada uma encontrou.

## A fragmentação, e porque é que ela existe

O ByteTrack associa detecções entre frames pela sobreposição das caixas — foi
desenhado para 25-30 FPS. Nós corremos a **5**, que é o Pass 1. A essa cadência
um jogador a correr desloca-se meio corpo entre frames consecutivos, a
sobreposição falha, e o tracker abre uma identidade nova.

O resultado medido num jogo real de 111 minutos: **mais de 8 600 identidades
para 22 jogadores**. Não é só desperdício — é o produto a partir-se, porque
cada identidade abaixo do limiar de confiança pede uma confirmação humana, e
ninguém confirma oito mil.

Contra isso, duas coisas, por esta ordem:

1. **O tracker afinado para cadência baixa** — mais tolerância na associação e
   memória mais longa de um track perdido, ambas medidas em *segundos* e não em
   frames, para não mudarem de significado quando a cadência mudar.
2. **Uma passagem de junção** (`_merge_fragments`): dois tracks em que o
   segundo começa onde o primeiro acabou, pouco depois e com o mesmo tamanho,
   são o mesmo jogador. É a colagem barata que apanha o caso comum — a oclusão
   de um segundo. A colagem por aparência (re-identificação) é fase própria e
   apanhará o resto.

## As posições vão num ficheiro só

Havia um ficheiro por track no Storage. Com oito mil tracks eram oito mil
pedidos de URL assinado e oito mil escritas — dez minutos de rede depois de o
trabalho estar feito, com a análise parada nos 95 % e, pior, **sem bater o
coração**: a API repõe na fila quem passa cinco minutos calado, e cem minutos de
trabalho iam ao lixo. Agora é um ficheiro por análise, e o progresso continua a
ser reportado enquanto se junta e se envia.

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

from .. import api, config
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

# Os limites da resolução de trabalho. Ver a nota de topo.
MAX_SHORT = 800   # o valor para que os pesos COCO foram treinados
MIN_SHORT = 320   # abaixo disto um jogador ao longe deixa de existir

# --- Junção de fragmentos ---------------------------------------------------
#
# Em segundos e em fracções da largura do frame, nunca em frames nem em píxeis:
# assim continuam a querer dizer a mesma coisa quando a cadência ou a resolução
# mudarem.

# Quanto tempo um jogador pode desaparecer e ainda ser o mesmo. Dois segundos
# cobrem a oclusão atrás de outro jogador; muito mais e começa a colar pessoas
# diferentes que passaram pelo mesmo sítio.
MERGE_GAP_SEC = 2.0
# A que velocidade ele pode ter-se deslocado nesse intervalo, em larguras de
# frame por segundo. Um extremo em contra-ataque numa filmagem larga faz cerca
# de um terço da largura por segundo.
MERGE_SPEED_FRAC = 0.35
# E quanto pode ter mudado de tamanho. Um jogador aproxima-se da câmara, não
# duplica de altura num segundo.
MERGE_SIZE_RATIO = 1.8


def dependencies_ok() -> bool:
    return _DEPS


def _detector_name() -> str:
    """Qual detector, na ordem: o que o ambiente pedir, senão o que o aparelho merece."""
    pedido = (config.DETECTOR or "").strip().lower()
    if pedido in ("fasterrcnn", "ssdlite"):
        return pedido
    return "fasterrcnn"


MODELS: list[dict[str, str]] = (
    [
        {
            "task": "detection",
            "name": f"torchvision-{_detector_name()}",
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
    plano = _plan(device, meta)
    model = _load_detector(device, plano)
    tracker = _build_tracker()

    stride = max(1, round(meta.fps / TARGET_FPS))
    tracks: dict[int, list[tuple[int, float, float, float, float, float]]] = {}
    frames_processed = 0
    detections_total = 0

    cap = cv2.VideoCapture(str(video_path))
    try:
        lote_frames: list[np.ndarray] = []
        lote_ts: list[int] = []
        index = 0

        def escoar() -> None:
            """Manda o lote ao detector e entrega ao tracker, pela ordem do vídeo."""
            nonlocal frames_processed, detections_total
            if not lote_frames:
                return
            for ts_ms, deteccoes in zip(lote_ts, _detect_people(model, lote_frames, device, plano)):
                detections_total += len(deteccoes)
                seguidos = tracker.update_with_detections(deteccoes)
                for xyxy, conf, tid in zip(seguidos.xyxy, seguidos.confidence, seguidos.tracker_id):
                    x1, y1, x2, y2 = (float(v) for v in xyxy)
                    tracks.setdefault(int(tid), []).append(
                        (ts_ms, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, float(conf)),
                    )
                frames_processed += 1
            lote_frames.clear()
            lote_ts.clear()

        while True:
            # `grab()` descodifica sem converter nem devolver — é o que torna
            # barato saltar cinco frames em cada seis. Só o que vai ao detector
            # paga a conversão, com `retrieve()`.
            if not cap.grab():
                break
            if index % stride == 0:
                ok, frame = cap.retrieve()
                if ok and frame is not None:
                    lote_frames.append(frame)
                    lote_ts.append(int(index / meta.fps * 1000))
                    if len(lote_frames) >= plano["batch"]:
                        escoar()
                        if frames_processed % 40 < plano["batch"]:
                            progress(int(95 * index / meta.frame_count))
            index += 1

        escoar()  # o resto do último lote
    finally:
        cap.release()

    if frames_processed == 0:
        raise RuntimeError("Nenhum frame processado — o vídeo pode estar corrompido")

    brutos = len(tracks)
    tracks = _merge_fragments(tracks, meta)
    progress(96)

    result_tracks, confidences = _summarise(job, tracks, meta, progress)
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
            # O que o worker escolheu — para um resultado lento ou fraco se poder
            # explicar sem adivinhar em que máquina correu.
            "detector": plano["detector"],
            "workShort": plano["short"],
            "batch": plano["batch"],
            "halfPrecision": plano["half"],
            # Quantas identidades o tracker abriu contra quantas sobraram depois
            # de juntar. É o número que diz se a cadência está a chegar.
            "rawTracks": brutos,
            "mergedTracks": len(tracks),
        },
    }


# ---------------------------------------------------------------------------
# O plano de execução
# ---------------------------------------------------------------------------


def _plan(device: str, meta: videolib.VideoMeta) -> dict[str, Any]:
    """Como é que este vídeo vai ser processado nesta máquina.

    Decidido uma vez, no início, e devolvido no resultado: um número lento tem
    de poder ser explicado meses depois sem adivinhar a configuração.
    """
    fonte = min(meta.width, meta.height) or MAX_SHORT
    tecto = min(config.WORK_SHORT_MAX or MAX_SHORT, MAX_SHORT)
    short = int(min(fonte * config.MAX_UPSCALE, tecto))
    short = max(MIN_SHORT, short)

    # O lado longo acompanha, para o rácio do vídeo não ser esmagado.
    longo = max(meta.width, meta.height) or short
    max_size = int(round(short * (longo / max(1, fonte))))

    return {
        "detector": _detector_name(),
        "short": short,
        "maxSize": max_size,
        # Lotes maiores só rendem onde há paralelismo a sério para os encher.
        "batch": max(1, config.BATCH or (8 if device == "cuda" else 2)),
        # fp16 é ganho na GPU e perda na CPU (que emula meia precisão).
        "half": device == "cuda" and config.HALF,
    }


def _build_tracker():
    """O ByteTrack afinado para 5 FPS — ver a nota de topo.

    Os parâmetros vão num `try`: são de uma API que a `supervision` já marcou
    como obsoleta, e o dia em que mudarem de nome não pode ser o dia em que o
    worker deixa de correr. Sem eles, volta-se ao comportamento antigo — pior,
    mas a funcionar.
    """
    try:
        return sv.ByteTrack(
            frame_rate=int(TARGET_FPS),
            # Memória de um track perdido, em segundos e não em frames.
            lost_track_buffer=int(TARGET_FPS * MERGE_GAP_SEC),
            # Mais tolerante na associação: a 5 FPS as caixas do mesmo jogador
            # em frames seguidos sobrepõem-se pouco.
            minimum_matching_threshold=0.5,
            # Uma detecção fraca ainda vale para continuar um track existente.
            track_activation_threshold=0.35,
        )
    except TypeError:
        return sv.ByteTrack(frame_rate=int(TARGET_FPS))


def _merge_fragments(
    tracks: dict[int, list[tuple[int, float, float, float, float, float]]],
    meta: videolib.VideoMeta,
) -> dict[int, list[tuple[int, float, float, float, float, float]]]:
    """Cola fragmentos que são, quase de certeza, o mesmo jogador.

    O critério é físico, não estatístico: o segundo fragmento começa **depois**
    de o primeiro acabar, dentro de `MERGE_GAP_SEC`, a uma distância que um
    jogador percorre nesse tempo, e com um tamanho de caixa parecido. Nada
    disto identifica ninguém — só reconhece que duas metades de uma trajectória
    são uma trajectória.

    Percorre-se por ordem de início e só se comparam cadeias ainda "abertas"
    (as que acabaram há pouco), por isso o custo é praticamente linear mesmo
    com dez mil fragmentos.
    """
    if not tracks:
        return tracks

    largura = max(1, meta.width)
    gap_ms = MERGE_GAP_SEC * 1000
    # Quanto um jogador pode deslocar-se por milissegundo, em píxeis.
    vel_px_ms = MERGE_SPEED_FRAC * largura / 1000

    ordenados = sorted(tracks.items(), key=lambda kv: kv[1][0][0])
    cadeias: list[list[tuple[int, float, float, float, float, float]]] = []
    # (índice da cadeia, ts do fim, x, y, altura) — só das que ainda podem receber.
    abertas: list[tuple[int, int, float, float, float]] = []

    for _tid, pontos in ordenados:
        ts_ini, x_ini, y_ini, _w, h_ini, _c = pontos[0]

        # Fecha as que já não podem receber este nem nenhum dos seguintes.
        abertas = [a for a in abertas if ts_ini - a[1] <= gap_ms]

        melhor, melhor_dist = None, None
        for pos, (idx, ts_fim, x_fim, y_fim, h_fim) in enumerate(abertas):
            intervalo = ts_ini - ts_fim
            if intervalo <= 0:
                continue  # sobrepõem-se no tempo: são dois jogadores, não um
            alcance = vel_px_ms * intervalo + h_ini  # a folga de um corpo
            dist = ((x_ini - x_fim) ** 2 + (y_ini - y_fim) ** 2) ** 0.5
            if dist > alcance:
                continue
            razao = max(h_ini, h_fim) / max(1.0, min(h_ini, h_fim))
            if razao > MERGE_SIZE_RATIO:
                continue
            if melhor_dist is None or dist < melhor_dist:
                melhor, melhor_dist = pos, dist

        if melhor is None:
            cadeias.append(list(pontos))
            idx = len(cadeias) - 1
        else:
            idx = abertas[melhor][0]
            cadeias[idx].extend(pontos)
            abertas.pop(melhor)

        ts_f, x_f, y_f, _w2, h_f, _c2 = cadeias[idx][-1]
        abertas.append((idx, ts_f, x_f, y_f, h_f))

    # Numeração nova e estável: pela ordem em que entram em campo.
    return {i + 1: pontos for i, pontos in enumerate(cadeias)}


def _load_detector(device: str, plano: dict[str, Any]):
    """O detector, na resolução de trabalho decidida. Ambos BSD-3, pesos COCO."""
    det = torchvision.models.detection

    if plano["detector"] == "ssdlite":
        # Um passo só: muito mais rápido, e mais fraco com jogadores sobrepostos
        # — que num jogo são muitos. Existe para quando o tempo manda.
        model = det.ssdlite320_mobilenet_v3_large(
            weights=det.SSDLite320_MobileNet_V3_Large_Weights.DEFAULT,
            score_thresh=SCORE_THRESHOLD,
        )
    elif device == "cuda":
        model = det.fasterrcnn_resnet50_fpn_v2(
            weights=det.FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT,
            box_score_thresh=SCORE_THRESHOLD,
            min_size=plano["short"],
            max_size=plano["maxSize"],
        )
    else:
        model = det.fasterrcnn_mobilenet_v3_large_fpn(
            weights=det.FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT,
            box_score_thresh=SCORE_THRESHOLD,
            min_size=plano["short"],
            max_size=plano["maxSize"],
        )

    model.eval().to(device)

    if device == "cuda":
        # Escolhe o melhor algoritmo de convolução para estas dimensões — que
        # são sempre as mesmas ao longo de um vídeo, e por isso compensa.
        #
        # `channels_last` não entra aqui: os modelos de detecção do torchvision
        # recebem uma **lista de tensores 3D** (o lote é montado lá dentro,
        # depois do redimensionamento), e esse formato exige rank 4. Convertê-lo
        # à entrada rebenta; convertê-lo só nos pesos punha o motor a trocar de
        # formato a cada camada. Fica de fora — e não fazia parte do que foi
        # medido, por isso não se perde ganho nenhum comprovado.
        torch.backends.cudnn.benchmark = True
    else:
        # Sem isto o PyTorch usa um thread por omissão em alguns contentores.
        torch.set_num_threads(config.THREADS or torch.get_num_threads())

    return model


@torch.inference_mode() if _DEPS else (lambda f: f)
def _detect_people(model, frames_bgr: list[np.ndarray], device: str, plano: dict[str, Any]) -> list["sv.Detections"]:
    """Um lote de frames → uma lista de detecções, na mesma ordem."""
    lote = []
    for frame in frames_bgr:
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        lote.append(torch.from_numpy(rgb).permute(2, 0, 1).to(device, non_blocking=True).float().div_(255))

    with torch.autocast(device_type=device, dtype=torch.float16, enabled=plano["half"]):
        saidas = model(lote)

    resultados: list["sv.Detections"] = []
    for out in saidas:
        # COCO: classe 1 = pessoa. O resto (bancos, bolas de outra classe) sai já aqui.
        keep = out["labels"] == 1
        boxes = out["boxes"][keep].float().cpu().numpy()
        scores = out["scores"][keep].float().cpu().numpy()
        resultados.append(
            sv.Detections(
                xyxy=boxes.reshape(-1, 4),
                confidence=scores,
                class_id=np.zeros(len(scores), dtype=int),
            ),
        )
    return resultados


POSITIONS_KEY = "tracks/positions.json.gz"


def _summarise(
    job: dict[str, Any],
    tracks: dict[int, list[tuple[int, float, float, float, float, float]]],
    meta: videolib.VideoMeta,
    progress: Callable[[int], None] | None = None,
) -> tuple[list[dict[str, Any]], list[float]]:
    """Dos pontos crus aos registos que a API guarda.

    As posições por frame sobem para o Storage — meio milhão de linhas não é um
    dado relacional; na base fica o resumo. **Num ficheiro só**: um por track
    eram milhares de idas à rede depois de o trabalho estar feito, e o `dataKey`
    de cada track passa a apontar todo para o mesmo sítio, com o número do track
    a dizer onde ler lá dentro.
    """
    records: list[dict[str, Any]] = []
    confidences: list[float] = []
    posicoes: dict[str, list[list[float]]] = {}

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

        # (tsMs, cx, cy, w, h, conf) em pixels da imagem — a conversão para
        # metros chega com a homography, numa fase própria.
        posicoes[str(tid)] = [
            [p[0], round(p[1], 1), round(p[2], 1), round(p[3], 1), round(p[4], 1), round(p[5], 3)] for p in points
        ]

        records.append(
            {
                "trackNumber": tid,
                "side": "unknown",  # separar equipas é fase futura; inventar um lado seria pior
                "firstMs": first_ms,
                "lastMs": last_ms,
                "frameCount": len(points),
                "trackConfidence": track_conf,
                "dataKey": POSITIONS_KEY,
                "summary": {
                    "avgX": round(float(np.mean([p[1] for p in points])) / max(1, meta.width), 3),
                    "avgY": round(float(np.mean([p[2] for p in points])) / max(1, meta.height), 3),
                    "meanDetectionConfidence": round(float(np.mean(confs)), 3),
                    "continuity": round(continuity, 3),
                },
            },
        )

    # Uma escrita, no fim. Antes e depois dela avisa-se que ainda há vida: um
    # ficheiro de alguns megabytes numa ligação lenta chega a demorar minutos, e
    # a API repõe na fila quem passa cinco minutos sem bater o coração.
    if progress:
        progress(97)
    api.upload_json_gz(
        job["id"],
        POSITIONS_KEY,
        {
            "videoSize": [meta.width, meta.height],
            "targetFps": TARGET_FPS,
            "tracks": posicoes,
        },
    )
    if progress:
        progress(97)

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
