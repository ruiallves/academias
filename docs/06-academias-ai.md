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
  webhook). Não tem credenciais da base nem do Storage: o vídeo chega por link
  assinado, os artefactos sobem por links assinados pedidos job a job. Mover o
  worker para uma GPU na cloud é copiar o processo e o token.
- **A fila é uma tabela** (`AIJob`, `FOR UPDATE SKIP LOCKED`). O stack não tem
  Redis e não precisa: dois workers nunca levam o mesmo job, um worker morto
  devolve o job à fila por falta de heartbeat, e as tentativas têm tecto.
- **O claim atravessa tenants** (é infra da plataforma, via `PlatformPrisma`);
  todas as escritas seguintes voltam ao `runAs(academyId)` com RLS, como
  qualquer pedido.

## Dados

`AIAnalysis` (a análise, com `status`/`progress`/`confidence`/`reviewCount`),
`AIAnalysisPlayer` (o plantel confirmado), `AIVideo` (chave no bucket privado
`ai-videos`, nunca URLs), `AIJob` (fila), `PlayerTrack`, `DetectedEvent`,
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
| 5 | Identificação (camisola + embedding + plantel) | infraestrutura pronta, modelo por integrar |
| 6 | Interface de correção | identidade de tracks feita; bola e campo por fazer |
| 7 | Active learning | correções guardadas com antes/depois; export por fazer |
| 8–17 | Campo/homography, bola, métricas, eventos/clips, relatório, evolução, adversários, scouting, multi-desporto | por fazer, por esta ordem |

O critério continua o de sempre: não avançar com uma fase enquanto a anterior
não estiver sólida — e quando uma capacidade ainda não é robusta, o produto
diz "não há confiança suficiente" em vez de inventar.
