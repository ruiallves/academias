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
(`AI_WORKER_TOKEN`). Não tem credenciais da base de dados nem do Storage — o
vídeo chega por link assinado com prazo, e os artefactos sobem por endereços
assinados pedidos job a job. É isto que permite amanhã correr o mesmo processo
num worker GPU na cloud sem tocar em nada.

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
