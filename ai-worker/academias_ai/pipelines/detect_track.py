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
1
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

import queue
import threading
import time
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
    camara = CameraMotion()
    pessoas = PersonRegistry(meta)
    equipas = TeamClassifier()
    bola = BallTracker(meta)
    # A bola vista, frame a frame: (tsMs, x, y, confiança[, X, Y em metros]). Só quando vista.
    bola_vista: list[list[float | None]] = []
    # O campo em metros, quando o treinador o calibrar — pode ser a meio do jogo.
    campo = PitchTracker(meta)
    campo.set_calibration(job.get("analysis", {}).get("calibration"))
    # As posições em metros por pessoa: (tsMs, X, Y). Só quando há calibração.
    metros: dict[int, list[tuple[int, float, float]]] = {}

    stride = max(1, round(meta.fps / TARGET_FPS))
    tracks: dict[int, list[tuple[int, float, float, float, float, float]]] = {}
    # tid bruto → os melhores recortes até agora: (pontuação, tsMs, caixa, jpeg).
    recortes: dict[int, list[tuple[float, int, tuple[int, int, int, int], bytes]]] = {}
    frames_processed = 0
    detections_total = 0
    # O vídeo a correr: as caixas vão à API aos troços, enquanto o resto se processa.
    feed = _LiveFeed(job["id"], meta) if config.LIVE_SEGMENT_SEC > 0 else None

    try:
        # A GPU vai um lote à frente (ver `_pipeline`); aqui trata-se de um frame
        # de cada vez, pela ordem do vídeo.
        for index, ts_ms, frame, deteccoes, bolas in _pipeline(_frames(video_path, stride, meta.fps), model, device, plano, plano["batch"]):
            detections_total += len(deteccoes)
            # A câmara mexeu-se? Antes de associar, os tracks (e as pessoas
            # perdidas há pouco) seguem-na.
            m = camara.compensate(frame, tracker)
            pessoas.move(m)
            bola.move(m)
            campo.observe(ts_ms, m, camara.falhas)
            # A calibração pode chegar a meio, pelo heartbeat.
            campo.set_calibration((job.get("live") or {}).get("calibration"))
            seguidos = tracker.update_with_detections(deteccoes)
            camara.remember(deteccoes)
            caixas_vivas: list[list[float | None]] = []
            caixas_pessoas: list[tuple[float, float, float, float]] = []
            # Do fragmento do tracker à pessoa: é o número que o ecrã mostra.
            for pid, (x1, y1, x2, y2), conf in pessoas.assign(frame, ts_ms, seguidos, equipas.group_of):
                tracks.setdefault(pid, []).append(
                    (ts_ms, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, conf),
                )
                _guardar_recorte(recortes, pid, frame, ts_ms, (x1, y1, x2, y2), conf)
                # Onde está no campo, em metros (pelos pés), e se está dentro das linhas.
                posicao = campo.to_pitch(ts_ms, (x1 + x2) / 2, y2)
                dentro = posicao is None or campo.inside(posicao)
                if posicao is not None:
                    metros.setdefault(pid, []).append((ts_ms, posicao[0], posicao[1]))
                # A cor do equipamento não muda em 200 ms: de 3 em 3 frames chega,
                # e são 17 recortes a menos por frame na CPU. Quem está fora das
                # linhas (bancada, apanha-bolas) não entra nas equipas.
                if dentro and (frames_processed + pid) % 3 == 0:
                    equipas.observe(pid, frame, (x1, y1, x2, y2))
                if dentro:
                    caixas_pessoas.append((x1, y1, x2, y2))
                caixas_vivas.append([
                    pid, round(x1), round(y1), round(x2), round(y2), round(conf, 2), equipas.group_code(pid),
                    None if posicao is None else round(posicao[0], 1), None if posicao is None else round(posicao[1], 1),
                ])
            equipas.refresh(ts_ms)
            # O segundo olhar: a bola em alta resolução, numa janela à volta
            # de onde ela estava — ou dos jogadores, quando não se vê. Com a
            # bola localizada chega de três em três frames (a memória do
            # tracker cobre 1,5 s); perdida, de dois em dois. Cada olhar é
            # uma inferência, e nesta placa cada inferência conta.
            passo = 3 if bola.where() is not None else 2
            if frames_processed % passo == 0:
                bolas = bolas + _ball_zoom(model, frame, device, plano, bola.where(), caixas_pessoas)
            # Uma bola fora das linhas é de reserva, e com o campo calibrado sabe-se.
            bolas = [c for c in bolas if campo.inside_image(ts_ms, c[0], c[1])]
            ponto = bola.update(ts_ms, bolas, caixas_pessoas)
            bola_metros = None if ponto is None else campo.to_pitch(ts_ms, ponto[0], ponto[1])
            if ponto is not None:
                bola_vista.append([
                    ts_ms, round(ponto[0]), round(ponto[1]), round(ponto[2], 2),
                    None if bola_metros is None else round(bola_metros[0], 1),
                    None if bola_metros is None else round(bola_metros[1], 1),
                ])
            frames_processed += 1
            if feed is not None:
                feed.add(
                    ts_ms, caixas_vivas, frames_processed, detections_total, len(tracks),
                    ball=None if ponto is None else [
                        round(ponto[0]), round(ponto[1]), round(ponto[2], 2),
                        None if bola_metros is None else round(bola_metros[0], 1),
                        None if bola_metros is None else round(bola_metros[1], 1),
                    ],
                    teams=equipas.palette(),
                    # Quantas o detector viu neste frame — contra as que o tracker
                    # devolveu, é o número que diz onde se perdem jogadores.
                    detected=len(deteccoes),
                    camera_lost=camara.falhas,
                    pitch=campo.status(),
                )
            if frames_processed % 40 == 0:
                progress(int(95 * index / meta.frame_count))
    finally:
        if feed is not None:
            feed.close()

    if frames_processed == 0:
        raise RuntimeError("Nenhum frame processado — o vídeo pode estar corrompido")

    brutos = len(tracks)
    tracks, origem = _merge_fragments(tracks, meta, equipas.group_of)
    progress(96)

    # Só os tracks que vão ser gravados levam recortes — os de menos de dois
    # segundos são ruído e caem no `_summarise`.
    validos = {tid for tid, pts in tracks.items() if (pts[-1][0] - pts[0][0]) / 1000 >= MIN_TRACK_SEC}
    recortes_finais = _juntar_recortes(recortes, origem, validos)
    recortes.clear()
    crops_idx, n_folhas = _upload_crops(job, recortes_finais, progress)

    # A equipa de cada track final: a da pessoa com mais pontos entre as que o compõem.
    grupo_final: dict[int, dict[str, Any]] = {}
    for pid, final in origem.items():
        grupo = equipas.group_of(pid)
        peso = len(tracks.get(final, []))
        if grupo and (final not in grupo_final or peso > grupo_final[final]["peso"]):
            grupo_final[final] = {"peso": peso, "kitGroup": grupo, "kitColor": equipas.person_color(pid)}
    # As posições em metros seguem a numeração final, como as posições em píxeis.
    metros_final: dict[int, list[tuple[int, float, float]]] = {}
    for pid, final in origem.items():
        if pid in metros:
            metros_final.setdefault(final, []).extend(metros[pid])
    for lista in metros_final.values():
        lista.sort()
    result_tracks, confidences = _summarise(
        job, tracks, meta, progress, crops_idx, grupo_final, bola_vista, equipas.palette(),
        metros=metros_final, pitch=campo.status(),
    )
    progress(98)

    cobertura = round(len(bola_vista) / max(1, frames_processed), 3)
    return {
        "tracks": result_tracks,
        "confidence": {
            "player_tracking": _overall_confidence(confidences, frames_processed, detections_total),
            # A bola só vale o tempo em que foi vista: a cobertura é a confiança.
            "ball_tracking": cobertura,
        },
        "ballTracking": {"status": "detected", "coverage": cobertura, "frames": len(bola_vista)},
        "teams": equipas.palette(),
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
# Os frames e a GPU um lote à frente
# ---------------------------------------------------------------------------


def _frames(video_path: Path, stride: int, fps: float):
    """Os frames que vão ao detector, pela ordem do vídeo: `(índice, tsMs, frame)`.

    `grab()` descodifica sem converter nem devolver — é o que torna barato
    saltar cinco frames em cada seis. Só o que vai ao detector paga a
    conversão, com `retrieve()`.
    """
    cap = cv2.VideoCapture(str(video_path))
    try:
        index = 0
        while cap.grab():
            if index % stride == 0:
                ok, frame = cap.retrieve()
                if ok and frame is not None:
                    yield index, int(index / fps * 1000), frame
            index += 1
    finally:
        cap.release()


def _pipeline(frames, model, device: str, plano: dict[str, Any], batch: int):
    """A detecção numa thread, um lote à frente de quem consome.

    ## Porque é que existe

    Medido nesta máquina (RTX 5050 de portátil): um lote de oito frames custa
    600 ms quando a GPU está sempre ocupada e 1 300 ms quando, entre lotes, a
    CPU trata do tracker durante uns milissegundos — a placa baixa o relógio
    no intervalo e cada chamada arranca lenta. A GPU não pode esperar pela
    CPU: a detecção do lote seguinte corre aqui, numa thread, enquanto o
    consumidor trata do lote actual (tracker, pessoas, equipas, o olhar à
    bola). As filas têm dois lugares: um lote à frente chega, e dois lotes de
    frames de 1080p em memória são o preço.

    Devolve, pela ordem do vídeo, `(índice, tsMs, frame, pessoas, candidatas a
    bola)`. Um erro na thread sobe aqui, para o job falhar como deve.
    """
    fila_in: queue.Queue[list[tuple[int, int, np.ndarray]] | None] = queue.Queue(maxsize=2)
    fila_out: queue.Queue[tuple[list[tuple[int, int, np.ndarray]], list] | None] = queue.Queue(maxsize=2)
    erro: list[BaseException] = []

    def gpu() -> None:
        try:
            while True:
                lote = fila_in.get()
                if lote is None:
                    break
                fila_out.put((lote, _detect_people(model, [f for _i, _t, f in lote], device, plano)))
        except BaseException as e:  # noqa: BLE001 — a fronteira da thread reporta tudo
            erro.append(e)
        fila_out.put(None)

    threading.Thread(target=gpu, name="detector", daemon=True).start()
    it = iter(frames)
    acabou = False
    sentinela_enviada = False
    while True:
        # Enche a fila de entrada **sem bloquear**: a descodificação acontece
        # aqui, enquanto a GPU trabalha no lote anterior. Nunca se faz um `put`
        # com a fila cheia — a thread pode estar à espera que se consuma a
        # saída, e os dois à espera um do outro era o fim do job.
        while not fila_in.full():
            if acabou:
                if not sentinela_enviada:
                    fila_in.put(None)
                    sentinela_enviada = True
                break
            lote = []
            for _ in range(batch):
                try:
                    lote.append(next(it))
                except StopIteration:
                    acabou = True
                    break
            if lote:
                fila_in.put(lote)
        item = fila_out.get()
        if item is None:
            if erro:
                raise erro[0]
            return
        lote, resultados = item
        for (index, ts_ms, frame), (deteccoes, bolas) in zip(lote, resultados):
            yield index, ts_ms, frame, deteccoes, bolas


# ---------------------------------------------------------------------------
# O vídeo a correr
# ---------------------------------------------------------------------------


class _LiveFeed:
    """As caixas de cada frame, aos troços, para a consola enquanto se processa.

    ## Porque é que existe

    Um jogo demorava uma barra de progresso inteira — quarenta minutos a duas
    horas sem um píxel para ver. A detecção já produz, frame a frame, tudo o
    que a consola precisa para desenhar; só não o largava antes do fim. Agora
    larga: de `LIVE_SEGMENT_SEC` em `LIVE_SEGMENT_SEC` segundos de vídeo vai
    um troço à API, e quem está a ver o jogo vê a IA a acompanhá-lo.

    ## O que vai, e o que não vai

    Vão os **tids brutos** do tracker, tal como saem — a junção de fragmentos
    e a numeração final só existem no fim, e esperar por elas era esperar pelo
    fim. A consola sabe disso: ao vivo são "pessoas em campo", não nomes; os
    nomes chegam com a identificação, pelos dados de sempre.

    ## Numa thread própria, e sem segurar a GPU

    O pedido à API repete-se com recuo quando a rede falha (ver `api.py`); feito
    na thread da detecção, esses segundos eram a GPU parada. A fila entre as
    duas tem tecto: se a API ficar muda, perdem-se troços ao vivo e a detecção
    não abranda. O resultado final não passa por aqui.
    """

    MAX_PENDENTES = 20

    def __init__(self, job_id: str, meta: videolib.VideoMeta) -> None:
        self.job_id = job_id
        self.video = [meta.width, meta.height]
        self.span_ms = int(config.LIVE_SEGMENT_SEC * 1000)
        self.frames: list[list[Any]] = []
        self.index = 0
        self.inicio = time.monotonic()
        self.stats: dict[str, Any] = {}
        self.fila: queue.Queue[dict[str, Any] | None] = queue.Queue(maxsize=self.MAX_PENDENTES)
        self.thread = threading.Thread(target=self._enviar, name="live-feed", daemon=True)
        self.thread.start()

    def add(
        self, ts_ms: int, caixas: list[list[float]], frames: int, detections: int, tracks_open: int,
        ball: list[float | None] | None = None, teams: dict[str, Any] | None = None,
        detected: int = 0, camera_lost: int = 0, pitch: dict[str, Any] | None = None,
    ) -> None:
        # [ts, caixas, bola, detectadas]: a bola é [x, y, conf, X, Y] ou nula
        # quando não foi vista (X, Y em metros, nulos sem calibração);
        # `detectadas` é quantas pessoas o detector viu neste frame, para o
        # ecrã dizer onde o tracker as perde. Cada caixa leva os metros no fim.
        self.frames.append([ts_ms, caixas, ball, detected])
        self.teams = teams or {}
        self.stats = {
            "framesProcessed": frames,
            "detections": detections,
            "tracksOpen": tracks_open,
            "elapsedSec": round(time.monotonic() - self.inicio, 1),
            "processedMs": ts_ms,
            # Quantas vezes a compensação de câmara não conseguiu medir o movimento.
            "cameraLost": camera_lost,
            # O estado da calibração do campo: se existe, e se se perdeu num corte.
            "pitch": pitch or {},
        }
        if ts_ms - self.frames[0][0] >= self.span_ms:
            self._flush()

    def _flush(self) -> None:
        if not self.frames:
            return
        troco = {
            "index": self.index,
            "fromMs": self.frames[0][0],
            "toMs": self.frames[-1][0],
            "video": self.video,
            "frames": self.frames,
            "stats": self.stats,
            # As cores das duas equipas (e dos outros), para o ecrã pintar e para
            # o treinador dizer qual é a nossa.
            "teams": getattr(self, "teams", {}),
        }
        self.index += 1
        self.frames = []
        try:
            self.fila.put_nowait(troco)
        except queue.Full:
            print(f"[live] a API não acompanha — troço {troco['index']} descartado")

    def close(self) -> None:
        """O resto, e espera-se um pouco por ele — não para sempre."""
        self._flush()
        self.fila.put(None)
        self.thread.join(timeout=30)

    def _enviar(self) -> None:
        while True:
            troco = self.fila.get()
            if troco is None:
                return
            api.send_live_segment(self.job_id, troco)


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
    # Dois parâmetros que mentiam, medidos a 07/10/2026 num troço de 60 s do
    # jogo de 111 minutos: o detector via 17,8 pessoas por frame, o tracker
    # devolvia 11,5 e abria **823 tracks num minuto**. Era daqui que vinham os
    # 8 600 tracks por jogo, e não do detector.
    #
    # 1. `lost_track_buffer` é em frames **a 30 FPS**: a `supervision` faz
    #    `max_time_lost = frame_rate / 30 × buffer`. Com `frame_rate=5` e um
    #    buffer de 10, um track perdido morria ao fim de **um** frame. A memória
    #    quer-se em segundos, e a conta é esta.
    # 2. `minimum_matching_threshold` é uma distância (1 − IoU), não uma
    #    sobreposição: baixá-lo de 0,8 para 0,5 **apertou** a associação em vez
    #    de a abrir. A 5 FPS um jogador a correr sobrepõe-se pouco ao próprio
    #    frame anterior; 0,9 aceita IoU a partir de 0,1.
    try:
        return sv.ByteTrack(
            frame_rate=int(TARGET_FPS),
            lost_track_buffer=int(MERGE_GAP_SEC * 30),
            minimum_matching_threshold=0.9,
            # Uma detecção fraca ainda vale para continuar um track existente.
            # Um track novo nasce a partir de 0,4 (a biblioteca soma 0,1): com o
            # detector a 0,4, um jogador pequeno ao fundo, visto com pouca
            # certeza, ainda abre o seu track em vez de só poder continuar os
            # dos outros.
            track_activation_threshold=0.3,
        )
    except TypeError:
        return sv.ByteTrack(frame_rate=int(TARGET_FPS))


class CameraMotion:
    """Compensação do movimento da câmara — o que falta ao ByteTrack num jogo filmado à mão.

    ## O problema

    A câmara destes jogos não é fixa: faz panorâmicas atrás da bola e aproxima
    e afasta. O ByteTrack prevê onde cada jogador vai estar pelo movimento
    **dele**; quando a câmara roda, todas as caixas saltam de uma vez, a
    previsão falha para toda a gente, e o tracker abre vinte identidades novas
    num frame. Era a maior fonte de fragmentos num jogo real (ver a nota em
    `_build_tracker`), e nenhum limiar a resolve — é um movimento que não está
    no modelo.

    ## O que se faz

    O que o BoT-SORT chama *global motion compensation*: entre dois frames
    processados estima-se a transformação do **fundo** (relva, linhas, bancadas)
    por fluxo óptico de cantos — com os jogadores do frame anterior tapados por
    uma máscara, porque esses mexem-se por conta própria — e aplica-se essa
    transformação ao estado de Kalman de cada track antes de associar. A
    previsão volta a estar onde o jogador está. Uma semelhança (deslocamento +
    rotação + escala) chega: uma panorâmica é um deslocamento, o zoom é uma
    escala.

    Tudo em OpenCV (Apache-2.0), num frame reduzido a 640 px: uns milissegundos
    por frame, contra os 75 da detecção. Quando não há cantos que cheguem (um
    frame todo relva) fica a identidade, que é o comportamento de antes.
    """

    # 512 px e 250 cantos: medido, chega para uma panorâmica e custa metade de
    # 640 com 400 — e isto corre na CPU, em série com a GPU, a cada frame.
    WIDTH = 512
    MIN_POINTS = 24
    MAX_CORNERS = 250

    def __init__(self) -> None:
        self.prev: np.ndarray | None = None
        self.scale = 1.0  # frame reduzido → frame inteiro
        self.mask: np.ndarray | None = None
        # Quantas vezes não se conseguiu medir o movimento (poucos cantos, RANSAC
        # sem consenso). Um corte de câmara dá aqui, e é onde o tracker perde gente.
        self.falhas = 0

    def _reduce(self, frame: np.ndarray) -> np.ndarray:
        h, w = frame.shape[:2]
        self.scale = w / self.WIDTH
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return cv2.resize(gray, (self.WIDTH, int(round(h / self.scale))), interpolation=cv2.INTER_AREA)

    def remember(self, detections: "sv.Detections") -> None:
        """As caixas deste frame tapam-se no próximo: um jogador não é fundo."""
        if self.prev is None:
            return
        mask = np.full(self.prev.shape, 255, dtype=np.uint8)
        for x1, y1, x2, y2 in detections.xyxy:
            cv2.rectangle(
                mask,
                (int(x1 / self.scale) - 4, int(y1 / self.scale) - 4),
                (int(x2 / self.scale) + 4, int(y2 / self.scale) + 4),
                0,
                -1,
            )
        self.mask = mask

    def estimate(self, frame: np.ndarray) -> np.ndarray | None:
        """A transformação 2×3 do frame anterior para este, em píxeis do frame inteiro. `None` = sem movimento medível."""
        gray = self._reduce(frame)
        prev, self.prev = self.prev, gray
        if prev is None or prev.shape != gray.shape:
            return None

        pontos = cv2.goodFeaturesToTrack(prev, maxCorners=self.MAX_CORNERS, qualityLevel=0.01, minDistance=10, mask=self.mask)
        if pontos is None or len(pontos) < self.MIN_POINTS:
            self.falhas += 1
            return None
        seguidos, status, _ = cv2.calcOpticalFlowPyrLK(prev, gray, pontos, None, winSize=(15, 15), maxLevel=3)
        ok = status.reshape(-1) == 1
        if ok.sum() < self.MIN_POINTS:
            self.falhas += 1
            return None
        matriz, inliers = cv2.estimateAffinePartial2D(
            pontos[ok], seguidos[ok], method=cv2.RANSAC, ransacReprojThreshold=3.0, maxIters=500,
        )
        if matriz is None or inliers is None or int(inliers.sum()) < self.MIN_POINTS:
            self.falhas += 1
            return None
        # A parte linear não depende da escala do frame; o deslocamento sim.
        matriz = matriz.astype(np.float64)
        matriz[:, 2] *= self.scale
        return matriz

    def compensate(self, frame: np.ndarray, tracker: "sv.ByteTrack") -> np.ndarray | None:
        """Move os tracks abertos (e os perdidos há pouco) com a câmara. Devolve a transformação aplicada."""
        m = self.estimate(frame)
        if m is None:
            return None
        a, b, tx = m[0]
        c, d, ty = m[1]
        # Deslocamento sem rotação nem zoom perceptíveis: não vale a pena tocar.
        if abs(tx) < 0.5 and abs(ty) < 0.5 and abs(a - 1) < 1e-3 and abs(b) < 1e-3:
            return None
        escala = float(np.hypot(a, b))
        for track in list(tracker.tracked_tracks) + list(tracker.lost_tracks):
            mean = track.mean
            if mean is None:
                continue
            cx, cy = mean[0], mean[1]
            mean[0] = a * cx + b * cy + tx
            mean[1] = c * cx + d * cy + ty
            mean[3] *= escala
            vx, vy = mean[4], mean[5]
            mean[4] = a * vx + b * vy
            mean[5] = c * vx + d * vy
        return m


class PitchTracker:
    """O campo em metros — a calibração do treinador, arrastada pela câmara.

    ## O que o treinador dá

    Num frame do vídeo (`atMs`), 4 a 6 pontos conhecidos do campo clicados na
    imagem. Daí a consola calcula `H0`: imagem nesse frame → campo em metros,
    com a origem num canto e o X ao comprimento. É tudo o que se pede a um
    humano, uma vez por jogo.

    ## O que a câmara faz a isso

    Mexe-se. A compensação de câmara já mede, frame a frame, a semelhança que
    leva o frame anterior ao actual; aqui acumula-se essa cadeia desde o início
    (`C_t`: frame 0 → frame t) e guarda-se por frame. Um ponto do frame `t`
    leva-se ao frame da calibração com `C_t0 · C_t⁻¹`, e daí ao campo com
    `H0`. Só o troço entre a calibração e agora acumula erro — e é por isso que
    a calibração pode chegar a meio do jogo e valer para trás e para a frente.

    ## O que se diz quando não se sabe

    Um corte de câmara (a compensação falha, ou um salto de um quarto do frame
    de uma vez) parte a cadeia: a calibração passa a `lost`, as posições em
    metros deixam de sair, e o ecrã pede um clique novo. Deriva lenta entre
    cortes existe e é reconhecida; a re-ancoragem nas linhas brancas é a fase
    seguinte.
    """

    # Um salto destes num frame não é uma panorâmica: é um corte.
    CUT_FRAC = 0.25
    MARGIN_M = 1.0

    def __init__(self, meta: videolib.VideoMeta) -> None:
        self.largura = max(1, meta.width)
        self.C = np.eye(3)  # frame 0 → frame actual
        self.hist: dict[int, np.ndarray] = {}  # tsMs → C nesse frame
        self.ultimo_ts: int | None = None
        self.H0: np.ndarray | None = None
        self.at_ms: int | None = None
        self.length = 105.0
        self.width = 68.0
        self.lost = False
        self.lost_at: int | None = None
        self._H_inv_cache: tuple[int, np.ndarray] | None = None
        self.calibration_id: str | None = None
        self.falhas_vistas = 0

    def set_calibration(self, calib: dict[str, Any] | None) -> None:
        """Uma calibração nova (ou a mesma outra vez — ignora-se)."""
        if not calib or not isinstance(calib, dict) or not calib.get("H"):
            return
        marca = str(calib.get("setAt") or "") + str(calib.get("atMs"))
        if marca == self.calibration_id:
            return
        try:
            H = np.asarray(calib["H"], dtype=np.float64).reshape(3, 3)
            at_ms = int(calib.get("atMs") or 0)
            pitch = calib.get("pitch") or {}
            self.length = float(pitch.get("length") or 105.0)
            self.width = float(pitch.get("width") or 68.0)
        except (ValueError, TypeError):
            return
        self.H0, self.at_ms, self.calibration_id = H, at_ms, marca
        # Uma calibração nova apaga um corte antigo: o treinador clicou depois dele.
        self.lost = False
        self.lost_at = None
        self._H_inv_cache = None

    def observe(self, ts_ms: int, m: np.ndarray | None, falhas: int) -> None:
        """Acumula o movimento da câmara deste frame."""
        if m is not None:
            a, b, tx = m[0]
            c, d, ty = m[1]
            # Um salto de um quarto do frame num só frame: corte, não panorâmica.
            if abs(tx) > self.CUT_FRAC * self.largura or abs(ty) > self.CUT_FRAC * self.largura:
                self._cut(ts_ms)
            else:
                self.C = np.array([[a, b, tx], [c, d, ty], [0.0, 0.0, 1.0]]) @ self.C
        elif falhas > self.falhas_vistas and self.ultimo_ts is not None:
            # A compensação não conseguiu medir: pode ser relva lisa, pode ser
            # um corte. Sem o saber, assume-se identidade — e conta-se.
            pass
        self.falhas_vistas = falhas
        self.hist[ts_ms] = self.C.copy()
        self.ultimo_ts = ts_ms

    def _cut(self, ts_ms: int) -> None:
        if self.H0 is not None and self.at_ms is not None and ts_ms > self.at_ms:
            self.lost = True
            self.lost_at = ts_ms
        self.C = np.eye(3)
        self.hist.clear()

    def _H_at(self, ts_ms: int) -> np.ndarray | None:
        """Imagem no frame `ts_ms` → campo em metros, ou nada."""
        if self.H0 is None or self.at_ms is None or self.lost:
            return None
        if self._H_inv_cache is not None and self._H_inv_cache[0] == ts_ms:
            return self._H_inv_cache[1]
        C_t = self.hist.get(ts_ms)
        # O frame da calibração: o mais perto que se tem registado.
        C_t0 = self.hist.get(self.at_ms)
        if C_t0 is None and self.hist:
            chave = min(self.hist, key=lambda k: abs(k - self.at_ms))
            if abs(chave - self.at_ms) <= 1500:
                C_t0 = self.hist[chave]
        if C_t0 is None:
            # O frame da calibração já não está na cadeia (um corte apagou-a,
            # ou o treinador clicou num frame de antes de um corte): perdida.
            self.lost = True
            self.lost_at = ts_ms
            return None
        if C_t is None:
            return None
        try:
            H = self.H0 @ C_t0 @ np.linalg.inv(C_t)
        except np.linalg.LinAlgError:
            return None
        self._H_inv_cache = (ts_ms, H)
        return H

    def to_pitch(self, ts_ms: int, x: float, y: float) -> tuple[float, float] | None:
        H = self._H_at(ts_ms)
        if H is None:
            return None
        p = H @ np.array([x, y, 1.0])
        if abs(p[2]) < 1e-9:
            return None
        return float(p[0] / p[2]), float(p[1] / p[2])

    def inside(self, pos: tuple[float, float]) -> bool:
        return -self.MARGIN_M <= pos[0] <= self.length + self.MARGIN_M and -self.MARGIN_M <= pos[1] <= self.width + self.MARGIN_M

    def inside_image(self, ts_ms: int, x: float, y: float) -> bool:
        """Sem calibração, tudo está "dentro" — não se corta o que não se sabe."""
        pos = self.to_pitch(ts_ms, x, y)
        return pos is None or self.inside(pos)

    def status(self) -> dict[str, Any]:
        return {
            "calibrated": self.H0 is not None,
            "lost": self.lost,
            "lostAtMs": self.lost_at,
            "length": self.length,
            "width": self.width,
        }


class PersonRegistry:
    """Do fragmento do tracker à **pessoa** — o número que o ecrã mostra.

    ## Porque é que existe

    O tracker produz fragmentos: cada oclusão, cada saída de enquadramento, cada
    panorâmica que a compensação não apanha, abre um id novo. Ao vivo o ecrã
    mostrava esses ids crus e "pessoas vistas" subia aos duzentos em dois
    minutos — um número que não quer dizer nada a quem está a ver um jogo de
    vinte e dois. O treinador quer que o 7 continue a ser o 7.

    ## O que se faz

    Quando o tracker abre um fragmento novo, pergunta-se se ele é a continuação
    de uma pessoa **perdida há pouco**: perdida há menos de `LOST_SEC`, a uma
    distância que se percorre nesse tempo (com a câmara já compensada — as
    pessoas perdidas movem-se com ela, como os tracks), com um tamanho
    parecido, e com a **mesma cor de equipamento** — um histograma HSV do
    tronco, que é o que distingue dois jogadores de equipas diferentes que se
    cruzaram. A melhor candidata herda o número; sem candidata, nasce uma
    pessoa nova. É a `_merge_fragments` feita no momento e com aparência, e é o
    que torna o número estável enquanto a pessoa estiver em campo.

    Não é identificação: não diz quem é, só que é a mesma. Quem sai do
    enquadramento meio minuto volta com número novo, e a identificação (no
    fim, com os recortes) é que junta os dois — como sempre.
    """

    LOST_SEC = 4.0
    # A que velocidade uma pessoa pode ter-se deslocado, em larguras de frame por segundo.
    SPEED_FRAC = 0.35
    SIZE_RATIO = 1.8
    # Distância de Bhattacharyya entre histogramas: 0 = iguais; acima disto são equipamentos diferentes.
    APPEARANCE_MAX = 0.45

    def __init__(self, meta: videolib.VideoMeta) -> None:
        self.largura = max(1, meta.width)
        self.person_of: dict[int, int] = {}  # tid do tracker → pessoa
        # pessoa → (ts da última vez, cx, cy, w, h, histograma)
        self.active: dict[int, tuple[int, float, float, float, float, np.ndarray | None]] = {}
        self.lost: dict[int, tuple[int, float, float, float, float, np.ndarray | None]] = {}
        self.next_pid = 1
        self.vistos_antes: set[int] = set()
        self.touches: dict[int, int] = {}
        # pessoa → o fragmento do tracker que a tem agora. Uma pessoa, um dono.
        self.owner: dict[int, int] = {}

    @staticmethod
    def _hist(frame: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray | None:
        """A cor do tronco: o meio da caixa, onde está a camisola e não a relva."""
        x1, y1, x2, y2 = box
        w, h = x2 - x1, y2 - y1
        if w < 8 or h < 16:
            return None
        ax, bx = int(x1 + w * 0.25), int(x2 - w * 0.25)
        ay, by = int(y1 + h * 0.2), int(y1 + h * 0.55)
        ax, ay = max(0, ax), max(0, ay)
        bx, by = min(frame.shape[1], bx), min(frame.shape[0], by)
        if bx - ax < 4 or by - ay < 4:
            return None
        hsv = cv2.cvtColor(frame[ay:by, ax:bx], cv2.COLOR_BGR2HSV)
        hist = cv2.calcHist([hsv], [0, 1], None, [16, 8], [0, 180, 0, 256])
        cv2.normalize(hist, hist, alpha=1, beta=0, norm_type=cv2.NORM_L1)
        return hist

    def move(self, m: np.ndarray | None) -> None:
        """A câmara mexeu-se: as pessoas perdidas vão com ela, como os tracks."""
        if m is None or not self.lost:
            return
        a, b, tx = m[0]
        c, d, ty = m[1]
        escala = float(np.hypot(a, b))
        for pid, (ts, cx, cy, w, h, hist) in list(self.lost.items()):
            self.lost[pid] = (ts, a * cx + b * cy + tx, c * cx + d * cy + ty, w * escala, h * escala, hist)

    def assign(
        self, frame: np.ndarray, ts_ms: int, seguidos: "sv.Detections",
        grupo_de: Callable[[int], str | None] = lambda _pid: None,
    ) -> list[tuple[int, tuple[float, float, float, float], float]]:
        """Para cada caixa seguida neste frame, a pessoa a que pertence.

        `grupo_de` diz a equipa (pela cor) de uma pessoa já conhecida: um
        fragmento novo só herda o número de alguém perdido se a cor do tronco
        bater, e nunca o de alguém de uma equipa diferente da do fragmento que
        o tracker já tinha (ver `_reclaim`).
        """
        self._grupo_de = grupo_de
        resultado: list[tuple[int, tuple[float, float, float, float], float]] = []
        vistos_agora: set[int] = set()
        novos: list[tuple[int, tuple[float, float, float, float], float]] = []

        conhecidos: list[tuple[int, int, tuple[float, float, float, float], float]] = []  # (tid, pid, box, conf)
        usados: set[int] = set()
        for xyxy, conf, tid in zip(seguidos.xyxy, seguidos.confidence, seguidos.tracker_id):
            tid = int(tid)
            box = tuple(float(v) for v in xyxy)
            vistos_agora.add(tid)
            pid = self.person_of.get(tid)
            # Um número, uma caixa. O mapa fragmento → pessoa fica depois de o
            # fragmento se perder (para o tracker o poder reencontrar), mas
            # entretanto a pessoa pode ter sido herdada por outro fragmento; se
            # o antigo volta, tem de ir ao crivo como novo — senão eram duas
            # caixas com o mesmo número, e o ecrã fazia-a saltar entre as duas.
            if pid is not None and (pid in usados or self.owner.get(pid, tid) != tid):
                self.person_of.pop(tid, None)
                pid = None
            if pid is None:
                novos.append((tid, box, float(conf)))  # decide-se depois dos conhecidos: estes não podem roubar ninguém
                continue
            usados.add(pid)
            # O tracker reencontrou um fragmento que tinha perdido: a pessoa volta.
            if pid in self.lost:
                self.active[pid] = self.lost.pop(pid)
            conhecidos.append((tid, pid, box, float(conf)))

        # Dois colados: o tracker troca-os ao cruzarem-se. A cor desfaz a troca
        # quando são de equipas diferentes; entre dois colegas não há sinal.
        self._undo_swaps(frame, conhecidos)
        for tid, pid, box, conf in conhecidos:
            self.person_of[tid] = pid
            self.owner[pid] = tid
            self._touch(pid, ts_ms, box, None, frame)
            resultado.append((pid, box, conf))

        # Os fragmentos que acabaram neste frame passam a pessoas perdidas. O
        # mapa fragmento → pessoa fica: se o tracker reencontrar o fragmento
        # com o mesmo id, é a mesma pessoa, sem passar pelo crivo.
        for tid in self.vistos_antes - vistos_agora:
            pid = self.person_of.get(tid)
            if pid is not None and pid in self.active:
                self.lost[pid] = self.active.pop(pid)
        self.vistos_antes = vistos_agora

        # Os fragmentos novos: continuação de alguém perdido, ou pessoa nova.
        ocupadas: set[int] = set(usados)
        for tid, box, conf in novos:
            hist = self._hist(frame, box)
            pid = self._reclaim(ts_ms, box, hist, ocupadas)
            if pid is None:
                pid = self.next_pid
                self.next_pid += 1
            else:
                ocupadas.add(pid)
                self.lost.pop(pid, None)
            ocupadas.add(pid)
            self.person_of[tid] = pid
            # O dono passa a ser este fragmento: o antigo, se voltar, vai ao crivo.
            self.owner[pid] = tid
            self._touch(pid, ts_ms, box, hist, None)
            resultado.append((pid, box, conf))

        # Quem está perdido há demasiado tempo não volta por aqui — e o seu
        # fragmento deixa de apontar para ela, para o mapa não crescer para sempre.
        limite = ts_ms - self.LOST_SEC * 1000
        esquecidos = {p for p, dado in self.lost.items() if dado[0] < limite}
        for pid in esquecidos:
            del self.lost[pid]
        if esquecidos:
            self.person_of = {t: p for t, p in self.person_of.items() if p not in esquecidos}
        return resultado

    # De quantos em quantos frames se renova a cor guardada de uma pessoa: a
    # luz muda, a sombra passa, e uma cor de há cinco minutos deixa de servir.
    HIST_REFRESH = 10

    def _touch(
        self, pid: int, ts_ms: int, box: tuple[float, float, float, float], hist: np.ndarray | None,
        frame: np.ndarray | None = None,
    ) -> None:
        x1, y1, x2, y2 = box
        antes = self.active.get(pid)
        n = self.touches.get(pid, 0) + 1
        self.touches[pid] = n
        if hist is None and antes is not None:
            hist = antes[5]
            if frame is not None and n % self.HIST_REFRESH == 0:
                novo = self._hist(frame, box)
                if novo is not None:
                    hist = novo if hist is None else (0.8 * hist + 0.2 * novo).astype(np.float32)
        self.active[pid] = (ts_ms, (x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1, hist)

    # Acima disto a cor do tronco é "outra"; abaixo, a mesma. A troca só se
    # desfaz quando trocar melhora claramente — nunca por um empate.
    SWAP_MARGIN = 0.15

    def _undo_swaps(self, frame: np.ndarray, conhecidos: list[tuple[int, int, tuple[float, float, float, float], float]]) -> None:
        """Dois fragmentos colados com as cores trocadas em relação às pessoas: troca-se de volta."""
        n = len(conhecidos)
        if n < 2:
            return
        hists: dict[int, np.ndarray | None] = {}
        for i in range(n):
            _ti, pi, bi, _ci = conhecidos[i]
            for j in range(i + 1, n):
                _tj, pj, bj, _cj = conhecidos[j]
                wi, wj = bi[2] - bi[0], bj[2] - bj[0]
                # Colados: centros a menos de uma largura e meia, e a sobreporem-se na vertical.
                if abs((bi[0] + bi[2]) / 2 - (bj[0] + bj[2]) / 2) > 1.5 * max(wi, wj):
                    continue
                if bi[3] < bj[1] or bj[3] < bi[1]:
                    continue
                si = self.active.get(pi, (0, 0, 0, 0, 0, None))[5]
                sj = self.active.get(pj, (0, 0, 0, 0, 0, None))[5]
                if si is None or sj is None:
                    continue
                if i not in hists:
                    hists[i] = self._hist(frame, bi)
                if j not in hists:
                    hists[j] = self._hist(frame, bj)
                hi, hj = hists[i], hists[j]
                if hi is None or hj is None:
                    continue
                d = lambda a, b: float(cv2.compareHist(a, b, cv2.HISTCMP_BHATTACHARYYA))  # noqa: E731
                como_esta = d(hi, si) + d(hj, sj)
                trocado = d(hi, sj) + d(hj, si)
                if trocado + self.SWAP_MARGIN < como_esta:
                    conhecidos[i] = (conhecidos[i][0], pj, bi, conhecidos[i][3])
                    conhecidos[j] = (conhecidos[j][0], pi, bj, conhecidos[j][3])

    def _reclaim(
        self, ts_ms: int, box: tuple[float, float, float, float], hist: np.ndarray | None, ocupadas: set[int],
    ) -> int | None:
        x1, y1, x2, y2 = box
        cx, cy, h = (x1 + x2) / 2, (y1 + y2) / 2, y2 - y1
        vel_px_ms = self.SPEED_FRAC * self.largura / 1000
        melhor, melhor_custo = None, None
        for pid, (ts, px, py, _pw, ph, phist) in self.lost.items():
            if pid in ocupadas:
                continue
            intervalo = ts_ms - ts
            if intervalo <= 0 or intervalo > self.LOST_SEC * 1000:
                continue
            alcance = vel_px_ms * intervalo + h
            dist = float(np.hypot(cx - px, cy - py))
            if dist > alcance:
                continue
            if max(h, ph) / max(1.0, min(h, ph)) > self.SIZE_RATIO:
                continue
            aparencia = 0.0
            if hist is not None and phist is not None:
                aparencia = float(cv2.compareHist(hist, phist, cv2.HISTCMP_BHATTACHARYYA))
                if aparencia > self.APPEARANCE_MAX:
                    continue
            elif hist is None or phist is None:
                # Sem cor de um dos lados (caixa pequena demais), só com a
                # equipa já conhecida é que se arrisca a herança.
                if getattr(self, "_grupo_de", lambda _p: None)(pid) is None:
                    continue
            # Perto e parecido ganha; a distância conta em corpos, a aparência em partes.
            custo = dist / max(1.0, h) + aparencia * 2
            if melhor_custo is None or custo < melhor_custo:
                melhor, melhor_custo = pid, custo
        return melhor


def _merge_fragments(
    tracks: dict[int, list[tuple[int, float, float, float, float, float]]],
    meta: videolib.VideoMeta,
    grupo_de: Callable[[int], str | None] = lambda _pid: None,
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
    # (índice da cadeia, ts do fim, x, y, altura, equipa) — só das que ainda podem receber.
    abertas: list[tuple[int, int, float, float, float, str | None]] = []
    origem: dict[int, int] = {}

    for tid, pontos in ordenados:
        ts_ini, x_ini, y_ini, _w, h_ini, _c = pontos[0]
        equipa = grupo_de(tid)

        # Fecha as que já não podem receber este nem nenhum dos seguintes.
        abertas = [a for a in abertas if ts_ini - a[1] <= gap_ms]

        melhor, melhor_dist = None, None
        for pos, (idx, ts_fim, x_fim, y_fim, h_fim, equipa_fim) in enumerate(abertas):
            intervalo = ts_ini - ts_fim
            if intervalo <= 0:
                continue  # sobrepõem-se no tempo: são dois jogadores, não um
            # Equipas diferentes pela cor: dois jogadores, por muito que o
            # sítio e o tempo batam. Era daqui que saíam identidades com um
            # vermelho, um amarelo e um guarda-redes nos três recortes.
            if equipa and equipa_fim and equipa != equipa_fim:
                continue
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
            equipa_cadeia = equipa
        else:
            idx = abertas[melhor][0]
            cadeias[idx].extend(pontos)
            equipa_cadeia = abertas[melhor][5] or equipa
            abertas.pop(melhor)

        origem[tid] = idx
        ts_f, x_f, y_f, _w2, h_f, _c2 = cadeias[idx][-1]
        abertas.append((idx, ts_f, x_f, y_f, h_f, equipa_cadeia))

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
            # O tecto mais baixo dos dois: o das pessoas aplica-se depois, por
            # classe; a bola, pequena e difícil, fica com o seu (ver BALL_SCORE).
            box_score_thresh=min(config.SCORE_THRESHOLD, BALL_SCORE),
            min_size=plano["short"],
            max_size=plano["maxSize"],
        )
    else:
        model = det.fasterrcnn_mobilenet_v3_large_fpn(
            weights=det.FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT,
            box_score_thresh=min(config.SCORE_THRESHOLD, BALL_SCORE),
            min_size=plano["short"],
            max_size=plano["maxSize"],
        )

    model.eval().to(device)

    if device == "cuda":
        # `cudnn.benchmark` fica **desligado**, e foi medido (07/10/2026, RTX
        # 5050 de 4 GB, detecção em pipeline já aquecida): ligado, 1,15× o
        # tempo real; desligado, 2,56×. Ligado, cada forma de entrada nova (o
        # lote de 8, o lote parcial do fim, a janela da bola) custava uns vinte
        # segundos de medição de algoritmos — a meio do jogo a correr — e os
        # algoritmos escolhidos pediam espaço de trabalho que esta placa não
        # tem e transbordava para a memória do sistema. Foi isto que fez todas
        # as medições curtas de hoje variarem entre 0,6× e 1×.
        #
        # `channels_last` não entra aqui: os modelos de detecção do torchvision
        # recebem uma **lista de tensores 3D** (o lote é montado lá dentro,
        # depois do redimensionamento), e esse formato exige rank 4.
        torch.backends.cudnn.benchmark = False
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


# COCO: 1 = pessoa, 37 = bola desportiva. A bola sai do mesmo passo do
# detector, sem custo — só deixou de se deitar fora.
COCO_PERSON = 1
COCO_BALL = 37
# A bola é pequena e o detector duvida dela; aceita-se com menos certeza do que
# uma pessoa, e o tracker da bola é que decide se o salto faz sentido.
BALL_SCORE = 0.25


@torch.inference_mode() if _DEPS else (lambda f: f)
def _detect_people(
    model, frames_bgr: list[np.ndarray], device: str, plano: dict[str, Any],
) -> list[tuple["sv.Detections", list[tuple[float, float, float]]]]:
    """Um lote de frames → por frame, as pessoas e as candidatas a bola `(x, y, conf)`.

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
    bolas: list[list[tuple[float, float, float]]] = [[] for _ in frames_bgr]
    for (k, dx, dy), out in zip(origem, saidas):
        labels, boxes_all, scores_all = out["labels"], out["boxes"].float(), out["scores"].float()
        keep = (labels == COCO_PERSON) & (scores_all >= config.SCORE_THRESHOLD)
        boxes = boxes_all[keep]
        scores = scores_all[keep]
        if dx or dy:
            boxes = boxes + torch.tensor([dx, dy, dx, dy], device=boxes.device, dtype=boxes.dtype)
        por_frame[k].append((boxes, scores))
        # A bola: o centro de cada candidata, com a confiança. O resto (bancos,
        # sacos) sai aqui.
        for box, score in zip(boxes_all[labels == COCO_BALL].cpu().numpy(), scores_all[labels == COCO_BALL].cpu().numpy()):
            x1, y1, x2, y2 = box
            # Uma "bola" do tamanho de uma pessoa é um erro do detector.
            if (x2 - x1) > 80 or (y2 - y1) > 80:
                continue
            bolas[k].append((float((x1 + x2) / 2 + dx), float((y1 + y2) / 2 + dy), float(score)))

    resultados: list[tuple["sv.Detections", list[tuple[float, float, float]]]] = []
    for partes, candidatas in zip(por_frame, bolas):
        if not partes:
            resultados.append((sv.Detections.empty(), candidatas))
            continue
        boxes = torch.cat([b for b, _ in partes])
        scores = torch.cat([s for _, s in partes])
        if n > 1 and len(boxes) > 1:
            keep = torchvision.ops.nms(boxes, scores, iou_threshold=0.5)
            boxes, scores = boxes[keep], scores[keep]
        b = boxes.cpu().numpy()
        s = scores.cpu().numpy()
        resultados.append((
            sv.Detections(
                xyxy=b.reshape(-1, 4),
                confidence=s,
                class_id=np.zeros(len(s), dtype=int),
            ),
            candidatas,
        ))
    return resultados


# A janela do segundo olhar, em píxeis do frame original. 480 numa fonte de
# 1080p vai ao detector ampliada 1,67× (o lado curto sobe aos 800): uma bola
# de 15 px passa a 25, que é onde o modelo COCO começa a vê-la.
BALL_ZOOM_WINDOW = 480


@torch.inference_mode() if _DEPS else (lambda f: f)
def _ball_zoom(
    model, frame: np.ndarray, device: str, plano: dict[str, Any],
    last: tuple[float, float] | None, players: list[tuple[float, float, float, float]],
) -> list[tuple[float, float, float]]:
    """A bola, vista de perto.

    O frame inteiro vai ao detector reduzido a 800 px de lado curto; nessa
    escala a bola tem dez píxeis e o modelo genérico pouco faz com ela. Não é
    a qualidade do vídeo — é o tamanho. Aqui recorta-se uma janela do frame
    **original** à volta de onde a bola estava (ou do centro dos jogadores,
    quando não se vê) e passa-se só esse recorte pelo detector: o mesmo
    modelo, com zoom. Custa uma inferência pequena por frame, e é o que faz a
    diferença entre ver a bola e não a ver num plano aberto.
    """
    h, w = frame.shape[:2]
    if last is not None:
        cx, cy = last
    elif players:
        cx = float(np.mean([(p[0] + p[2]) / 2 for p in players]))
        cy = float(np.mean([p[3] for p in players]))
    else:
        return []
    meio = BALL_ZOOM_WINDOW / 2
    x1, y1 = int(max(0, min(w - BALL_ZOOM_WINDOW, cx - meio))), int(max(0, min(h - BALL_ZOOM_WINDOW, cy - meio)))
    x2, y2 = min(w, x1 + BALL_ZOOM_WINDOW), min(h, y1 + BALL_ZOOM_WINDOW)
    if x2 - x1 < 64 or y2 - y1 < 64:
        return []
    # Sempre o mesmo tamanho, custe o que custar em bordas pretas: o cuDNN
    # está em modo `benchmark` e volta a medir algoritmos a cada forma nova —
    # uma janela cortada pela borda do frame custava 300 ms em vez de 40.
    janela = np.zeros((BALL_ZOOM_WINDOW, BALL_ZOOM_WINDOW, 3), dtype=np.uint8)
    janela[: y2 - y1, : x2 - x1] = frame[y1:y2, x1:x2]
    rgb = cv2.cvtColor(janela, cv2.COLOR_BGR2RGB)
    tensor = torch.from_numpy(rgb).permute(2, 0, 1).to(device, non_blocking=True).float().div_(255)
    with torch.autocast(device_type=device, dtype=torch.float16, enabled=plano["half"]):
        out = model([tensor])[0]
    keep = out["labels"] == COCO_BALL
    resultado: list[tuple[float, float, float]] = []
    for box, score in zip(out["boxes"][keep].cpu().numpy(), out["scores"][keep].cpu().numpy()):
        bx1, by1, bx2, by2 = box
        if (bx2 - bx1) > 60 or (by2 - by1) > 60:
            continue
        resultado.append((float((bx1 + bx2) / 2 + x1), float((by1 + by2) / 2 + y1), float(score)))
    return resultado


class BallTracker:
    """A bola, frame a frame — e a honestidade de quando não se vê.

    O detector COCO sabe o que é uma bola desportiva, mas num plano aberto ela
    tem dez píxeis e falha mais do que acerta. Isto não inventa: guarda a
    última posição vista e aceita uma candidata nova se estiver a uma distância
    que uma bola percorre nesse tempo (com a câmara compensada), ou se a última
    já for velha. O que sai daqui é "vista aqui" ou nada; a cobertura (frames
    com bola ÷ frames) é a confiança que acompanha qualquer número de posse.

    ## A bola do jogo e as outras

    Um campo tem bolas de reserva atrás da baliza e junto à linha, e o detector
    vê-as tão bem como a do jogo. Sem o campo calibrado não há "dentro das
    linhas"; há duas coisas que se sabem: a bola do jogo está perto de
    jogadores, e uma bola de reserva fica **parada no mesmo sítio**. Por isso
    uma candidata perto de alguém ganha preferência; uma bola que fica mais de
    `PARK_SEC` parada longe de toda a gente passa a "estacionada" e ignora-se
    daí para a frente; e se a bola seguida estiver longe de todos e aparecer
    outra perto de jogadores, troca-se. O "dentro do campo" chega com a
    calibração, e aí isto fica mais simples.
    """

    LOST_SEC = 1.5
    # Larguras de frame por segundo: um remate forte, numa filmagem larga.
    SPEED_FRAC = 1.2
    # Perto de um jogador: a esta distância, em alturas de corpo, a bola é dele.
    NEAR_BODIES = 3.0
    PARK_SEC = 4.0
    PARK_RADIUS = 20.0

    def __init__(self, meta: videolib.VideoMeta) -> None:
        self.largura = max(1, meta.width)
        self.last: tuple[int, float, float] | None = None
        self.last_near = True
        self.still_since: int | None = None
        self.parked: list[tuple[float, float]] = []

    def move(self, m: np.ndarray | None) -> None:
        if m is None:
            return
        a, b, tx = m[0]
        c, d, ty = m[1]
        if self.last is not None:
            ts, x, y = self.last
            self.last = (ts, a * x + b * y + tx, c * x + d * y + ty)
        self.parked = [(a * x + b * y + tx, c * x + d * y + ty) for x, y in self.parked]

    def where(self) -> tuple[float, float] | None:
        """Onde a bola estava da última vez, para o segundo olhar saber para onde olhar."""
        return None if self.last is None else (self.last[1], self.last[2])

    @staticmethod
    def _nearest_body(c: tuple[float, float, float], players: list[tuple[float, float, float, float]]) -> float | None:
        """A que distância, em alturas de corpo, está o jogador mais perto (pelos pés)."""
        melhor: float | None = None
        for x1, y1, x2, y2 in players:
            h = max(1.0, y2 - y1)
            d = float(np.hypot((x1 + x2) / 2 - c[0], y2 - c[1])) / h
            if melhor is None or d < melhor:
                melhor = d
        return melhor

    def update(
        self, ts_ms: int, candidatas: list[tuple[float, float, float]], players: list[tuple[float, float, float, float]],
    ) -> tuple[float, float, float] | None:
        if not candidatas:
            return None

        # As estacionadas ficam de fora, a não ser que alguém tenha ido buscá-las.
        validas: list[tuple[float, tuple[float, float, float], float | None]] = []
        for c in candidatas:
            perto = self._nearest_body(c, players)
            if any(np.hypot(c[0] - px, c[1] - py) <= self.PARK_RADIUS * 2 for px, py in self.parked) and (perto is None or perto > 1.5):
                continue
            pontuacao = c[2] + (0.25 if perto is not None and perto <= self.NEAR_BODIES else 0.0)
            validas.append((pontuacao, c, perto))
        if not validas:
            return None

        if self.last is None or ts_ms - self.last[0] > self.LOST_SEC * 1000:
            escolhida = max(validas, key=lambda v: v[0])
        else:
            gap = ts_ms - self.last[0]
            alcance = self.SPEED_FRAC * self.largura / 1000 * gap + 40
            ao_alcance = [v for v in validas if np.hypot(v[1][0] - self.last[1], v[1][1] - self.last[2]) <= alcance]
            com_gente = [v for v in validas if v[2] is not None and v[2] <= self.NEAR_BODIES]
            if ao_alcance:
                escolhida = max(ao_alcance, key=lambda v: v[0])
            elif not self.last_near and com_gente:
                # A seguida está longe de todos e há uma com gente: era a errada.
                escolhida = max(com_gente, key=lambda v: v[0])
            else:
                return None

        _p, melhor, perto = escolhida
        # Parada no mesmo sítio e longe de toda a gente: é de reserva.
        if self.last is not None and np.hypot(melhor[0] - self.last[1], melhor[1] - self.last[2]) <= self.PARK_RADIUS:
            if self.still_since is None:
                self.still_since = self.last[0]
        else:
            self.still_since = None
        longe = perto is None or perto > self.NEAR_BODIES
        if longe and self.still_since is not None and ts_ms - self.still_since >= self.PARK_SEC * 1000:
            self.parked.append((melhor[0], melhor[1]))
            self.last, self.still_since, self.last_near = None, None, True
            return None

        self.last = (ts_ms, melhor[0], melhor[1])
        self.last_near = not longe
        return melhor


class TeamClassifier:
    """Quem é de que equipa, pela cor do equipamento — e o árbitro, que não é de nenhuma.

    ## O que se mede

    Por pessoa, a cor do tronco (o meio da caixa, sem a relva: o verde do campo
    tira-se por matiz) em Lab, que é o espaço onde "parecido" se mede com uma
    régua. Acumula-se ao longo do tempo: uma pessoa é a média do que se viu
    dela, não um frame com sombra.

    ## Como se agrupa

    De `REFRESH_SEC` em `REFRESH_SEC` segundos de vídeo, k-means sobre as
    pessoas com observações que cheguem, com até quatro grupos: duas equipas, e
    o que sobra — árbitro, guarda-redes, um treinador na linha. **As duas
    maiores** são as equipas; o resto é "outros". Os grupos recebem a letra A/B
    de forma estável entre refrescamentos (o novo centro mais perto do antigo
    herda a letra), e cada pessoa vota: só muda de grupo quando o seu centro se
    reorganiza, não por um frame.

    Qual é a nossa não se adivinha: o treinador escolhe a cor no ecrã, e essa
    escolha guarda-se na análise (ver `oursKitColor`).
    """

    REFRESH_SEC = 5.0
    MIN_OBS = 5
    MIN_PEOPLE = 6

    def __init__(self) -> None:
        self.lab: dict[int, tuple[np.ndarray, int]] = {}  # pid → (soma Lab, n)
        self.group: dict[int, str] = {}  # pid → "A" | "B" | "other"
        self.centers: dict[str, np.ndarray] = {}  # "A"/"B" → Lab
        self.last_refresh = -1.0

    @staticmethod
    def _torso_lab(frame: np.ndarray, box: tuple[float, float, float, float]) -> np.ndarray | None:
        x1, y1, x2, y2 = box
        w, h = x2 - x1, y2 - y1
        if w < 10 or h < 20:
            return None
        ax, bx = max(0, int(x1 + w * 0.25)), min(frame.shape[1], int(x2 - w * 0.25))
        ay, by = max(0, int(y1 + h * 0.18)), min(frame.shape[0], int(y1 + h * 0.5))
        if bx - ax < 4 or by - ay < 4:
            return None
        crop = frame[ay:by, ax:bx]
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        # A relva: matiz verde com saturação — o que não é relva fica.
        relva = (hsv[:, :, 0] > 32) & (hsv[:, :, 0] < 90) & (hsv[:, :, 1] > 50)
        lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3)[~relva.reshape(-1)]
        if len(lab) < 16:
            return None
        return np.median(lab, axis=0).astype(np.float32)

    def observe(self, pid: int, frame: np.ndarray, box: tuple[float, float, float, float]) -> None:
        cor = self._torso_lab(frame, box)
        if cor is None:
            return
        soma, n = self.lab.get(pid, (np.zeros(3, dtype=np.float32), 0))
        self.lab[pid] = (soma + cor, n + 1)

    def refresh(self, ts_ms: int) -> None:
        if ts_ms - self.last_refresh < self.REFRESH_SEC * 1000:
            return
        self.last_refresh = ts_ms
        pids = [p for p, (_s, n) in self.lab.items() if n >= self.MIN_OBS]
        if len(pids) < self.MIN_PEOPLE:
            return
        dados = np.stack([self.lab[p][0] / self.lab[p][1] for p in pids]).astype(np.float32)
        k = 4 if len(pids) >= 12 else 3
        _compact, labels, centers = cv2.kmeans(
            dados, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1.0), 4, cv2.KMEANS_PP_CENTERS,
        )
        labels = labels.reshape(-1)
        tamanhos = [(int((labels == i).sum()), i) for i in range(k)]
        tamanhos.sort(reverse=True)
        equipas = [i for _n, i in tamanhos[:2]]

        # As letras: o centro novo mais perto do antigo herda-a.
        novos = {i: centers[i] for i in equipas}
        letras: dict[int, str] = {}
        if self.centers:
            pares = sorted(
                ((float(np.linalg.norm(novos[i] - c)), i, letra) for i in equipas for letra, c in self.centers.items()),
            )
            usados: set[str] = set()
            for _d, i, letra in pares:
                if i in letras or letra in usados:
                    continue
                letras[i] = letra
                usados.add(letra)
        for i in equipas:
            if i not in letras:
                letras[i] = "A" if "A" not in letras.values() else "B"
        self.centers = {letras[i]: novos[i] for i in equipas}
        for pid, lab in zip(pids, labels):
            self.group[pid] = letras.get(int(lab), "other")

    def group_of(self, pid: int) -> str | None:
        return self.group.get(pid)

    def group_code(self, pid: int) -> int:
        return {"A": 1, "B": 2, "other": 3}.get(self.group.get(pid, ""), 0)

    @staticmethod
    def _rgb(lab: np.ndarray) -> list[int]:
        bgr = cv2.cvtColor(np.array([[lab]], dtype=np.uint8), cv2.COLOR_LAB2BGR)[0][0]
        return [int(bgr[2]), int(bgr[1]), int(bgr[0])]

    def person_color(self, pid: int) -> list[int] | None:
        dado = self.lab.get(pid)
        if not dado or dado[1] == 0:
            return None
        return self._rgb(np.clip(dado[0] / dado[1], 0, 255))

    def palette(self) -> dict[str, list[int]]:
        """As cores das equipas em RGB, para o ecrã."""
        return {letra: self._rgb(np.clip(c, 0, 255)) for letra, c in self.centers.items()}


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
    grupo_final: dict[int, dict[str, Any]] | None = None,
    bola_vista: list[list[float | None]] | None = None,
    teams: dict[str, list[int]] | None = None,
    metros: dict[int, list[tuple[int, float, float]]] | None = None,
    pitch: dict[str, Any] | None = None,
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
                    # A equipa pela cor ("A"/"B"/"other") e a cor média do
                    # equipamento. "Nossa" ou "deles" decide-se na API com a
                    # cor que o treinador escolheu — ver `resolveSides`.
                    **(
                        {"kitGroup": grupo_final[tid]["kitGroup"], "kitColor": grupo_final[tid]["kitColor"]}
                        if grupo_final and tid in grupo_final
                        else {}
                    ),
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
            # A bola, só quando vista: [tsMs, x, y, conf, X, Y]. E as cores das equipas.
            "ball": bola_vista or [],
            "teams": teams or {},
            # trackNumber → "A"/"B"/"other", para o ecrã pintar sem ir à base.
            "kitGroups": {str(t): g["kitGroup"] for t, g in (grupo_final or {}).items() if t in posicoes},
            # Em metros, quando houve calibração: trackNumber → [[tsMs, X, Y], …].
            "pitch": pitch or {},
            "metres": {
                str(t): [[ts, round(x, 1), round(y, 1)] for ts, x, y in pontos]
                for t, pontos in (metros or {}).items() if str(t) in posicoes
            },
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
