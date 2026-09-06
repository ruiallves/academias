# Academias AI — worker de computer vision

O processo que transforma vídeo em dados estruturados. Vive **fora** do NestJS
de propósito: a API autoriza, enfileira e guarda; isto descarrega o vídeo,
corre os modelos e devolve resultados — sempre com confidence.

```
NestJS API  ──►  AIJob (fila no Postgres)
    ▲                   │  claim por HTTP (token)
    │                   ▼
resultados  ◄──  este worker (Python, GPU local ou cloud)
```

O worker só conhece **duas coisas**: o URL da API e o token
(`AI_WORKER_TOKEN`). Não tem credenciais da base de dados nem do Storage — os
artefactos sobem por endereços assinados pedidos job a job. É isto que permite
amanhã correr o mesmo processo num worker GPU na cloud sem tocar em nada.

## O vídeo chega directamente ao worker

O ficheiro do jogo **não passa pelo Supabase**. O worker abre uma porta de
ingestão (`AI_WORKER_INGEST_PORT`, 8765 por omissão — ver
`academias_ai/ingest.py`); o browser envia o vídeo para lá em blocos de 8 MB,
com um bilhete assinado pela API, e o ficheiro fica na pasta `spool/` só
enquanto se processa. No fim a API pede a purga (`purge_video`) e o ficheiro
desaparece; os dados ficam. Um zelador apaga tudo o que tenha mais de
`AI_WORKER_SPOOL_TTL_HOURS`.

A API precisa de saber onde está esta porta: `AI_WORKER_PUBLIC_URL` no `.env`
dela (`http://localhost:8765` em desenvolvimento). Em produção a consola é
HTTPS, por isso a porta também tem de ser — o browser bloqueia, em silêncio,
qualquer pedido `http://` feito a partir de uma página `https://`.

Em produção isso resolve-se com o deploy: o worker é um serviço do Railway com
domínio próprio (ver [`docs/05-deploy.md`](../docs/05-deploy.md) e o
`Dockerfile` aqui ao lado). Para expor a máquina local a uma consola em HTTPS,
um túnel chega:

```sh
cloudflared tunnel --url http://localhost:8765
# e AI_WORKER_PUBLIC_URL=https://<o-endereço-que-ele-der>
```

`AI_WORKER_NAME` deixou de ser só diagnóstico: é o `holder` do vídeo, e só o
worker com esse nome processa os jogos que recebeu. Um nome por máquina,
estável.

## Correr

```sh
cd ai-worker
python -m venv .venv
.venv\Scripts\activate            # Windows · em Linux: source .venv/bin/activate
pip install -r requirements.txt   # base: qualidade de vídeo (CPU)
pip install torch torchvision supervision   # opcional: detecção + tracking
copy .env.example .env            # e preencher
python -m academias_ai
```

Sem `torch`/`supervision` instalados, o worker anuncia só `quality_check` e os
jobs de tracking ficam na fila à espera de um worker que os saiba fazer —
nunca se finge um resultado.

O FFmpeg (`ffprobe`) deve estar no PATH; sem ele os metadados caem para o
OpenCV, que é menos fiável a medir FPS.

## Etapas que este worker sabe fazer

| kind | o que faz | precisa de |
|---|---|---|
| `quality_check` | resolução, FPS, nitidez, luz, estabilidade, visibilidade do terreno → veredicto + viabilidade por dimensão | OpenCV (CPU) |
| `detect_track` | detecção de pessoas + tracking persistente (ByteTrack) a ~5 FPS, tracks com confidence | torch + torchvision + supervision |
| `purge_video` | apaga o ficheiro do vídeo desta máquina quando a API o pede | — |

## Quanto tempo demora — e como se afina

A detecção é praticamente todo o custo (a descodificação do vídeo inteiro são
0,9 min por jogo; medido). O que decide o resto está em quatro variáveis, todas
com valores medidos por omissão — ver o cabeçalho de
`academias_ai/pipelines/detect_track.py`:

| Variável | Faz | Custo em precisão |
| --- | --- | --- |
| `AI_WORKER_MAX_UPSCALE` | quanto um frame pode ser ampliado antes de detectar | real em vídeo de baixa resolução — ampliar ajuda a ver jogadores pequenos |
| `AI_WORKER_HALF` | meia precisão na GPU | nenhum mensurável |
| `AI_WORKER_BATCH` | frames por lote | nenhum — é a mesma conta |
| `AI_WORKER_DETECTOR` | `fasterrcnn` ou `ssdlite` | o `ssdlite` falha mais com jogadores sobrepostos |

Antes de trocar precisão por tempo, medir:

```sh
python scripts/comparar-detector.py um-clip.mp4
```

Corre as configurações no mesmo clip e diz, para cada uma, quantos frames por
segundo e **quantas pessoas encontrou** — que é a metade da troca que costuma
ficar por medir.

As etapas seguintes (campo/homography, bola, identificação, eventos) entram
como novos módulos em `academias_ai/pipelines/` — o `kind` é texto na fila, e
um worker anuncia os que sabe fazer.

## Modelos e licenças

**Regra: só modelos com licença compatível com uso comercial.** Ver
[LICENSES.md](LICENSES.md) — inclui o porquê de o Ultralytics YOLO (AGPL-3.0)
estar excluído. No arranque, o worker regista em `AIModelVersion` o nome,
versão e licença de cada modelo que vai usar: os números que produz ficam com
proveniência.

## Honestidade

- Cada resultado leva confidence por dimensão; o que está abaixo do limiar vai
  para revisão humana do lado do produto.
- Quando a bola se perder (fase futura): `status = uncertain`, nunca uma
  posição inventada.
- Uma falha reporta-se (`fail`) com a causa; a API repõe o job na fila até
  esgotar as tentativas.
