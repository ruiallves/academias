# O worker da Academias AI, para o Railway.
#
# ## Porquê um Dockerfile e não o nixpacks
#
# Porque duas coisas aqui têm de ser explícitas e o detector automático erra as
# duas: o **ffmpeg** (que não é um pacote de Python e sem ele a duração e o FPS
# passam a estimativas do OpenCV) e a build do **torch**. Um `pip install torch`
# num Linux traz a build de CUDA — mais de dois gigabytes de dependências da
# NVIDIA para uma máquina que não tem GPU nenhuma. O índice `whl/cpu` traz a
# build de CPU, que é a que o Railway consegue usar.
#
# ## O que este contentor faz
#
# Duas coisas ao mesmo tempo, no mesmo processo: recebe os vídeos do browser
# (porta HTTP, ver `academias_ai/ingest.py`) e trabalha a fila da API. É de
# propósito — o vídeo tem de aterrar no disco de quem o vai processar.
#
# ## Uma réplica. Sempre.
#
# O carregamento é feito em blocos que se somam a um ficheiro **local**. Com
# duas réplicas atrás do mesmo domínio, os blocos dividem-se por duas máquinas
# e nenhuma fica com o vídeo inteiro. Escalar faz-se com mais *serviços* (cada
# um com o seu `AI_WORKER_NAME` e o seu domínio), nunca com mais réplicas.

FROM python:3.12-slim

# ffmpeg: `ffprobe` mede a duração e o FPS a partir do contentor, que é a
# verdade. Sem ele o OpenCV estima — e engana-se com vídeo de telemóvel (VFR).
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# As dependências primeiro, para a camada ficar em cache entre deploys.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install --no-cache-dir supervision

COPY academias_ai ./academias_ai

# O disco onde os vídeos esperam pelo processamento. No Railway, montar aqui um
# volume com espaço para o maior jogo que se espera receber — sem volume, um
# restart a meio de um carregamento obriga a repeti-lo (o browser retoma, mas
# não há de onde).
ENV AI_WORKER_SPOOL=/data/spool
VOLUME ["/data"]

# Sem GPU, a resolução de trabalho é o que decide o tempo de um jogo. Medido
# numa fonte de 640×360 com 4 threads, por jogo de 111 minutos: 178 min com o
# lado curto a 800 px (como estava), 54 min a 1,25× da fonte, 39 min sem
# ampliar de todo. 1,25× é onde a curva ainda paga — 3,3× mais rápido, e ainda
# amplia o suficiente para um jogador de 30 px não desaparecer.
ENV AI_WORKER_MAX_UPSCALE=1.25
ENV AI_WORKER_BATCH=2

# O Railway injecta `PORT` e é essa que o domínio público serve; o código
# prefere-a a `AI_WORKER_INGEST_PORT`. Ver `academias_ai/config.py`.
EXPOSE 8765

CMD ["python", "-m", "academias_ai"]
