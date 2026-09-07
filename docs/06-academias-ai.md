# Academias AI

A camada de inteligência do produto: vídeo de jogo → computer vision → dados
estruturados → validação humana → estatística → interpretação. Este documento
é o *porquê* da arquitetura; o estado do que está feito vive em
[03-estado](03-estado.md).

## O princípio que manda em tudo

**O LLM nunca calcula estatísticas.** A computer vision produz dados
estruturados com confiança medida; a estatística deriva-se desses dados; a
interpretação (insights) só nasce quando a confiança chega. O que está abaixo
do limiar pede um humano — nunca se inventa. É o mesmo princípio dos alertas
da semana de treino, levado a sério numa área onde a tentação de fingir é
maior.

```
Vídeo ──► CV (worker Python) ──► dados + confidence ──► revisão humana
                                        │                     │
                                        ▼                     ▼
                                  estatística ◄──── correções (active learning)
                                        │
                                        ▼
                                    insights
```

## A forma

```
Consola ──► NestJS (módulo ai/) ──► AIJob (fila no Postgres)
                 ▲                        │ claim por HTTP + token
                 │                        ▼
             resultados ◄──────── ai-worker/ (Python, GPU local ou cloud)
```

- **O processamento não vive no NestJS.** O worker (`ai-worker/` na raiz do
  repo) reclama trabalhos por HTTP com um segredo partilhado
  (`AI_WORKER_TOKEN` — sem ele configurado, a porta está *fechada*, a lição do
  webhook). Não tem credenciais da base nem do Storage: os artefactos sobem
  por links assinados pedidos job a job. Mover o worker para uma GPU na cloud
  é copiar o processo e o token.
- **O vídeo vai direito ao worker, e não fica guardado.** O browser envia o
  ficheiro em blocos de 8 MB para a porta de ingestão do worker
  (`AI_WORKER_PUBLIC_URL` na API; `academias_ai/ingest.py`), com um bilhete
  HMAC assinado pela API com o mesmo `AI_WORKER_TOKEN` — o worker verifica-o
  sozinho. O Supabase nunca vê o vídeo: nem o tecto de 50 MB por ficheiro do
  plano, nem o de 5 GB dos uploads simples, nem o custo de guardar
  gigabytes de imagem de menores que ninguém volta a ler. O ficheiro vive no
  disco do worker (`AIVideo.holder` diz qual — e o claim só entrega os jobs
  dessa análise a esse worker), e é apagado pelo job `purge_video` quando o
  processamento termina (`AIVideo.status = PURGED`; os dados ficam). Um
  zelador no worker apaga o que tiver mais de `AI_WORKER_SPOOL_TTL_HOURS`,
  aconteça o que acontecer. O carregamento é retomável bloco a bloco — uma
  ligação que cai aos 90 % continua dos 90 %. Sem `AI_WORKER_PUBLIC_URL`, fica
  o caminho antigo pelo Storage, com link assinado.
- **A fila é uma tabela** (`AIJob`, `FOR UPDATE SKIP LOCKED`). O stack não tem
  Redis e não precisa: dois workers nunca levam o mesmo job, um worker morto
  devolve o job à fila por falta de heartbeat, e as tentativas têm tecto.
- **O claim atravessa tenants** (é infra da plataforma, via `PlatformPrisma`);
  todas as escritas seguintes voltam ao `runAs(academyId)` com RLS, como
  qualquer pedido.

## Dados

`AIAnalysis` (a análise, com `status`/`progress`/`confidence`/`reviewCount`),
`AIAnalysisPlayer` (o plantel confirmado), `AIVideo` (o worker que o tem em
`holder`, ou — no caminho antigo — a chave no bucket privado `ai-videos`;
nunca URLs; `PURGED` depois de processado), `AIJob` (fila), `PlayerTrack`, `DetectedEvent`,
`AIInsight`, `HumanCorrection`, `PlayerIdentityProfile`, `AIModelVersion`
(plataforma: que modelo, com que licença, produziu que números).

Duas decisões que não são de arrumação:

- **As posições por frame vivem no Storage** (`PlayerTrack.dataKey`, JSON
  comprimido), não na base — meio milhão de linhas por análise não é um dado
  relacional. Na base fica o resumo que as listas leem.
- **Vocabulário em texto, estados em enum.** `DetectedEvent.kind` e
  `AIJob.kind` são texto como `Sport.positions` — o futsal e o basquetebol
  entram sem migração. `AIAnalysisStatus`/`AIJobStatus` são máquinas de
  estados, e essas são enums.

## Identidade sem biometria facial

São menores; RGPD à cabeça. A identificação combina o **plantel confirmado
antes do processamento** ("#10 = Rui Silva" transforma um problema de mundo
aberto numa escolha entre dezasseis), número de camisola, aparência de corpo
inteiro, trajetória e confirmação humana. Os embeddings vivem no Storage
(`PlayerIdentityProfile.embeddingKey`) para o apagamento ser apagar um
ficheiro. Reconhecimento facial fica fora da base do sistema; qualquer uso
futuro de biometria é decisão jurídica à parte.

## Human-in-the-loop e active learning

Abaixo de 0,75 de confiança (`REVIEW_THRESHOLD`, gémeo cliente/servidor), um
resultado pede revisão. Uma correção de identidade vale para o **track
inteiro**, nunca um frame, e fica em `HumanCorrection` com o antes e o depois
— não é um log, é o dataset do fine-tuning futuro (`exportedAt` marca o que já
foi usado). O caminho previsto: modelos genéricos → embeddings do clube →
correções → fine-tuning periódico. Nunca re-treinar a cada correção.

## Modelos — só licenças limpas

Regra dura, com o crivo escrito em [`ai-worker/LICENSES.md`](../ai-worker/LICENSES.md):
torchvision (BSD-3) para detecção, ByteTrack via `supervision` (MIT), OpenCV
(Apache-2.0), FFmpeg por processo (LGPL). **Ultralytics YOLO excluído —
AGPL-3.0** contaminaria o SaaS. O worker regista cada modelo em
`AIModelVersion` com a licença: a proveniência dos números fica na base.

## Permissões e segurança

`ai:read`/`ai:write`, gémeas cliente/servidor, à parte de `training:*` (o
vídeo de um jogo é imagem de menores; planear um treino não é a mesma
decisão). O âmbito manda como em tudo: um treinador analisa as equipas dele.
A migração `20260902200000_academias_ai` levou as permissões aos cargos
existentes (o padrão de `area_tecnica_nos_cargos`) e está registada em
`permissoes-distribuidas.json`. Bucket privado, links assinados curtos, RLS em
todas as tabelas de tenant, e apagar uma análise varre primeiro a pasta no
Storage — se o Storage falhar, a linha fica, para nada ficar órfão.

## Os dois tectos que o primeiro jogo a sério encontrou

Um jogo de 111 minutos chegou aos 100 % e recuou para os 15 %, duas vezes, até
falhar e levar o vídeo com ele na purga. Não foi a visão computacional: foram
dois limites de infra-estrutura no caminho de volta.

- **100 KB de corpo no `body-parser`.** O `detect_track` devolve um registo por
  track e trouxe 1,1 MB; o `complete` levava 413, o worker reportava falha, o
  job voltava à fila, e a análise recuava para o fim da verificação de qualidade
  — que é exactamente o que 15 % quer dizer (`overallProgress`). O tecto subiu
  para 16 MB **só em `/api/ai/worker`**, montado antes do parser global: um
  pedido de 10 MB numa rota de sessão continua a ser um ataque, não um
  utilizador.
- **Um `INSERT` por track dentro de uma transação de 5 s.** Passava com os vinte
  e dois tracks de um jogo bem seguido e estourava com os milhares que o
  ByteTrack produz sem Re-ID. Passou a `createMany` em lotes de 500 (o tecto de
  65 535 parâmetros do Postgres chega por volta dos cinco mil tracks), e o
  `complete` corre com `timeoutMs: 60_000` — falhar ali é o pior sítio para
  falhar, porque o trabalho está todo feito e perde-se inteiro.

**O número de tracks é o sintoma que fica.** Milhares num jogo querem dizer que
cada oclusão parte um track em dois — é a ausência de Re-ID e de compensação de
movimento de câmara a ver-se nos dados. Resolve-se na fase da identificação, não
aqui; o que estas duas correcções garantem é que o resultado chega inteiro à
base para se poder olhar para ele.

## Dos tracks às pessoas — a camada de identidade

Um jogo real de 111 minutos deu **733 tracks para 22 jogadores**: cada
oclusão, saída de enquadramento ou salto da câmara abre um track novo. A
revisão contava tracks e pedia ao treinador 150 confirmações de "Track 77" às
cegas — sem imagem, sem proposta. Ele pensa "este é o Rui", não "este é o
Track 77". A arquitectura passou a ter a camada que faltava:

```
detect_track ──► recortes (folhas no Storage) ──► identify ──► PlayerIdentity ──► revisão por pessoa
     │                                                │
     └─ PlayerTrack (dado técnico) ◄──── identityId ──┘
```

- **Recortes antes da purga.** O `detect_track` guarda, por track, os três
  frames em que o jogador está maior e mais nítido — em **folhas** (grelhas de
  20×10 recortes de 128×256, o formato de entrada dos modelos de re-ID) e um
  índice, no `derived/crops/` da análise. Dez ficheiros e não dois mil; e o
  vídeo pode ser apagado a seguir, que os recortes ficam. `GET
  /api/ai/analyses/:id/crops` devolve o índice com links curtos por folha; a
  consola recorta por `background-position`.
- **`identify`**, o job entre a detecção e a purga (`ai-worker/…/identify.py`).
  Embedding de aparência por track (ResNet-50 do torchvision, BSD-3 —
  **não** um modelo de re-ID treinado; o upgrade é OSNet, e a confiança di-lo)
  mais histograma de cor do tronco; OCR de dígitos no tronco (EasyOCR,
  Apache-2.0) só onde há píxeis; agrupamento hierárquico de ligação
  **completa** com duas regras duras — dois tracks vivos ao mesmo tempo não
  são a mesma pessoa, dois grupos de cor não são a mesma equipa. Propostas só
  quando há **exactamente um** atleta do plantel com o número lido, ou quando
  a aparência se parece com alguém já confirmado. Sem sinal, `unknown` — e
  pede um humano com a imagem à frente.
- **`PlayerIdentity`** — a tabela nova: atleta (veredicto), proposta e
  confiança (guardadas mesmo depois de corrigidas — é o dado do active
  learning), número lido, lado, `status ∈ unknown|proposed|accepted|confirmed|rejected`,
  presença somada. O track aponta para ela (`SetNull`). `recomputeReview`
  conta identidades por confirmar, não tracks — e cai para a regra antiga nas
  análises anteriores à etapa.
- **Confirmar propaga.** `POST /api/ai/identities/:id/identify` escreve o
  veredicto na identidade e em todos os tracks dela, regista a
  `HumanCorrection`, e enfileira uma passagem de `identify` marcada
  `propagate`: não muda o estado nem a barra, reaproveita os embeddings
  guardados (`identities/embeddings.json.gz`) e re-agrupa com a confirmação
  como **âncora** — os fragmentos parecidos ganham a mesma proposta, e o grupo
  de cor da pessoa confirmada passa a "ours". Uma de cada vez; se já há uma na
  fila, apanha esta confirmação também.
- **A consola fala de jogadores.** "A IA identificou 16 do plantel de 20.
  Precisas de confirmar 2." — três cores por baixo (automáticos, confirmados
  por ti, por identificar), cartões com três recortes, a proposta e a
  confiança, e três gestos: confirmar, escolher outro, não é do plantel. Os
  tracks ficam em "Detalhes técnicos".
- **A convocatória é o plantel.** `NewAnalysis` pré-preenche com quem foi ao
  jogo (`MatchCallUp`, convidados incluídos, recusas desmarcadas); o plantel da
  equipa só sem jogo escolhido.

## O que o tracking vê — as alavancas de recall

Medido no mesmo jogo: os tracks cobriam **8 % do tempo de jogador**, com 1,8
pessoas seguidas em média num campo com 22. Não era o tracking: era o Faster
R-CNN a não ver jogadores de 30–50 píxeis depois de o frame descer aos 800.
A identificação organiza o que o tracking vê; não pode inventar o que ele não
viu. Três alavancas em `config.py`, todas a trocar tempo por recall, e uma
medida que as julga (`stats.meanConcurrentTracks`):

| Alavanca | O que faz | Custo |
|---|---|---|
| `AI_WORKER_TILES=2` | cada frame vai ao detector em 2×2 janelas com folga; NMS junta as fronteiras | ~4,6× a detecção |
| `AI_WORKER_SCORE_THRESHOLD=0.4` | dá ao ByteTrack detecções fracas para continuar tracks | nenhum |
| `AI_WORKER_WORK_SHORT` até 1333 | resolução de trabalho acima do tecto dos pesos | quadrático |

O `.env` local está com mosaicos 2×2 e limiar 0,4. O número que diz se chegou
é o `meanConcurrentTracks` da próxima análise — não se assume.

## O que ainda não está

**Identificação progressiva** (propor identidades durante o processamento, e
não só no fim) exige o `detect_track` por segmentos com resultados parciais —
a fila já aceita `params.fromMs/toMs`, o job ainda é monolítico. **Re-ID a
sério** (OSNet) em vez do embedding genérico. **Separação de equipas** sem
confirmação humana — hoje o lado só se atribui depois de alguém confirmar um
jogador do plantel, de propósito.

## O processamento em passes

Pass 1 a ~5 FPS (jogadores, campo, candidatos a eventos) → Pass 2 encontra os
momentos → Pass 3 reprocessa esses momentos a FPS alto. Só o Pass 1 existe
hoje; a forma da fila e dos `params` do job já suporta os outros (janelas a
reprocessar são parâmetros, não código novo).

## As fases

| Fase | O quê | Estado |
|---|---|---|
| 1 | Menu + dashboard + fundação de dados | feito |
| 2 | Upload + storage + fila de jobs + worker | feito |
| 3 | Qualidade do vídeo (real, CPU) | feito |
| 4 | Detecção + tracking (torchvision + ByteTrack) | feito no worker; melhora com GPU |
| 5 | Identificação (camisola + embedding + plantel) | feito: recortes, `identify`, `PlayerIdentity`, propostas com confiança; Re-ID genérico (upgrade: OSNet) |
| 6 | Interface de correção | revisão por pessoa com recortes e propagação; bola e campo por fazer |
| 7 | Active learning | correções guardadas com antes/depois; export por fazer |
| 8–17 | Campo/homography, bola, métricas, eventos/clips, relatório, evolução, adversários, scouting, multi-desporto | por fazer, por esta ordem |

O critério continua o de sempre: não avançar com uma fase enquanto a anterior
não estiver sólida — e quando uma capacidade ainda não é robusta, o produto
diz "não há confiança suficiente" em vez de inventar.
