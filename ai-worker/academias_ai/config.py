"""Configuração do worker — tudo vem do ambiente, com um .env opcional.

Sem biblioteca de dotenv: são quatro variáveis, e um parser de oito linhas não
diverge de ninguém.
"""

from __future__ import annotations

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Carrega um .env ao lado do package, sem pisar o ambiente real."""
    env = Path(__file__).resolve().parent.parent / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

API_URL = os.environ.get("ACADEMIAS_API_URL", "http://localhost:3000").rstrip("/")
TOKEN = os.environ.get("AI_WORKER_TOKEN", "")
# Não é só diagnóstico: é o `holder` do vídeo — o nome que decide que este
# worker, e só este, processa os jogos que recebeu. Tem de ser estável e único
# por máquina.
WORKER_NAME = os.environ.get("AI_WORKER_NAME", "local-dev")
POLL_SECONDS = float(os.environ.get("AI_WORKER_POLL_SECONDS", "5"))

# A porta por onde o browser envia o vídeo (ver `ingest.py`). 0 desliga.
#
# `PORT` primeiro porque é assim que as plataformas de deploy (Railway, e as
# outras todas) dizem em que porta é que o domínio público bate — e uma porta
# escolhida por nós, lá, não recebe pedido nenhum. Localmente `PORT` não existe
# e manda o `AI_WORKER_INGEST_PORT`.
INGEST_PORT = int(os.environ.get("PORT") or os.environ.get("AI_WORKER_INGEST_PORT", "8765"))
# Onde os vídeos vivem enquanto se processam.
SPOOL = Path(os.environ.get("AI_WORKER_SPOOL", str(Path(__file__).resolve().parent.parent / "spool")))

# O ffprobe, por caminho e não por sorte do PATH.
#
# Duas razões, e as duas doeram. A primeira: um serviço arrancado por outro
# processo herda o ambiente de quem o arrancou, e não o PATH que o instalador
# escreveu no registo — o worker dizia "sem ffprobe" numa máquina que o tinha
# instalado, e caía para as estimativas do OpenCV sem ninguém perceber porquê.
# A segunda é de licença: uma máquina pode ter mais do que uma build de FFmpeg,
# e a primeira do PATH pode ser a GPL. O produto assume LGPL chamado por
# processo (ver LICENSES.md), e isso decide-se apontando, não torcendo.
#
# Vazio = procurar no PATH, como antes.
FFPROBE = os.environ.get("AI_WORKER_FFPROBE", "").strip()
# Ao fim de quantas horas um ficheiro esquecido é apagado, peça a API o que pedir.
SPOOL_TTL_HOURS = float(os.environ.get("AI_WORKER_SPOOL_TTL_HOURS", "72"))


# ---------------------------------------------------------------------------
# Detecção — o que decide quanto tempo um jogo demora
# ---------------------------------------------------------------------------
#
# Os valores por omissão foram medidos, não escolhidos a olho (ver a nota de
# topo de `pipelines/detect_track.py`). Estão aqui para se poderem afinar por
# máquina sem tocar no código: a mesma imagem de contentor serve um Railway sem
# GPU e uma máquina com RTX.

def _num(nome: str, omissao: float) -> float:
    try:
        return float(os.environ.get(nome, "") or omissao)
    except ValueError:
        return omissao


# Quanto é que um frame pode ser ampliado antes de ir ao detector.
#
# Ampliar ajuda a encontrar jogadores pequenos — um vídeo de 360p filmado de
# longe dá-lhes 30 px — mas o custo cresce com o quadrado. 1,5× é o ponto onde
# o benefício ainda paga; o torchvision, por omissão, fazia 2,2× e gastava
# quase cinco vezes os píxeis da fonte.
MAX_UPSCALE = _num("AI_WORKER_MAX_UPSCALE", 1.5)

# Tecto do lado curto. 800 é o valor para que os pesos COCO foram treinados;
# baixá-lo é a forma mais directa de trocar precisão por tempo.
WORK_SHORT_MAX = int(_num("AI_WORKER_WORK_SHORT", 800))

# Quantos frames vão ao detector de uma vez. Numa GPU, lotes enchem-na em vez
# de a deixarem à espera entre kernels; numa CPU rendem pouco e comem memória.
BATCH = int(_num("AI_WORKER_BATCH", 0))  # 0 = decide pelo aparelho

# Meia precisão. Ganho na GPU, sem custo mensurável em detecção; ignorado na CPU.
HALF = (os.environ.get("AI_WORKER_HALF", "1").strip().lower() not in ("0", "false", "no"))

# "fasterrcnn" (por omissão) ou "ssdlite" — um passo só, cerca de 2,6× mais
# rápido em CPU e mais fraco com jogadores sobrepostos, que num jogo são muitos.
DETECTOR = os.environ.get("AI_WORKER_DETECTOR", "")

# Threads do PyTorch em CPU. 0 = o que o PyTorch achar.
THREADS = int(_num("AI_WORKER_THREADS", 0))

# --- Recall: ver o jogo inteiro, e não só quem está perto da câmara ------------
#
# Medido num jogo real de 111 minutos a 1080p, filmado de cima: os tracks
# cobriam **8 %** do tempo de jogador, com 1,8 pessoas seguidas em média num
# campo com 22. Não era o tracking a falhar — era o detector a não ver
# jogadores de 30–50 píxeis, ainda mais depois de o frame descer aos 800 px.
# Estas três alavancas trocam tempo por recall; o resultado di-lo em
# `stats.meanConcurrentTracks`, para a troca se medir e não se assumir.

# Detecção por mosaicos: 2 = o frame parte-se em 2×2 janelas (com folga) e
# cada uma vai ao detector na resolução de trabalho — um jogador fica com o
# dobro dos píxeis. Custa ~4× o tempo de detecção. 1 = desligado.
TILES = int(_num("AI_WORKER_TILES", 1))

# O limiar de confiança do detector. O ByteTrack usa detecções fracas para
# continuar tracks já abertos; baixar isto de 0,5 para 0,4 dá-lhe esse
# material. Abaixo de 0,3 entram bancos, sacos e sombras.
SCORE_THRESHOLD = _num("AI_WORKER_SCORE_THRESHOLD", 0.5)


def validate() -> None:
    if not TOKEN or len(TOKEN) < 16:
        raise SystemExit(
            "AI_WORKER_TOKEN em falta ou demasiado curto (mínimo 16 caracteres).\n"
            "Tem de ser o mesmo valor que a API tem no ambiente dela — ver .env.example."
        )
