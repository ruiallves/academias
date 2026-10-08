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

## O que o tracking vê — e onde é que se perdia

Medido no jogo de 111 minutos: os tracks cobriam **8 % do tempo de jogador**,
com 1,8 pessoas seguidas em média num campo com 22. A primeira hipótese foi o
detector a não ver jogadores pequenos, e as alavancas de recall (`config.py`:
mosaicos, limiar, resolução) ficaram ligadas no `.env` à espera de validação.

A validação (07/10/2026, `scripts/medir-recall.py` e `scripts/medir-tracking.py`,
no mesmo jogo, RTX 5050 de 4 GB) disse outra coisa:

| Configuração | fps | × tempo real | pessoas/frame |
|---|---|---|---|
| 800 px, sem mosaicos | 13,3 | 2,67× | 15,6 |
| 1080 px | 8,2 | 1,65× | 16,0 |
| 1333 px | 3,2 | 0,63× | 16,0 |
| mosaicos 2×2 | 0,1 | 0,03× | 20,1 |

O detector **já via 16 pessoas por frame** a 800 px. Os mosaicos viam 20 a
7 segundos por frame — a placa não tem memória para eles e o Windows passa a
usar a partilhada. A resolução quase não ajuda. **Era o tracker**: num troço de
60 s, 17,8 detectadas por frame, 11,5 seguidas, e **823 tracks abertos num
minuto**. Dois parâmetros do ByteTrack (`_build_tracker`) mentiam:

- `lost_track_buffer` é em frames **a 30 FPS** (`max_time_lost = frame_rate/30 ×
  buffer`): com `frame_rate=5` e buffer 10, um track perdido morria ao fim de
  **um** frame.
- `minimum_matching_threshold` é uma distância (1 − IoU): baixá-lo de 0,8 para
  0,5 **apertou** a associação em vez de a abrir.

Corrigidos (buffer de 2 s a 30 FPS, limiar 0,9): no mesmo troço, 15,2 seguidas
por frame e 123 tracks por minuto.

O primeiro jogo a correr na consola mostrou o resto: **a câmara não é fixa**.
Faz panorâmicas atrás da bola e aproxima e afasta, e nem sempre apanha o campo
todo. Numa panorâmica todas as caixas saltam de uma vez, a previsão do Kalman
falha para toda a gente e o tracker abre vinte identidades num frame. Entrou a
compensação do movimento da câmara (`CameraMotion` em `detect_track.py`, o GMC
do BoT-SORT): fluxo óptico de cantos do **fundo** entre frames processados, com
os jogadores tapados por máscara, uma semelhança por RANSAC, aplicada ao estado
de cada track antes de associar. No minuto 20: 70 tracks por minuto e 16,9
seguidas das 17,8 detectadas; no minuto 70 (mais zoom): 130. Ainda há
fragmentação (a `_merge_fragments` cola parte; a Re-ID a sério é o resto), mas
deixou de ser a ordem de grandeza que partia a identificação.

O que fica por resolver no tracking é o **recall nos planos abertos**: quando a
câmara afasta, um jogador tem 40 px e o Faster R-CNN a 800 px vê metade deles.
Os mosaicos não cabem nesta placa; a resposta é um detector melhor em objectos
pequenos com licença limpa (RF-DETR ou YOLOX, ambos Apache-2.0), medido com os
mesmos scripts antes de entrar. O `.env` ficou sem mosaicos e com limiar 0,4 — a
detecção a 2,67× o tempo real é o que permite o vídeo a correr.

## O vídeo a correr

A detecção demorava uma barra inteira — quarenta minutos a duas horas sem um
píxel para ver. Agora larga o que já fez aos troços, e a ficha da análise mostra
**o jogo com a IA por cima**: o `<video>` a correr, as caixas do tracking
desenhadas num canvas por cima, e um painel ao lado (pessoas em campo agora,
pessoas vistas, mapa de onde o jogo se jogou, quem está no frame). É a mesma
computação, organizada para quem está a ver. A referência é o Veo, para clubes
pequenos.

```
detect_track ──(troços de 10 s)──► POST /api/ai/worker/jobs/:id/live ──► AILiveSegment
                                                                              │
consola ◄── GET /api/ai/analyses/:id/live?after=N (3 em 3 s) ◄────────────────┘
consola ◄── GET /api/ai/videos/:id/url → bilhete de ver → GET worker/ingest/{bilhete}/video (Range)
```

- **O worker manda, não guarda.** `_LiveFeed` em `detect_track.py`: de
  `AI_WORKER_LIVE_SEGMENT_SEC` (10) em 10 s de vídeo, um troço com as caixas de
  cada frame (**tids brutos** — a numeração final só existe no fim) e os
  números até ali (frames, detecções, tempo decorrido). Numa thread própria,
  com fila de tecto: a API muda não pára a GPU, e um troço perdido ao vivo não
  é um erro. O resultado final não passa por aqui.
- **Uma tabela, não o Storage.** `AILiveSegment` (único por análise e índice):
  a consola pergunta "o que há depois do N" de três em três segundos, e pelo
  Storage isso era um link assinado por troço e por pedido — o que mata a
  cache. Dado transitório: a purga do vídeo apaga-o; as posições finais vão
  para o Storage como sempre, e a consola troca de fonte quando o
  `detect_track` fecha (`GET /api/ai/analyses/:id/positions`, descomprimido no
  browser com `DecompressionStream`).
- **Ver o vídeo onde ele está.** O ficheiro vive no disco do worker; a porta de
  ingestão passou a servi-lo com `Range` (`GET /ingest/{bilhete}/video`), com um
  bilhete de **ver** (`k: "play"`, 2 h) assinado pela mesma chave do bilhete de
  carregar — poderes diferentes, e o worker recusa um bilhete de carregar na
  porta de ver. Depois da purga não há vídeo: o mesmo palco desenha as posições
  sobre um fundo escuro, com o seu relógio.
- **Seguir a IA.** Arranca sozinho (sem som) 6 s atrás da fronteira, pára nela
  e retoma quando ela avança; a 1× ficava para trás da detecção a 1,3×, por isso
  acelera até 1,75× quando está mais de 6 s atrás e salta quando está mais de
  90 s. Desligável. Entre dois frames processados as caixas interpolam-se no
  tempo — senão ficavam 200 ms paradas ao lado de um jogador em movimento.
- **Honestidade no ecrã.** Ao vivo o painel diz "a IA vê pessoas, não nomes";
  o mapa diz "em coordenadas do vídeo — o campo em metros chega com a detecção
  das linhas". Nada é inventado para parecer melhor.

## O analista ao vivo — a ordem mudou (07/10/2026)

O Rui redefiniu o objectivo: antes de saber **quem** é cada jogador, a IA tem
de dizer o que **as equipas** estão a fazer, como um analista de banco num jogo
ao vivo — a nossa, a deles, o árbitro, a posse, onde se joga, os padrões do
adversário, e sugestões ao treinador. A identificação individual vem depois.
A ordem acordada: equipas pela cor → bola e posse → campo (calibração pelo
treinador) → padrões → sugestões → identificação individual.

### Pessoas, não fragmentos

`PersonRegistry` em `detect_track.py`: um fragmento novo do tracker herda o
número de uma pessoa perdida há menos de 4 s se estiver ao alcance (com a
câmara compensada — as pessoas perdidas movem-se com ela), com tamanho
parecido e a **mesma cor de tronco** (histograma HSV, Bhattacharyya). Sem
candidata, pessoa nova. O tracker que reencontra o próprio fragmento não passa
pelo crivo. É o número que o ecrã mostra e o que chega ao `PlayerTrack`; a
`_merge_fragments` continua a colar o que sobra, e a identificação (no fim) é
que junta quem saiu e voltou — por posição isso é impossível, e não se finge.

### Equipas pela cor

`TeamClassifier`: por pessoa, a mediana Lab do tronco sem a relva (verde por
matiz), acumulada no tempo; de 5 em 5 s de vídeo, k-means (3–4 grupos) sobre
as pessoas com observações que cheguem; **as duas maiores** são as equipas,
o resto é "outros" (árbitro, guarda-redes). As letras A/B ficam estáveis
entre refrescamentos (o centro novo mais perto herda a letra). Qual é a nossa
**não se adivinha**: o treinador clica na cor no painel (`PATCH
/api/ai/analyses/:id/kit`, `AIAnalysis.oursKitColor`), e `resolveSides` passa
A/B a `ours`/`theirs` nos tracks — quando a cor chega e quando a detecção
fecha, por essa ordem ou pela outra.

### Bola e posse

O detector COCO já sabia o que é uma bola desportiva; só se deitava fora.
`BallTracker` aceita uma candidata se estiver ao alcance da última vista (com
a câmara compensada) ou se a última for velha; o que sai é "vista aqui" ou
nada. A posse calcula-se na consola: a bola é de quem a tem a menos de 1,6
alturas de corpo; sem bola vista, a última posse vale 2 s. **Sempre com a
cobertura ao lado** ("bola vista 38 % do tempo"): num plano aberto a bola tem
dez píxeis e falha mais do que acerta, e um número de posse sem isso era uma
mentira. O ficheiro final leva `ball`, `teams` e `kitGroups`.

### A bola de perto, e as de reserva

O primeiro jogo mostrou a bola mal vista e, pior, bolas de reserva atrás da
baliza a passarem por bola do jogo. Não era a qualidade do vídeo: a 800 px de
lado curto a bola tem dez píxeis. `_ball_zoom` recorta uma janela de 480 px
do **frame original** à volta de onde a bola estava (ou do centro dos
jogadores) e passa-a pelo mesmo detector com zoom — uma inferência pequena de
3 em 3 frames (de 2 em 2 quando perdida). O `BallTracker` prefere candidatas
perto de jogadores, marca como "estacionada" uma bola parada mais de 4 s
longe de toda a gente e ignora-a daí em diante, e troca para uma bola com
gente quando a seguida está longe de todos. Medido: bola vista em 71–74 % dos
frames no minuto 20 e no 70. O "dentro das linhas" chega com a calibração.

### O quadrado que saltava entre dois jogadores

Troca de identidades do tracker quando dois se cruzam. `PersonRegistry._undo_swaps`:
para cada par de caixas coladas compara a cor do tronco de cada uma com a cor
guardada de cada pessoa e, se trocadas batem claramente melhor, troca os
números de volta. Resolve o caso de equipas diferentes; entre dois colegas de
equipa não há sinal visual, e isso só com os números das camisolas.

### A velocidade, e o que a estava a comer

Dois achados nesta RTX 5050 de portátil (4 GB), ambos medidos:

- **`cudnn.benchmark=True` era veneno.** Com a detecção em pipeline já
  aquecida: 1,15× o tempo real ligado, **2,56×** desligado. Ligado, cada forma
  de entrada nova (o lote de 8, o lote parcial do fim, a janela da bola)
  custava uns vinte segundos de medição de algoritmos a meio do jogo, e os
  algoritmos escolhidos pediam espaço de trabalho que a placa não tem. Era
  isto que fazia as medições curtas do dia variarem entre 0,6× e 1×.
- **A GPU não pode esperar pela CPU.** Entre lotes, uns milissegundos de
  tracker na CPU chegavam para a placa baixar o relógio; `_pipeline` corre a
  detecção numa thread, um lote à frente de quem consome.

Com tudo ligado (câmara, pessoas, equipas, bola com zoom): **1,95× o tempo
real** nos dois troços medidos, aquecimento incluído.

### O campo em metros — a calibração do treinador

O primeiro jogo com equipas e bola mostrou o que falta a tudo o resto: a IA
contava gente na bancada e apanha-bolas, e escolhia bolas de reserva atrás da
baliza. Sem saber onde é o campo, nenhuma regra resolve isso de forma limpa.

- **O treinador calibra** (`PATCH /api/ai/analyses/:id/calibration`,
  `AIAnalysis.calibration`): no painel, "Calibrar o campo" pára o vídeo; um
  desenho do campo com os pontos conhecidos (cantos, grande e pequena área,
  meio-campo, círculo, penáltis — `pontosDoCampo` em `lib/homografia.ts`);
  clica-se um ponto no desenho e o sítio dele no vídeo, 4 a 6 vezes; as
  medidas do campo editam-se ali (105 × 68 por omissão). A consola calcula a
  homografia imagem → metros por mínimos quadrados normalizados e mostra o
  erro máximo de reprojecção; o servidor volta a verificá-lo (3 m) antes de
  guardar — quatro cliques com um trocado dão uma matriz válida e um campo
  torto.
- **O worker arrasta-a com a câmara** (`PitchTracker` em `detect_track.py`):
  acumula a cadeia de semelhanças da compensação de câmara desde o início e
  guarda-a por frame; um ponto do frame `t` vai ao frame da calibração por
  `C_t0 · C_t⁻¹` e daí a metros por `H0`. A calibração chega **a meio do jogo**
  pela resposta do heartbeat (`job["live"]`), e vale para trás e para a
  frente. Um corte de câmara (salto de um quarto do frame, ou a cadeia sem o
  frame da calibração) marca-a como `lost`; o painel diz "a câmara cortou,
  volta a calibrar". Deriva lenta entre cortes existe e é reconhecida: a
  re-ancoragem nas linhas brancas é a fase seguinte.
- **Efeitos**: cada caixa e a bola levam X, Y em metros (nulos sem
  calibração) nos troços ao vivo e no ficheiro final (`metres`, `pitch`);
  quem está fora das linhas (1 m de folga) não entra nas equipas, nas
  contagens, na posse nem no mapa, e desenha-se apagado; as candidatas a bola
  fora das linhas saem antes do tracker; o mapa de calor passa a ser sobre o
  campo em metros, com as linhas por cima.

### O que vem a seguir

Os padrões em metros ("atacam pela nossa direita", altura da linha defensiva,
largura, remates: bola a entrar na zona da baliza com velocidade) e, deles, as
sugestões ao treinador — números com confiança; um modelo de linguagem dá a
frase, nunca o número. Depois: re-ancoragem da calibração nas linhas, um
detector melhor em objectos pequenos (RF-DETR/YOLOX, Apache-2.0) para os
planos abertos, e só então a identificação individual.

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
| 4 | Detecção + tracking (torchvision + ByteTrack) | feito no worker; ByteTrack afinado a 07/10; o vídeo a correr com as caixas por cima |
| 5 | Identificação (camisola + embedding + plantel) | feito: recortes, `identify`, `PlayerIdentity`, propostas com confiança; Re-ID genérico (upgrade: OSNet) |
| 6 | Interface de correção | revisão por pessoa com recortes e propagação; bola e campo por fazer |
| 7 | Active learning | correções guardadas com antes/depois; export por fazer |
| 8–17 | Campo/homography, bola, métricas, eventos/clips, relatório, evolução, adversários, scouting, multi-desporto | por fazer, por esta ordem |

O critério continua o de sempre: não avançar com uma fase enquanto a anterior
não estiver sólida — e quando uma capacidade ainda não é robusta, o produto
diz "não há confiança suficiente" em vez de inventar.
