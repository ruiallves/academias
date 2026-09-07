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
HARD_MAX_SHORT = 1333  # o máximo que o torchvision aceita sem partir a proporção

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

# --- Recortes representativos -----------------------------------------------
#
# O vídeo é apagado quando o processamento acaba (`purge_video`), e até aqui
# não ficava um único píxel — o treinador confirmava "Track 77" às cegas, e a
# identificação (camisola, aparência) não tinha em que trabalhar. Guardam-se
# agora os melhores recortes de cada track: os frames em que o jogador está
# maior e mais nítido, que é onde um número se lê e uma camisola se vê.
#
# Vão em **folhas** (uma grelha de recortes por imagem) e não um ficheiro por
# recorte: dois mil recortes eram dois mil pedidos de URL e dois mil PUTs — o
# mesmo problema que as posições já tiveram. Dez folhas e um índice chegam.
CROPS_PER_TRACK = 3
# Largura × altura de cada recorte na folha. 128×256 é a entrada dos modelos de
# re-identificação de pessoas (OSNet e família), para a folha servir tal e qual.
CROP_TILE = (128, 256)
CROP_SHEET_COLS = 20
CROP_SHEET_ROWS = 10
# Folga à volta da caixa: os braços, a cabeça e os pés que o detector corta rente.
CROP_MARGIN = 0.15
# Abaixo disto o recorte é um borrão — nem vale o espaço na folha.
CROP_MIN_HEIGHT_PX = 24
CROPS_INDEX_KEY = "crops/index.json.gz"


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
    # tid bruto → os melhores recortes até agora: (pontuação, tsMs, caixa, jpeg).
    recortes: dict[int, list[tuple[float, int, tuple[int, int, int, int], bytes]]] = {}
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
            for k, (ts_ms, deteccoes) in enumerate(zip(lote_ts, _detect_people(model, lote_frames, device, plano))):
                detections_total += len(deteccoes)
                seguidos = tracker.update_with_detections(deteccoes)
                for xyxy, conf, tid in zip(seguidos.xyxy, seguidos.confidence, seguidos.tracker_id):
                    x1, y1, x2, y2 = (float(v) for v in xyxy)
                    tracks.setdefault(int(tid), []).append(
                        (ts_ms, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, float(conf)),
                    )
                    _guardar_recorte(recortes, int(tid), lote_frames[k], ts_ms, (x1, y1, x2, y2), float(conf))
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
    tracks, origem = _merge_fragments(tracks, meta)
    progress(96)

    # Só os tracks que vão ser gravados levam recortes — os de menos de dois
    # segundos são ruído e caem no `_summarise`.
    validos = {tid for tid, pts in tracks.items() if (pts[-1][0] - pts[0][0]) / 1000 >= MIN_TRACK_SEC}
    recortes_finais = _juntar_recortes(recortes, origem, validos)
    recortes.clear()
    crops_idx, n_folhas = _upload_crops(job, recortes_finais, progress)

    result_tracks, confidences = _summarise(job, tracks, meta, progress, crops_idx)
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
            # As alavancas de recall e a medida que as julga: quantas pessoas
            # estavam a ser seguidas, em média, em cada frame processado. Num
            # jogo de onze são ~22 se se vê tudo; 1,8 foi o número que mostrou
            # que o detector não via o jogo.
            "tiles": plano["tiles"],
            "scoreThreshold": plano["scoreThreshold"],
            "meanConcurrentTracks": round(sum(len(p) for p in tracks.values()) / max(1, frames_processed), 2),
            # Onde estão os recortes — o índice diz o resto.
            "crops": {"indexKey": CROPS_INDEX_KEY, "sheets": n_folhas, "tile": list(CROP_TILE)},
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
    # O tecto por omissão é o dos pesos (800); quem pedir mais por ambiente
    # pode ir até ao que o torchvision aguenta — é a alavanca mais simples
    # para jogadores pequenos, e paga-se em tempo, não em precisão.
    tecto = min(config.WORK_SHORT_MAX or MAX_SHORT, HARD_MAX_SHORT)
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
        # Mosaicos: 1 = frame inteiro; 2 = 2×2; 3 já é raro valer a pena.
        "tiles": max(1, min(3, config.TILES)),
        "scoreThreshold": config.SCORE_THRESHOLD,
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
) -> tuple[dict[int, list[tuple[int, float, float, float, float, float]]], dict[int, int]]:
    """Cola fragmentos que são, quase de certeza, o mesmo jogador.

    O critério é físico, não estatístico: o segundo fragmento começa **depois**
    de o primeiro acabar, dentro de `MERGE_GAP_SEC`, a uma distância que um
    jogador percorre nesse tempo, e com um tamanho de caixa parecido. Nada
    disto identifica ninguém — só reconhece que duas metades de uma trajectória
    são uma trajectória.

    Percorre-se por ordem de início e só se comparam cadeias ainda "abertas"
    (as que acabaram há pouco), por isso o custo é praticamente linear mesmo
    com dez mil fragmentos.

    Devolve também **de onde veio cada cadeia** (tid bruto → número final): os
    recortes foram guardados por tid bruto durante a detecção, e é este mapa
    que os leva ao track a que passaram a pertencer.
    """
    if not tracks:
        return tracks, {}

    largura = max(1, meta.width)
    gap_ms = MERGE_GAP_SEC * 1000
    # Quanto um jogador pode deslocar-se por milissegundo, em píxeis.
    vel_px_ms = MERGE_SPEED_FRAC * largura / 1000

    ordenados = sorted(tracks.items(), key=lambda kv: kv[1][0][0])
    cadeias: list[list[tuple[int, float, float, float, float, float]]] = []
    # (índice da cadeia, ts do fim, x, y, altura) — só das que ainda podem receber.
    abertas: list[tuple[int, int, float, float, float]] = []
    origem: dict[int, int] = {}

    for tid, pontos in ordenados:
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

        origem[tid] = idx
        ts_f, x_f, y_f, _w2, h_f, _c2 = cadeias[idx][-1]
        abertas.append((idx, ts_f, x_f, y_f, h_f))

    # Numeração nova e estável: pela ordem em que entram em campo.
    return {i + 1: pontos for i, pontos in enumerate(cadeias)}, {tid: idx + 1 for tid, idx in origem.items()}


def _load_detector(device: str, plano: dict[str, Any]):
    """O detector, na resolução de trabalho decidida. Ambos BSD-3, pesos COCO."""
    det = torchvision.models.detection

    if plano["detector"] == "ssdlite":
        # Um passo só: muito mais rápido, e mais fraco com jogadores sobrepostos
        # — que num jogo são muitos. Existe para quando o tempo manda.
        model = det.ssdlite320_mobilenet_v3_large(
            weights=det.SSDLite320_MobileNet_V3_Large_Weights.DEFAULT,
            score_thresh=config.SCORE_THRESHOLD,
        )
    elif device == "cuda":
        model = det.fasterrcnn_resnet50_fpn_v2(
            weights=det.FasterRCNN_ResNet50_FPN_V2_Weights.DEFAULT,
            box_score_thresh=config.SCORE_THRESHOLD,
            min_size=plano["short"],
            max_size=plano["maxSize"],
        )
    else:
        model = det.fasterrcnn_mobilenet_v3_large_fpn(
            weights=det.FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT,
            box_score_thresh=config.SCORE_THRESHOLD,
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


def _tile_grid(h: int, w: int, n: int, overlap: float = 0.12) -> list[tuple[int, int, int, int]]:
    """n×n janelas com folga entre elas, em (x1, y1, x2, y2) do frame.

    A folga é o que impede um jogador na fronteira de ficar cortado ao meio
    nas duas janelas e não ser visto em nenhuma; a supressão de não-máximos a
    seguir junta o que aparece nas duas.
    """
    janelas = []
    th, tw = h / n, w / n
    oh, ow = th * overlap, tw * overlap
    for r in range(n):
        for c in range(n):
            y1, y2 = max(0, int(r * th - oh)), min(h, int((r + 1) * th + oh))
            x1, x2 = max(0, int(c * tw - ow)), min(w, int((c + 1) * tw + ow))
            janelas.append((x1, y1, x2, y2))
    return janelas


@torch.inference_mode() if _DEPS else (lambda f: f)
def _detect_people(model, frames_bgr: list[np.ndarray], device: str, plano: dict[str, Any]) -> list["sv.Detections"]:
    """Um lote de frames → uma lista de detecções, na mesma ordem.

    Com `tiles > 1` cada frame vai ao detector em mosaicos: uma janela de meio
    frame, levada à resolução de trabalho, dá a cada jogador o dobro dos
    píxeis — que é a diferença entre ver e não ver quem está longe da câmara.
    As caixas voltam às coordenadas do frame e a supressão de não-máximos
    (torchvision, BSD-3) trata das que a folga fez aparecer duas vezes.
    """
    n = int(plano.get("tiles") or 1)
    lote: list[Any] = []
    # (índice do frame, deslocamento x, deslocamento y) de cada entrada do lote.
    origem: list[tuple[int, int, int]] = []
    for k, frame in enumerate(frames_bgr):
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        if n <= 1:
            lote.append(torch.from_numpy(rgb).permute(2, 0, 1).to(device, non_blocking=True).float().div_(255))
            origem.append((k, 0, 0))
            continue
        for x1, y1, x2, y2 in _tile_grid(rgb.shape[0], rgb.shape[1], n):
            janela = np.ascontiguousarray(rgb[y1:y2, x1:x2])
            lote.append(torch.from_numpy(janela).permute(2, 0, 1).to(device, non_blocking=True).float().div_(255))
            origem.append((k, x1, y1))

    with torch.autocast(device_type=device, dtype=torch.float16, enabled=plano["half"]):
        saidas = model(lote)

    por_frame: list[list[tuple[Any, Any]]] = [[] for _ in frames_bgr]
    for (k, dx, dy), out in zip(origem, saidas):
        # COCO: classe 1 = pessoa. O resto (bancos, bolas de outra classe) sai já aqui.
        keep = out["labels"] == 1
        boxes = out["boxes"][keep].float()
        scores = out["scores"][keep].float()
        if dx or dy:
            boxes = boxes + torch.tensor([dx, dy, dx, dy], device=boxes.device, dtype=boxes.dtype)
        por_frame[k].append((boxes, scores))

    resultados: list["sv.Detections"] = []
    for partes in por_frame:
        if not partes:
            resultados.append(sv.Detections.empty())
            continue
        boxes = torch.cat([b for b, _ in partes])
        scores = torch.cat([s for _, s in partes])
        if n > 1 and len(boxes) > 1:
            keep = torchvision.ops.nms(boxes, scores, iou_threshold=0.5)
            boxes, scores = boxes[keep], scores[keep]
        b = boxes.cpu().numpy()
        s = scores.cpu().numpy()
        resultados.append(
            sv.Detections(
                xyxy=b.reshape(-1, 4),
                confidence=s,
                class_id=np.zeros(len(s), dtype=int),
            ),
        )
    return resultados


POSITIONS_KEY = "tracks/positions.json.gz"


# ---------------------------------------------------------------------------
# Recortes
# ---------------------------------------------------------------------------


def _guardar_recorte(
    recortes: dict[int, list[tuple[float, int, tuple[int, int, int, int], bytes]]],
    tid: int,
    frame: np.ndarray,
    ts_ms: int,
    xyxy: tuple[float, float, float, float],
    conf: float,
) -> None:
    """Guarda este recorte se estiver entre os melhores do track.

    "Melhor" é altura da caixa × confiança: o frame em que o jogador ocupa mais
    píxeis e o detector menos duvida — que é onde um número de camisola se lê.
    Guardam-se os bytes JPEG e não os píxeis: dez mil tracks brutos com três
    recortes de 128×256 em memória crua eram mais de um gigabyte.
    """
    x1, y1, x2, y2 = xyxy
    altura = y2 - y1
    if altura < CROP_MIN_HEIGHT_PX:
        return
    pontuacao = float(altura) * conf
    lista = recortes.get(tid)
    if lista is not None and len(lista) >= CROPS_PER_TRACK and pontuacao <= lista[-1][0]:
        return  # não bate o pior dos guardados — nem vale a pena codificar

    h_img, w_img = frame.shape[:2]
    mx, my = (x2 - x1) * CROP_MARGIN, altura * CROP_MARGIN
    ax, ay = max(0, int(x1 - mx)), max(0, int(y1 - my))
    bx, by = min(w_img, int(x2 + mx)), min(h_img, int(y2 + my))
    if bx - ax < 4 or by - ay < 8:
        return
    ok, jpeg = cv2.imencode(".jpg", frame[ay:by, ax:bx], [cv2.IMWRITE_JPEG_QUALITY, 88])
    if not ok:
        return

    novo = (pontuacao, ts_ms, (ax, ay, bx - ax, by - ay), jpeg.tobytes())
    if lista is None:
        recortes[tid] = [novo]
        return
    lista.append(novo)
    lista.sort(key=lambda r: r[0], reverse=True)
    del lista[CROPS_PER_TRACK:]


def _juntar_recortes(
    recortes: dict[int, list[tuple[float, int, tuple[int, int, int, int], bytes]]],
    origem: dict[int, int],
    validos: set[int],
) -> dict[int, list[tuple[float, int, tuple[int, int, int, int], bytes]]]:
    """Dos tids brutos aos tracks finais: os melhores de cada cadeia, espalhados no tempo.

    Três recortes do mesmo segundo dizem menos do que três de momentos
    diferentes — um jogador de costas, de frente e de lado. Por isso escolhe-se
    o melhor, e depois os melhores **a mais de dez segundos** dos já escolhidos,
    voltando aos restantes se não houver espalhamento que chegue.
    """
    por_final: dict[int, list[tuple[float, int, tuple[int, int, int, int], bytes]]] = {}
    for tid, lista in recortes.items():
        final = origem.get(tid)
        if final is None or final not in validos:
            continue
        por_final.setdefault(final, []).extend(lista)

    for final, lista in por_final.items():
        lista.sort(key=lambda r: r[0], reverse=True)
        escolhidos: list[tuple[float, int, tuple[int, int, int, int], bytes]] = []
        for r in lista:
            if len(escolhidos) >= CROPS_PER_TRACK:
                break
            if all(abs(r[1] - e[1]) >= 10_000 for e in escolhidos):
                escolhidos.append(r)
        for r in lista:
            if len(escolhidos) >= CROPS_PER_TRACK:
                break
            if r not in escolhidos:
                escolhidos.append(r)
        escolhidos.sort(key=lambda r: r[1])  # por ordem de tempo, para quem os lê
        por_final[final] = escolhidos
    return por_final


def _encaixar(jpeg: bytes) -> np.ndarray:
    """Um recorte no tamanho do azulejo, com a proporção guardada e fundo neutro."""
    tw, th = CROP_TILE
    img = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
    azulejo = np.full((th, tw, 3), 38, dtype=np.uint8)  # cinzento escuro, não preto: lê-se onde acaba
    if img is None or img.size == 0:
        return azulejo
    h, w = img.shape[:2]
    escala = min(tw / w, th / h)
    nw, nh = max(1, int(w * escala)), max(1, int(h * escala))
    # Ampliar com interpolação suave; reduzir com área — cada uma é a certa no seu sentido.
    interp = cv2.INTER_CUBIC if escala > 1 else cv2.INTER_AREA
    red = cv2.resize(img, (nw, nh), interpolation=interp)
    ox, oy = (tw - nw) // 2, (th - nh) // 2
    azulejo[oy : oy + nh, ox : ox + nw] = red
    return azulejo


def _upload_crops(
    job: dict[str, Any],
    recortes: dict[int, list[tuple[float, int, tuple[int, int, int, int], bytes]]],
    progress: Callable[[int], None],
) -> tuple[dict[int, list[dict[str, Any]]], int]:
    """Monta as folhas, sobe-as, e devolve onde ficou cada recorte.

    Uma folha é uma grelha de `CROP_SHEET_COLS × CROP_SHEET_ROWS` azulejos; o
    índice diz, para cada track, em que folha e posição estão os seus. Quem lê
    (a consola, a etapa de identificação) pede a folha e recorta — nunca um
    ficheiro por jogador.
    """
    if not recortes:
        return {}, 0

    tw, th = CROP_TILE
    por_folha = CROP_SHEET_COLS * CROP_SHEET_ROWS
    indice: dict[int, list[dict[str, Any]]] = {}
    folha = np.full((th * CROP_SHEET_ROWS, tw * CROP_SHEET_COLS, 3), 38, dtype=np.uint8)
    n_folha, pos = 0, 0

    def fechar_folha() -> None:
        nonlocal folha, n_folha, pos
        if pos == 0:
            return
        ok, jpeg = cv2.imencode(".jpg", folha, [cv2.IMWRITE_JPEG_QUALITY, 86])
        if not ok:
            raise RuntimeError("Não foi possível codificar uma folha de recortes")
        api.upload_bytes(job["id"], f"crops/sheet-{n_folha:03d}.jpg", jpeg.tobytes(), "image/jpeg")
        progress(97)  # cada folha é uma ida à rede; a API não pode achar-nos mortos
        n_folha += 1
        pos = 0
        folha = np.full((th * CROP_SHEET_ROWS, tw * CROP_SHEET_COLS, 3), 38, dtype=np.uint8)

    for tid in sorted(recortes):
        for _pont, ts_ms, box, jpeg in recortes[tid]:
            r, c = divmod(pos, CROP_SHEET_COLS)
            folha[r * th : (r + 1) * th, c * tw : (c + 1) * tw] = _encaixar(jpeg)
            indice.setdefault(tid, []).append({"s": n_folha, "i": pos, "ts": ts_ms, "box": list(box)})
            pos += 1
            if pos >= por_folha:
                fechar_folha()
    fechar_folha()

    api.upload_json_gz(
        job["id"],
        CROPS_INDEX_KEY,
        {
            "tile": [tw, th],
            "cols": CROP_SHEET_COLS,
            "rows": CROP_SHEET_ROWS,
            "sheets": n_folha,
            "tracks": {str(tid): lista for tid, lista in indice.items()},
        },
    )
    return indice, n_folha


def _summarise(
    job: dict[str, Any],
    tracks: dict[int, list[tuple[int, float, float, float, float, float]]],
    meta: videolib.VideoMeta,
    progress: Callable[[int], None] | None = None,
    crops_idx: dict[int, list[dict[str, Any]]] | None = None,
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
                    # Onde estão os recortes deste track nas folhas: {s: folha, i: posição, ts, box}.
                    # No `summary` e não numa coluna — é leitura, e muda quando a etapa mudar.
                    **({"crops": crops_idx[tid]} if crops_idx and tid in crops_idx else {}),
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
