# Estado da implementação

Resumo do que existe, a 17 de agosto de 2026. Para o *porquê* de cada decisão, ver
[00-produto](00-produto.md), [01-design](01-design.md) e [02-arquitetura](02-arquitetura.md).
Para o painel de quem é dono do SaaS, à parte de tudo o resto deste documento, ver
[04-plataforma](04-plataforma.md).

---

## Fundação

| | |
|---|---|
| Monorepo | npm workspaces: `apps/console`, `apps/family`, `apps/api`, `apps/platform`, `packages/ui` |
| Sistema de design | tokens partilhados, Tailwind v4 em CSS, Instrument Sans + Geist Mono |
| Permissões | 31 permissões, 8 papéis, âmbito por equipa/atleta — cliente e servidor, gémeos |
| Dados reais | `npm run seed`: 1 academia, 2 equipas, 9 atletas, 5 pessoas de staff, 2 famílias, 3 jogos |

**A consola lê a base de dados a sério.** `data/demo.ts` foi apagado — não existe
mais. `lib/store.ts` traz a academia da API ao arrancar (`GET /api/bootstrap` +
leituras em paralelo) e os ecrãs continuam a escrever `teams.filter(...)` como
sempre escreveram, através de *live bindings* de ES modules. Onde ainda não há
endpoint — avaliações, histórico de equipas — os dados vêm **vazios**, nunca
inventados: um ecrã que diz "ainda não há avaliações" é honesto.

**A sessão renova-se sozinha.** O token do Supabase dura **uma hora**, e o
`refreshToken` era guardado desde sempre sem nunca ser usado — o resultado
aparecia todos os dias a quem tem a consola aberta ao trabalho: ao fim de uma
hora cada pedido voltava 401, o arranque engolia-os em silêncio (`soft` em
`lib/store.ts`), os ecrãs ficavam vazios sem explicação, e a pessoa recarregava
a página para perceber — para depois ser mandada entrar outra vez.

`getAccessToken()` passa a verificar a validade antes de entregar o token e a
trocá-lo quando falta menos de um minuto; um 401 que escape (relógio adiantado,
token revogado noutro sítio) renova e **repete o pedido uma vez**. As renovações
são coalescidas numa só — o arranque dispara nove pedidos em paralelo e não
precisa de nove renovações iguais. Uma falha de **rede** não desliga ninguém: só
uma recusa do Supabase (4xx) termina a sessão, e aí volta-se à porta do clube em
vez de ficar às escuras. As cinco funções de pedido passaram a uma (`pedir`),
porque a renovação em cinco cópias era a garantia de uma ficar para trás — como
já tinha acontecido com o `Content-Type`, que duas delas não punham.

É a mesma solução nas **três** apps — consola, famílias e painel da plataforma —
de propósito: três apps a resolver o mesmo problema de três maneiras são três
maneiras de o ter partido. Verificado por `npm run test:refresh` (13), que prova
as duas pontas: que um token fora de validade é mesmo recusado pela nossa API, e
que o refresh troca por um par novo que ela aceita.

**Ninguém fala com a API por fora.** `lib/callups.ts` tinha um cliente HTTP
próprio que lia a sessão de `sessionStorage` — a sessão mudou-se para
`localStorage` há muito, o `http.ts` acompanhou, e esta cópia ficou a ler um
sítio vazio: **submeter uma convocatória ia sem token**, e o servidor respondia
"Falta o token de sessão". O problema não era o nome do armazenamento; era haver
dois sítios a saber a mesma coisa, e o segundo não acompanhar. Com o `http.ts` a
ganhar responsabilidades (renovar, repetir no 401, declarar o `x-app`), cada
cópia paralela é tudo isso a menos, em silêncio.

`npm run check:http` é a rede — corre dentro do `typecheck`, porque um cliente
paralelo **compila na perfeição** e o compilador nunca o apanharia. Falha se
alguém voltar a chamar a nossa API fora do `lib/http.ts` de cada app, ou a ler a
sessão do armazenamento fora do `lib/session.ts`. As excepções legítimas estão
listadas com o porquê de cada uma: os carregamentos directos para o Supabase
(desenho de propósito — os bytes não passam pela API) e os endpoints públicos de
convite, de quem ainda não tem conta.

**Autenticação de ponta a ponta.** Entra-se pela página da academia
(`GET /l/:slug`), que autentica contra o Supabase e entrega a sessão à consola —
por `sessionStorage` partilhado em produção (mesma origem), por fragmento de URL
em desenvolvimento (portas diferentes, nunca na query, nunca no servidor). A
consola não tem login próprio: quem lá chega sem sessão é reencaminhado para a
página do clube, e não há dois formulários de entrada para manter em sintonia.

**Permissões como dados.** Nada pergunta `if (role === "coach")`. A navegação, as
colunas das tabelas e os botões são todos derivados de `can(session, permissão)` —
um item sem permissão não aparece, nem sequer desactivado.

**Multi-desporto no modelo.** Posições, competências, lado dominante e duração de
jogo são configuração da modalidade. A natação não tem posições nem jogos, e a UI
adapta-se por ausência — sem um `if (desporto === …)` em lado nenhum.

---

## Consola — Direção

| Ecrã | O que faz |
|---|---|
| **Visão geral** | "Precisa de atenção" (lista accionável) antes das métricas · faixa da semana · cobrança por escalão |
| **Primeiros passos** | painel ao canto, seis passos derivados dos dados reais (equipas, atletas, convites, treinos, famílias) — desaparece sozinho quando tudo estiver feito |
| **Atletas** | lista filtrável, criação, filtros por ficha médica e baixa clínica |
| **Ficha do atleta** | separadores por visão geral, jogos, assiduidade, clínico, encarregado — com etiqueta "Convocado" quando aplicável |
| **Famílias** | encarregados, contactos, **quem já instalou a app**, e o link de convite para a app |
| **Equipas** | grelha de cartões + ficha por equipa com vários separadores |
| **Staff** | direção, equipa técnica, departamento clínico, operações — cargo *e* acesso; convites pendentes à vista |
| **Ficha de staff** | contactos, histórico de equipas por época, atividade de quem treina, e **acesso configurável pessoa a pessoa** |
| **Calendário** | agenda + grelha de mês, cor por escalão, criar eventos, detalhe de jogo |
| **Presenças** | três blocos por urgência — por registar, registados, a seguir — em vez de uma tabela única |
| **Convocatórias** | montar e submeter a lista de um jogo, com tecto configurável por equipa, convite de atletas de escalões inferiores e folha de convocatória para imprimir |
| **Mensalidades** | por período ou todos, dívida real de sempre (não só do mês) |
| **Comunicação** | avisos com taxa de leitura |
| **Avaliações** | plantel por período, editor contínuo, publicação em lote — ver *Avaliações e relatórios* |
| **Relatórios** | texto por atleta, **interno ou partilhado com a família**, cobertura das avaliações por equipa |
| **Definições** | white-label ao vivo, catálogos, matriz de permissões (papéis), importação ZeroZero |

A direção tem **todas** as permissões, incluindo `clinical:write` — regista e dá
alta no boletim como regista em tudo o resto. A rastreabilidade de um diagnóstico
não vem de restringir quem escreve; vem de `ClinicalEntry.authorId`, que guarda
sempre quem o registou.

## Consola — Equipa técnica

Visão geral (próximo treino) · Equipas · Atletas · Calendário · Presenças ·
Convocatórias · Clínico · Avaliações · Relatórios · Comunicação — **tudo limitado às
suas equipas**, aplicado na fronteira de dados e não em cada ecrã.

O treinador tem `calendar:write` **dentro do seu âmbito**: cria treinos e jogos
para as suas equipas, mas a opção "toda a academia" não lhe aparece no diálogo —
essa fica só para quem não tem `scope.teamIds` (direção e coordenação), a mesma
condição que o servidor usa para decidir "sem limite". O mesmo âmbito rege a
**Comunicação**: o treinador manda avisos, mas só para os pais das suas equipas — o
público "Geral" e "Treinadores" é da direção. Dentro de "Pais", os dois podem
**recortar por escalão** — a direção sobre a academia, o treinador sobre as
equipas dele.

## Consola — Departamento clínico

Visão geral (quem está parado, reavaliações da semana, exames expirados) ·
Boletins · Consultas · Atletas · Equipas · Calendário. Vê a academia toda: uma
lesão não conhece escalões.

---

## Peças que atravessam o produto

**Disponibilidade clínica.** Não é um campo — é derivada do boletim. Enquanto
existir uma baixa sem alta, o atleta aparece marcado na ficha, na lista, no
plantel e em "Precisa de atenção"; **não pode ser convocado** (o servidor recusa,
com o nome do atleta no erro) e **não conta como falta** no registo de presenças.

O aviso chega ao cliente porque o `/api/athletes` manda `availability` e
`restriction` em cada atleta, e o store os converte na entrada de `clinical` que
`activeRestriction` lê. **O store deitava-os fora**, e o efeito era o pior
possível: `athlete.clinical` ficava sempre vazio, ninguém aparecia bloqueado no
plantel, e o treinador montava a convocatória inteira para levar com "a Matilde
está de baixa" ao guardar — com um nome que ele não fazia ideia de porque estava
ali. A interface já tinha o bloqueio e a etiqueta com o motivo; só nunca recebia
os dados.

**O retorno previsto que já passou** deixa de parecer uma avaria. Uma baixa só
termina com alta — o previsto é uma estimativa do departamento clínico, e deixar
a data curar o atleta sozinha seria inventar um acto médico. Mas quando essa
data fica para trás, o motivo do bloqueio passa a dizer *"Falta dar alta ·
retorno previsto 27/08"* em vez de repetir o diagnóstico: a regra é a mesma, e o
treinador percebe o que falta e a quem pedir.

Verificado por `npm run test:callup-blocks` (11), que cobre as duas metades — a
recusa do servidor, e o `/api/athletes` a trazer a disponibilidade a um
treinador, que é do que a interface precisa para avisar **antes**.

**Quem lê o quê.** `clinical:status` (estado e retoma) chega a toda a gente;
`clinical:read` (diagnóstico e notas) chega à direção, equipa técnica e família;
`clinical:write` chega à direção e ao departamento clínico.

**Presenças como faltas.** Guarda-se a excepção, não a norma. Um treino com lista
vazia significa "estiveram todos" — e é diferente de "ninguém verificou", que
aparece como lacuna e não infla a assiduidade.

**Toda a gente é clicável.** Um `PersonLink` partilhado leva da lista de staff, do
plantel de uma equipa, de um treino por registar ou do calendário até à ficha da
pessoa — sempre o mesmo comportamento, um sítio só a manter.

---

## Convocatórias

`Presenças` deixou de se chamar `Treinos` — o menu diz o que se faz lá, não o que
se vê. `Convocatórias` é ecrã novo, para treinador e direção: monta-se a lista de
um jogo escolhendo do plantel, e **guardar não avisa ninguém** — só **submeter**
fecha a lista e notifica as famílias dos convocados. É a distinção que impede um
pai de receber cinco avisos contraditórios pela tarde.

**Sobe, nunca desce.** Um treinador pode convidar um atleta mais novo — um
Sub-13 pode reforçar-se com um miúdo de 11 anos — nunca ao contrário. A regra
compara a **idade do atleta** com o `Team.maxAge` da equipa do jogo: idade do ano
da época (`ano da época − ano de nascimento`, agosto a julho), para ninguém ficar
inelegível a meio da época no dia dos anos. Ver `birthdateFloor` em
`matches.service.ts`.

Comparava **equipas** — lia um número de dentro do texto do escalão (`"Sub-13"` →
13) — e isso falhava de duas maneiras: um miúdo de 12 anos inscrito nos Sub-11
subia aos Sub-13 por causa da equipa onde está e não da idade que tem, e uma
academia que escrevesse "Iniciados A" ficava sem número e sem convidados
nenhuns, em silêncio. O escalão em texto deixou de existir (ver *A equipa não tem
escalão*).

O que se mostra de uma equipa alheia é nome, número, posição e disponibilidade —
nunca o diagnóstico, que fica fora do âmbito de quem convida.

O tecto de convocados (`Team.maxCallUps`) é configurável por equipa, ali mesmo no
ecrã. Um convocado emprestado aparece marcado como tal na convocatória e na
própria ficha ("Emprestado ao Sub-13"), e o pai recebe uma notificação concreta —
adversário, hora, sítio — não um "tens uma notificação".

### A folha para levar para o campo

No dia do jogo o telemóvel não serve para nada: o treinador precisa de papel onde
cada encarregado assina que entregou o miúdo e onde se aponta quem vai no carro de
quem. **Exportar** — no ecrã de Convocatórias e na página do jogo — gera essa folha
e abre o diálogo de impressão do navegador, onde "Guardar como PDF" faz o ficheiro.

**Só depois de submetida.** A folha é o documento que as famílias assinam, e a lista
que elas receberam é a submetida; um rascunho ainda muda — sai o papel, entra um
lesionado, e no ponto de encontro há assinaturas por um plantel que já não é aquele.
Os dois ecrãs só mostram o botão com a lista fechada, e a regra em si vive à entrada
de `printCallUpSheet`, para um terceiro ecrã não a descobrir sozinho.
Não entrou biblioteca de PDF nenhuma: a folha é HTML num `iframe` escondido, e é o
motor de impressão que pagina, repete o cabeçalho da tabela na segunda página e usa
as fontes do produto. Ver `lib/callup-sheet.ts`.

A folha tem o que o papel de sempre tem — número, nome, transporte, assinatura,
observações, e a linha do treinador — e o que o papel não pode ter: quem já
confirmou na app (só depois de submetida), a equipa de origem de um convidado, e o
próximo treino, que sai do calendário em vez de se copiar à mão.

A logística de um dia — prova, jornada, ponto e hora de encontro — pergunta-se no
diálogo e **não** subiu ao modelo do jogo: seriam campos vazios em novecentos jogos
por época. O que se repete fica guardado por equipa no navegador de quem imprime, e
as horas guardam-se em minutos antes do apito, para servirem um jogo às 10:00 e
outro às 15:00.

Verificado por `npm run test:callups` (22, o essencial) e
`npm run test:guest-callups` (11, a regra de subida e o que se pode ver de fora).

## Área técnica

O produto de futebol dentro da Academias: grupo próprio no menu, a seguir a
Operação, com **Treinos**, **Jogos** (mudou-se para cá), **Exercícios**,
**Modelos de jogo** e **Bolas paradas**. Permissões novas `training:read` /
`training:write`, gémeas cliente/servidor: o treinador e a coordenação têm as
duas, a direção tudo como sempre, clínico/scouting/famílias nada — o grupo
aparece-lhes só com Jogos, que continua a pedir `calendar:read`.

### O plano vive na sessão

Um treino planeado e um treino do calendário são o **mesmo** treino — o plano
são colunas nulas em `TrainingSession` (objetivo, tipo, intensidade, material,
notas, pós-treino) mais os blocos (`SessionBlock`: ordem, duração, objetivo,
exercício). Um bloco tem **seis campos e mais nenhum**: nome, minutos,
intensidade, objetivo, número de jogadores e observações. Dimensões e material
saíram — são do **exercício**, e tê-los também no bloco era a mesma informação
em dois sítios a divergir à primeira correção; quem precisa delas abre a ficha
do exercício, que está a um clique dali. As colunas ficam na base (não se apagam
dados por arrumação) mas deixaram de ser escritas. Marcar continua a ser do
calendário; `/treinos` é o planner — a
semana de segunda a domingo com carga acumulada, distribuição por objetivo e o
que está por planear — e `/treinos/:id` é o construtor da sessão. O detalhe de
um treino no calendário ganhou "Abrir plano de treino".

**Os blocos reordenam-se a arrastar**, pelo manípulo de três linhas à esquerda
do número — os botões "Subir"/"Descer" saíram. A lista reordena-se **ao vivo**
(os blocos afastam-se para dar lugar) e só marca o plano por gravar no fim,
senão um arrasto de três linhas contava como três edições. Ao pegar, **todos os
blocos fecham** — um bloco aberto ocupa meio ecrã e esconde o alvo — e ao largar
reabre o que estava, já no lugar novo: seguido pela **referência ao bloco** e
não pelo índice, senão arrastar um bloco com outro aberto reabria o errado.
Pointer events e não o `draggable` do HTML, que não funciona em toque — e isto
é para ser usado no tablet à beira do campo.

**O exercício importa-se para dentro do bloco.** O botão *Importar exercício*
cria um bloco a partir da biblioteca, e cada bloco aberto tem a sua própria
importação — que faltava: quem criasse um bloco à mão ficava sem forma de lhe
anexar um exercício a seguir. O bloco mostra o **desenho** do exercício (é assim
que um treinador o reconhece, não pelo nome), com atalho para a ficha, troca e
"soltar" — e importar para um bloco que já existe **só preenche o que estiver
vazio**, nunca apaga o que lá está escrito. A escolha é uma grelha de cartões
com os desenhos à vista, pela mesma razão que a biblioteca o é.

**A carga nunca se guarda.** É derivada (duração × intensidade dos blocos,
ponderada → 0–100, Baixa/Moderada/Alta/Muito alta) e calcula-se na leitura — ver
`sessionLoad` em `lib/training.ts`. O dia em que houver carga realizada (RPE,
GPS), esta passa a ser "a planeada" e compara-se; é também o terreno preparado
para a IA: os alertas da semana ("sem minutos de transição planeados") já são
derivados dos mesmos dados, nunca inventados.

### Biblioteca de exercícios

`Exercise` com metadados de filtro (categoria, sub-objetivos, tipo, intensidade,
jogadores, duração, dimensões, material, idades, complexidade) em **texto, não
enums** — vocabulário do treino, como `Sport.positions`. Regras, progressões,
regressões, comportamentos esperados e erros frequentes são campos próprios;
vídeo é link externo (o upload, quando vier, segue o caminho do scouting).
"Usado 17×, última a 24/08" é **derivado** dos blocos das sessões, nunca um
contador. Favoritos por pessoa (`ExerciseFavorite`). Apagar um exercício já
usado **arquiva** — o histórico dos treinos não perde o desenho.

**Visibilidade em duas escolhas com consequência escrita**: *Todo o clube* ou
*Só eu* (`LibraryVisibility`), filtrada no servidor em todas as leituras — um
privado alheio não se lê, não se edita, e não entra num plano por id (400). O
exercício de um colega não se edita: **duplica-se**, e a cópia nasce privada.
A direção e a coordenação editam por cima do autor; o critério é
`teamScopeFilter === undefined` cruzado com `training:write`.

### As cinco variantes

Um clube de formação não joga uma modalidade — joga cinco, e cada uma tem outro
campo, outras marcações e outros sistemas. Um 2-3-1 não existe em campo de onze,
e um 4-3-3 não cabe num campo de 7:

| | Campo | Círculo | Área | Baliza |
|---|---|---|---|---|
| **Futebol 11** | 105×68 | 9,15 | 16,5×40,32 (+ pequena) | 7,32 |
| **Futebol 9** | 72×50 | 7 | 13×26 (+ pequena) | 6 |
| **Futebol 7** | 55×37 | 6 | 10×20 | 6 |
| **Futebol 5** | 42×25 | 4 | 8×16 | 3 |
| **Futsal** | 40×20 | 3 | arco de 6 m, 2.ª marca aos 10 | 3 |

- **A variante é propriedade do desenho** (`Diagram.field` = variante +
  extensão). Os nomes antigos `"full"`/`"half"` continuam gravados e lêem-se
  para sempre (`normalizeField` traduz para `f11`/`f11-half`) — um dado antigo
  não se migra por estética.
- **As marcações são derivadas de `FORMAT_PITCH`**, não desenhadas à mão por
  campo: eram dois componentes e com cinco variantes seriam cinco cópias a
  divergir. Quem acrescentar uma variante escreve as medidas e não toca no
  desenho. A geometria está coberta por verificações (a área contém a marca de
  penálti, o círculo cabe entre as laterais, as áreas não se tocam) — foi assim
  que se apanhou o futebol 5 com a marca aos 7 m dentro de uma área de 6.
- **Os símbolos encolhem com o campo** (`itemScale = max(0.45, w/105)`): um
  círculo de 1,9 m que fica bem no campo de onze tapava meia área num de 42. As
  posições e as zonas continuam em metros verdadeiros.
- O pavilhão desenha-se em **madeira**, não em relva — num cartão pequeno da
  biblioteca percebe-se logo se é campo ou pavilhão.
- **Sistemas por variante**: 13 de futebol 11, 6 de futebol 9 (3-3-2, 3-2-3,
  2-3-3, 3-4-1, 2-4-2, 3-1-3-1), 6 de futebol 7 (2-3-1, 3-2-1, 1-3-2, 2-2-2,
  3-1-2, 2-1-3), 4 de futebol 5 e 5 de futsal (3-1, 4-0, 2-2, 1-2-1, saída a 5).
  Cada lista está nos metros do seu campo, não em frações: um "DC a 20 metros
  da linha" lê-se e corrige-se.
- **A equipa sugere a variante** (`teamFormat`): primeiro o nome do desporto
  quando o diz ("Futsal", "Futebol 7"), depois a idade — até aos 7 joga-se a 5,
  aos 9 e 11 a 7, aos 13 a 9, dos 15 para cima a 11, que é a convenção da FPF.
  É um ponto de partida, nunca uma imposição. Um exercício novo, que não tem
  equipa, nasce na variante mais jogada do clube (`clubDefaultFormat`).
- **As bolas paradas nascem com o lance montado na variante certa**: as posições
  descrevem-se uma vez em frações do campo e escalam-se; o que muda com a
  variante é **quanta gente entra**, porque um canto de futebol 5 não tem seis
  atacantes na área.

### Imagens no exercício

Até seis por exercício (montagem no campo, prancheta), pelo mesmo caminho de
três passos das fotografias — autorizar, o browser carrega direto para o
Supabase, confirmar — num bucket próprio (`exercicios`), privado, com links
assinados de 6 h gerados a cada leitura. Editar imagens é editar o exercício:
mesma porta (`training:write` + autoria). Apagar o exercício a sério limpa as
imagens do armazenamento; arquivar mantém tudo.

### A biblioteca não nasce vazia

`npm run seed:exercises` semeia os clássicos — 14 de futebol 11 (rondos 5v2/4v2,
posse 4v4+3, posse 6v4 sob pressão, Y de passe, terceiro homem, cruzamentos em
ondas, 1v1, transição 3v2, rondo de reação à perda, 4v4 de coberturas, jogo
posicional em 3 corredores, circuito de velocidade, ativação), 4 de futebol 7
(posse 4v2, saída do GR, cruzamento e finalização, pressão 3v3), 3 de futebol 9
(construção de trás, transição 3v2, bloco médio) e 8 de futsal (rotação 4-0,
paralela e diagonal, jogo com pivô, posse 3v3+1, transição 2v1, 1v1 defensivo,
saída de pressão a 3, power play 5v4) — cada um **no terreno da sua variante**,
com ficha completa e desenho animado por frames. Idempotente por nome e academia
(um arquivado conta como existente — o clube que o tirou decidiu).

Na biblioteca aparecem marcados como **"Base"**, e a ficha diz de onde vêm: é a
resposta à pergunta óbvia de quem os abre, e explica ao mesmo tempo porque é que
qualquer treinador os pode afinar e nenhum os apaga. **Sem autor é do clube**: editar
está aberto a qualquer pessoa com `training:write` — corrigir uma distância,
adaptar o desenho ao escalão — mas apagar é só de quem responde pelo clube
inteiro (`mayDelete`), senão um treinador limpava a biblioteca comum num gesto.
A ficha diz as duas coisas em separado (`editable`/`deletable`). **Correr para
academias novas** — a criação de academia não o corre sozinha.

### O editor visual

`FieldEditor` (SVG, pointer events — funciona em tablet): os quatro terrenos
nas medidas reais (coordenadas em metros), paleta de elementos
(jogador, GR, adversário, bola, cone, estaca, barreira, balizas, escada, boneco,
zona redimensionável, texto), seis tipos de seta com a convenção dos quadros
táticos (passe a cheio, deslocamento tracejado, condução ondulada, remate duplo,
pressão pontilhada, cruzamento curvo), seleção múltipla, duplicar, undo/redo
(Ctrl+Z/Y), zoom com a roda e pan. Tocar num elemento que já existe seleciona e
arrasta **mesmo com a paleta armada** — o carimbo só carimba em campo vazio; em
modo seta, o toque desenha sempre (um passe parte de um jogador). **Frames**:
cada frame nasce como cópia completa do anterior — posições **e setas** (um
Delete tira as que não interessam; o contrário obrigava a redesenhar tudo) —
com duração própria, e o `DiagramPlayer` anima as posições entre frames por
interpolação, com reproduzir/pausa/anterior/seguinte. O desenho é JSON opaco
para o servidor (com tecto de 300 KB); as miniaturas dos cartões são o primeiro
frame, cortado no servidor.

**As miniaturas têm moldura própria** (`THUMB_RATIO`, 4:3) e não a forma do
terreno: um meio campo é vertical (0,77) e um campo inteiro horizontal (1,5), e
com cada cartão a tomar a sua forma a linha da grelha esticava-se pelo mais
alto — os cartões de campo inteiro ficavam com meia caixa branca por baixo do
texto. O desenho centra-se dentro da moldura e as barras que sobram levam a cor
do piso (`pitchBackground`), por isso lêem-se como mais relva ou mais madeira à
volta do lance. A animação da ficha tem o mesmo tecto de altura do editor
(560px), senão um canto em meio campo ocupava mil pixels de página.

### Modelos de jogo e bolas paradas

`GameModel`: sistema como **desenho e não enum** — 4-3-3/4-4-2/4-2-3-1/3-4-3/
3-5-2/5-3-2 aplicam posições de partida e cada bolinha arrasta-se; o que se
grava são coordenadas (`lineup`). Os princípios são secções escritas
(organização ofensiva/defensiva, transições, bolas paradas, por tópico). Por
equipa ou do clube; a mesma visibilidade e autoria dos exercícios.

`SetPiece`: cantos/livres/lançamentos/penáltis (`kind` em texto, vocabulário no
cliente — o futsal entra sem migração), cada um com desenho em meio campo e
frames. Um esquema novo **nasce com o lance montado** (bola no canto, batedor,
estrutura na área) — preenche-se, não se desenha do zero.

### Fronteiras

O âmbito manda como em tudo: um treinador **planeia as equipas dele**
(`teamScopeFilter` no `savePlan`), lê os planos do clube (a mesma razão do
calendário — a metodologia ganha em ver-se). Os cargos personalizados criados
antes desta área receberam `training:read`/`training:write` por migração
(`area_tecnica_nos_cargos`) — permissões que nasceram agora não são escolha de
ninguém a atropelar; clínico, scouting e staff genérico ficaram de fora, como no
mapa-base. RLS em todas as tabelas novas; `ExerciseFavorite` isola-se pela
relação, como `AttendanceRecord`.

Verificado por `npm run test:training` (33) — visibilidade, âmbito, autoria,
favoritos, plano com blocos, arquivar-em-vez-de-apagar, e as recusas todas.

## Academias AI

A camada de inteligência: vídeo de jogo → computer vision → dados com
confiança → revisão humana → estatística. O desenho completo, e o porquê de
cada decisão, vive em [06-academias-ai](06-academias-ai.md); aqui fica o que
existe.

**Grupo próprio no menu** a seguir à Área técnica — Visão AI, Análises,
Insights, e Desenvolvimento/Adversários marcados como beta com destino honesto
(`Soon`). Permissões novas `ai:read`/`ai:write`, gémeas cliente/servidor e à
parte de `training:*` (o vídeo de um jogo é imagem de menores); distribuídas
aos cargos existentes pela migração `20260902200000_academias_ai`, registada
no manifesto.

**O fluxo do MVP funciona de ponta a ponta**: criar a análise (equipa + jogo
do calendário a preencher o resto), confirmar o plantel — "#10 = Rui Silva",
dito *antes* do processamento, é o que dispensa reconhecimento facial —,
carregar o vídeo direto para o bucket privado `ai-videos` (o caminho das
fotografias, com barra de progresso), e o pipeline corre sozinho: verificação
de qualidade (real: nitidez, luz, estabilidade, terreno — OpenCV) e detecção +
tracking (torchvision + ByteTrack, ~5 FPS). O detalhe da análise mostra o
progresso ao vivo, a qualidade por dimensão, a confiança **medida** (nunca uma
média — mostra-se o elo fraco), e a fila de revisão: o que ficou abaixo de
0,75 pede um humano, e a correção vale para o track inteiro e fica guardada
(`HumanCorrection`, o dataset do fine-tuning futuro). Terminar notifica quem
criou (`AI_ANALYSIS_COMPLETED`).

**O processamento não vive no NestJS.** `ai-worker/` (Python, raiz do repo)
reclama trabalhos da fila (`AIJob`, `FOR UPDATE SKIP LOCKED`) por HTTP com
`AI_WORKER_TOKEN` — sem token configurado a porta está fechada, a lição do
webhook. Só modelos com licença limpa (o crivo está em `ai-worker/LICENSES.md`;
o Ultralytics YOLO ficou fora por ser AGPL), e cada modelo regista-se em
`AIModelVersion` com a licença — a proveniência dos números fica na base.

Por fazer, pela ordem do plano: campo/homography, bola, identificação
automática, métricas derivadas, eventos/clips, relatório de jogo, evolução,
adversários, scouting. Cada capacidade que ainda não é robusta diz "não há
confiança suficiente" em vez de inventar — é a regra da área inteira.

## Apagar equipas e clubes

Duas permissões novas, ambas na presidência e na direção por omissão e ambas
delegáveis: `team:delete` e `academy:delete`. À parte de `team:write` e de
`settings:write` de propósito — montar um plantel e desmanchar um escalão não
são a mesma decisão, nem mudar a cor do clube e apagar a casa.

**A confirmação é o nome escrito à mão**, verificado no servidor (uma
confirmação só no browser não é confirmação nenhuma). A comparação tolera
espaços e maiúsculas e não tolera o que interessa: tem de ser aquele.

**Números, não avisos.** O diálogo pergunta primeiro ao servidor o que se vai
perder e di-lo — *34 treinos, 12 com presenças registadas; 8 jogos, 5 com ficha
preenchida*. "Esta acção é irreversível" lê-se em todo o lado e não pára
ninguém. E diz, com o mesmo destaque, **o que fica** — sem isso ninguém apaga
uma equipa de teste com medo de apagar as pessoas.

Ao apagar uma equipa: os **atletas ficam** (perdem a ligação e voltam a estar
por atribuir), o staff fica, os modelos de jogo e as bolas paradas passam a ser
do clube (`SetNull`), e o **plano de preços desliga-se em vez de morrer** —
`SubscriptionPlan.team` não tem `onDelete`, era RESTRICT, e apagar uma equipa
com plano rebentava com um erro de chave estrangeira; desligar resolve **e** é o
comportamento certo, porque dinheiro cobrado não se apaga por arrumação de
escalões.

Ao apagar o clube: cai tudo por cascata **e os ficheiros vão com as linhas** —
fotografias, vídeos de scouting, imagens de exercícios. Apagar o índice e
guardar o livro era o contrário do que quem pede o apagamento está a pedir. As
**contas** (`User`) ficam: a mesma pessoa pode treinar noutro clube da
plataforma; o que desaparece é o vínculo. O registo vai para o `AuditLog` da
plataforma **antes** de apagar (a seguir não há a quem perguntar), e a ligação
da aplicação recebeu só `INSERT` nessa tabela — um log que o auditado pudesse
reescrever não é um log.

Verificado por `npm run test:delete-team` (14) e `npm run test:delete-academy`
(19), que cobrem sobretudo as recusas e o que **não** pode desaparecer.

## Competições

O quadro competitivo, da equipa ao papel impresso: a **equipa** diz que provas
disputa, o **jogo** escolhe uma dessas, e a **convocatória** imprime-a sem
ninguém escrever nada.

**Vivem no catálogo** (`kind: "competitions"`), ao lado dos locais e dos tipos de
evento — é exactamente o que os catálogos são: uma lista de nomes que o clube
gere, por modalidade. Uma tabela própria traria de volta os quatro ecrãs de
gestão que já existem. Criam-se nas Definições **ou ali mesmo** ao montar a
equipa: o calendário competitivo aparece em Setembro com a equipa a nascer, e
mandar alguém a Definições a meio disso é garantir que fecha o diálogo e não
volta.

**A ligação equipa–prova é uma tabela** (`TeamCompetition`) e não uma lista de
ids: uma lista de texto não sabe que a prova foi apagada e ficava a apontar para
nada. `Match.competitionId` é opcional e `SetNull` — um amigável não pertence a
prova nenhuma, e apagar a prova do catálogo não pode apagar os jogos que se
disputaram nela.

**Um jogo tem sempre prova, e é obrigatória.** É a convocatória que a exige —
herda-a do jogo e imprime-a — e um jogo sem prova obrigava quem exporta a
escrevê-la à mão, que era o remendo que isto veio substituir. A pergunta tem
sempre resposta porque **toda a equipa nasce com "Amigável"**: um jogo que não é
de nenhuma prova é um amigável, e isso diz-se em vez de se deixar em branco.
"Amigável" é `isSystem` — não se apaga nem se renomeia, porque é a rede que
garante que há sempre uma opção, e uma rede removível não é rede.

**A prova tem de ser da equipa.** A lista que o calendário oferece é a do escalão
escolhido, e o servidor confirma-a: marcar um jogo do Sub-13 no campeonato de
seniores é um erro de dedo que ninguém apanharia depois. Trocar de equipa no
diálogo faz a escolha cair na primeira prova da equipa nova — em vez de a limpar
para vazio, que travava o botão sem dizer porquê.

A migração `amigavel` criou-a nas academias que já existiam e ligou-a a **todas**
as equipas: sem isso, tornar a competição obrigatória bloqueava quem já usa o
produto, e uma funcionalidade nova que trava o trabalho não é uma funcionalidade
nova. Os jogos já marcados ficam sem prova, e é o correcto — inventar-lhes uma
seria escrever no registo do clube um facto que ninguém afirmou; a folha continua
a deixar escrevê-la à mão nesses.

**Arquivar uma prova não apaga a história**: sai da lista de onde se escolhe para
marcar um jogo novo, e fica nos jogos que já se disputaram nela.

Isto substitui um remendo: a folha de convocatória tinha um campo "competição"
escrito à mão a cada exportação e lembrado no `localStorage` de quem exportava —
cada treinador tinha a sua versão do nome da prova, e mudar de computador
perdia-a. Continua editável na folha, porque um jogo sem prova associada (um
amigável, ou um marcado antes disto existir) tem de poder dizê-lo na mesma.

Verificado por `npm run test:competitions` (19), sobretudo nas recusas — o item
do catálogo que não é uma prova, a prova que a equipa não disputa, e o treinador
que não edita o quadro competitivo.

## A equipa não tem escalão

O escalão e a equipa eram a mesma coisa dita duas vezes: um clube criava o
escalão "Sub-11" nas Definições → Catálogos para depois criar a equipa "Sub-11
Futebol" com esse escalão ao lado. Dois passos, dois sítios, uma decisão — e
nenhum dos dois obrigava o outro a concordar.

`Team.ageGroup` (texto) passou a `Team.maxAge` (inteiro): a idade máxima dos
atletas da equipa, 99 para uma equipa sem tecto. Em "Nova equipa" o prefixo
`Sub-` está fixo no campo e escreve-se o número; o nome continua a sugerir-se
("Sub-11 Futebol") e continua editável. O catálogo `ageGroups` deixou de existir,
e com ele o passo "Definir os escalões" do painel de arranque.

O **scouting mantém o seu** `ageGroup`, em texto e opcional: um prospecto não
está em nenhuma equipa, por isso ali não há de onde derivar a idade — é como se
descreve quem ainda é de fora ("procuro um lateral para os Sub-15").

Migração `20260827160000_equipa_sem_escalao`, que converte o texto existente
(`"Sub-11"` → 11, `"10–14 anos"` → 14, o resto → 99) antes de largar a coluna.

---

## App das famílias (PWA)

| | |
|---|---|
| **Hoje** | mensalidade em falta primeiro · próximo treino · alterações · próxima consulta |
| **Agenda** | treinos por dia + consultas e exames agendados |
| **Pagamentos** | MB Way, Multibanco, cartão · estado "a confirmar" honesto · histórico |
| **Atleta** | assiduidade, **avaliação do treinador com evolução**, **relatórios partilhados**, inscrição |

**Só corre instalada.** Fora do modo `standalone` a app recusa-se a renderizar e
manda instalar. É uma porta, não um cadeado — o controlo a sério é a autenticação
no servidor.

**Contas a sério.** A app deixou de entrar sozinha com uma conta de teste: sem
sessão mostra o ecrã de entrada, e é por lá que uma família se regista pelo link do
clube (ver *Convite às famílias*). A sessão vive no `localStorage` — isto é uma app
instalada, não um separador, e um pai que abre o ícone de manhã não escreve a
palavra-passe outra vez.

**Notificações push** funcionam de ponta a ponta: VAPID, subscrição, service
worker, e envio a partir do servidor — incluindo a convocatória, que ainda não
tem ecrã dedicado na PWA (ver Por fazer).

---

## Ficha de staff

Qualquer pessoa é clicável — na lista, no plantel de uma equipa, num treino por
registar, no calendário. A ficha responde a três perguntas: *quem é e como se lhe
fala*, *por onde passou no clube*, e *o que é que vê no produto*.

| Separador | O que mostra |
|---|---|
| **Visão geral** | contactos, cargo, departamento, anos de casa, equipas desta época |
| **Equipas** | histórico por época, da mais recente para trás — as passadas não são clicáveis porque já não existem |
| **Atividade** | só para quem treina: treinos registados, assiduidade, avaliações, balanço de jogos e últimos resultados |
| **Acesso** | o que esta pessoa vê, área a área, editável por quem tem `access:write` |

**As métricas são sobre processo, nunca sobre desempenho.** Treinos registados e
avaliações entregues, não "qualidade do treinador". Os resultados dos jogos
aparecem como contexto da equipa — sem ranking nem comparação entre treinadores.

**Configuração de acessos, pessoa a pessoa.** O papel responde por omissão; as
excepções são por pessoa e ficam à vista, marcadas com o que o papel dava.
Guarda-se a **diferença** para o papel e não o valor absoluto. Retirar ganha a
conceder: em caso de configuração contraditória, a leitura segura é a que dá menos
acesso. `access:write` é permissão à parte de `staff:write`, de propósito: editar
uma ficha não é o mesmo que mudar o que alguém vê.

O painel **grava no servidor** (`PATCH /api/staff/:id/access` → `Membership.grants`
e `Membership.revokes`), não é só decoração: o que a direção lá muda tem efeito real
no pedido seguinte, porque o contexto relê a membership a cada chamada. A UI reage
já e grava por baixo; se a gravação falhar, relê-se e a verdade do servidor
prevalece. As guardas contra escalada vivem no servidor — não se delega
`access:write` nem `settings:write`, só se concede o que o próprio granter tem, e
ninguém edita o seu próprio acesso. O treinador tem `athlete:write` **por omissão**
(inscreve e importa atletas, mas só nas suas equipas — o âmbito é garantido no
servidor); a direção pode retirar-lho a um treinador em concreto por aqui.
Verificado por `npm run test:access` (12).

## Convites de staff

`Staff → Convidar` gera um link no domínio do clube —
`{slug}.academias.pt/convite/{token}` — que a academia envia por onde quiser. Quem
o abre vê o nome e o email já preenchidos e **não editáveis**, escolhe uma
palavra-passe, e entra. Quem já tem conta (a mãe que passa a treinadora) confirma a
password que já tem, em vez de criar uma segunda.

**Quem convida é que escolhe as equipas** — o âmbito de um treinador é o acesso
aos dados dos atletas, boletim clínico incluído, e não se deixa isso para quem
apanhar o link.

| | |
|---|---|
| Token | 32 bytes aleatórios; na base só o **SHA-256** — se a tabela vazar, nada é resgatável |
| Validade | 7 dias, uso único, revogável a qualquer momento |
| Hierarquia | não se convida acima do próprio nível |

Verificado por `npm run test:invites` (16) e `npm run test:invite-flow` (36).

## Avaliações e relatórios

Duas coisas diferentes com nomes parecidos, e a diferença é o que faz o desenho:

| | Avaliação | Relatório |
|---|---|---|
| O que é | o boletim do período: as mesmas competências, escala 1–5 | um texto sobre o percurso, escrito quando há o que dizer |
| Quantos | um por atleta por período | os que forem precisos |
| Quem lê | a família, quando publicada | **depende** — interno ou partilhado |
| Para que serve | comparar Setembro com Junho | dizer o que os números não dizem |

### O ecrã do treinador

`Avaliações` lista o **plantel**, não as avaliações. É a decisão que muda tudo: uma
lista de avaliações responde a "o que já fiz", um plantel responde a "quem falta" —
e é essa a pergunta de Dezembro. Quem ainda não tem avaliação aparece primeiro.

O editor abre num atleta e **anda para o seguinte** sem fechar (`Guardar e
seguinte`), com o contador `3 de 18` sempre à vista: o trabalho real é uma tarde com
o plantel todo, e um formulário que fecha a cada gravação é o que faz as avaliações
ficarem a meio. As pontuações são cinco pontos clicáveis — clicar no valor que já lá
está limpa-o.

Cada avaliação tem, além das competências: **o que está bem**, **a trabalhar no
próximo período** e uma nota livre. Cinco números dizem onde o atleta está; não
dizem o que fazer com isso, e é isso que um pai quer ler.

**Publicar é um acto de grupo**: selecciona-se e entrega-se de uma vez, com o botão
a dizer quantas famílias vão ser avisadas. Ninguém devia publicar sem saber quantos
telemóveis vão tocar.

### Interno ou partilhado

Metade do que um clube escreve sobre um miúdo não é para os pais lerem — o parecer
para a direção, a nota de que talvez suba de escalão. A outra metade é precisamente
para eles.

Por isso `visibility` é obrigatório, aparece como **dois cartões do mesmo tamanho**
com a consequência escrita por baixo de cada um, e **nasce em interno**. Dos dois
enganos possíveis, um é barato (a família não viu, partilha-se agora) e o outro não
tem volta (já leram).

`status` e `visibility` são fronteiras diferentes: publicar diz *está escrito*
(entra no registo do atleta, a academia lê-o); partilhar diz *para quem*. O que a
família vê é a intersecção — publicado **e** de família. Tornar interno um relatório
já lido tira-o da app dali para a frente, e a consola diz isso mesmo em vez de
prometer que apaga o passado.

Ao publicar, o relatório **congela os números** (assiduidade, jogos, avaliação do
período). Um documento que lesse dados ao vivo passaria a mentir sozinho: o texto
"tem faltado" ao lado de 96%, seis meses depois.

### O que a família recebe

Na app, no ecrã do educando: a avaliação publicada — primeiro o que o treinador
escreveu, depois as competências, cada uma com a **evolução face ao período
anterior** (`+1`, `=`) — e a lista de relatórios partilhados, que abrem numa folha
de leitura. Notificação em ambos os casos, com tipos distintos
(`EVALUATION_PUBLISHED`, `REPORT_SHARED`): um pai que recebe os dois quer saber qual
chegou.

Não há média. Uma média vira nota, uma nota vira comparação entre miúdos no grupo de
WhatsApp dos pais — e um 3,4 não diz a ninguém o que fazer a seguir.

### As fronteiras, e onde vivem

| | |
|---|---|
| Rascunho | nunca sai da consola — filtro no **servidor**, a partir do papel, não da interface |
| Interno | nunca sai da academia, mesmo publicado |
| Âmbito | o treinador avalia os atletas das suas equipas; o pai vê os filhos |
| Competências | validadas contra `Sport.skills` da modalidade — não são um saco de JSON |
| Escala | inteiros de 1 a 5, verificados no servidor |
| Apagar | avaliação publicada não se apaga (corrige-se); relatório publicado só pela direção |

O pai passou a ter `evaluation:read` — faltava, e era por isso que a app tinha um
espaço reservado onde devia estar o boletim do filho.

Verificado por `npm run test:development` (32 testes), que percorre sobretudo as
recusas — incluindo a que interessa mais: um relatório interno publicado **não**
aparece à família.

## Fotografias e vídeo — armazenamento

Supabase Storage, **sempre privado**. O que fica na base é a **chave** do ficheiro;
o que a API devolve é um link assinado com prazo, gerado a cada leitura. A
diferença não é de estilo: um URL guardado é um endereço permanente para a
fotografia de uma criança, e quem o apanhar — num log, num ecrã partilhado, num
histórico — abre-a para sempre.

| | |
|---|---|
| `fotos` | atletas e staff · 8 MB · JPEG/PNG/WebP · link válido 6 h |
| `scouting` | vídeo de prospectos · limite do projecto · ver `scouting-video.service.ts` |

**Os bytes não passam pela API.** Três passos: a consola pede autorização, o
browser carrega directamente para o Supabase com um endereço assinado, e a API
confirma que o ficheiro chegou (`HEAD`) antes de gravar a chave. Atravessar imagens
— e sobretudo vídeos de centenas de MB — no processo que serve toda a gente é o
caminho mais curto para o derrubar.

A chave leva o id lá dentro (`atletas/{id}/…`, `staff/{userId}/…`) e o servidor
**verifica esse prefixo** ao confirmar: uma autorização obtida para um atleta não
serve para apontar a ficha de outro à mesma fotografia.

Quem pode: `athlete:write` (com âmbito por equipa) nos atletas; `staff:write` **ou
a própria pessoa** no staff — pôr a sua própria fotografia nunca foi um privilégio,
e exigir a direção era garantir que ninguém tinha foto nenhuma.

### As duas armadilhas do Supabase que isto custou

Ambas davam a mesma mensagem inútil — *"o armazenamento não está disponível"* — e
juntas mantiveram os carregamentos avariados sem deixar rasto:

1. **O tecto do projecto.** O bucket de vídeo pedia `file_size_limit` de 2 GB; o
   projecto permite 50 MB. Um pedido acima do tecto não devolve um aviso: devolve
   400 e o bucket **não chega a ser criado**. Agora tenta-se o limite desejado e,
   se for recusado, cria-se sem limite explícito — herdando o do projecto.
2. **Bucket duplicado devolve HTTP 400**, com um corpo a dizer `409` lá dentro.
   Olhar só para o estado HTTP faz o caso mais normal de todos — a segunda vez que
   o servidor arranca — parecer uma avaria. `StorageService` lê sempre o corpo
   antes de decidir.

Verificado por `npm run test:photos` (24 testes) — que **carrega mesmo o ficheiro**
para o Supabase e confirma que o link abre e que, sem assinatura, não abre. Um teste
que só chamasse a API não teria apanhado nada disto.

## Convite às famílias

`Famílias → Convidar para a app` abre um diálogo com **um link só, reutilizável** —
`{slug}.academias.pt/familia/{token}` — que se manda ao grupo de WhatsApp dos pais.
Se já houver um vivo, é esse que aparece, com a validade que lhe resta e quantas
famílias já entraram por ele; gerar outro fecha o anterior, e isso está escrito no
ecrã.

Durações: **24 h, 7 dias, 30 dias ou sem prazo**. Sem prazo é uma escolha
explícita, nunca o valor por omissão.

### O desenho, numa frase

O link diz *"esta academia está a aceitar famílias"*; o **NIF mais a data de
nascimento** do educando dizem *"e tu és pai deste"*. São duas perguntas separadas,
e é a separação que faz o link poder ser partilhado sem cuidados: quem o
reencaminhar não dá acesso a nada, porque quem o abrir sem os dados de uma criança
desta academia não fica ligado a ninguém.

### O caminho do pai

1. Abre o link no telemóvel → **redirecciona para a landing do clube**, que é onde
   se instala a app. O convite viaja agarrado ao endereço e a app guarda-o (a
   `start_url` do manifest não leva query — sem isto, instalar perdia o convite).
2. Dentro da app: **criar conta** ou **entrar**. Quem chega pela primeira vez cria.
3. **Identifica o filho** pelo NIF e pela data de nascimento. A app confirma
   mostrando o primeiro nome e a equipa — antes de pedir a palavra-passe, para
   ninguém escrever tudo e só depois descobrir que o NIF não bate.
4. **Os seus dados**: nome, relação (Mãe/Pai/Encarregado), telemóvel, email e
   palavra-passe. A sessão vem com a resposta do registo — não há um segundo ecrã
   de login a seguir a escolher a password.

Um irmão junta-se depois em `Perfil → Tenho outro filho no clube`, com a mesma
prova. Ter conta não dá direito a reclamar crianças.

### O que protege isto

| | |
|---|---|
| A prova | `taxId` **e** `birthdate`, nunca um só — e a resposta é a mesma para NIF errado, data errada ou atleta que já saiu |
| Tentativas | 10/min por IP a identificar, 5/min a registar — sem isso, nove dígitos varriam-se e isto era um oráculo que confirma o clube de crianças |
| Consulta | `app.match_athlete_for_family` devolve **um id ou nada**: não lista, não pesquisa por nome, não confirma um NIF sem a data |
| O token | em claro na base, ao contrário do de staff — porque não decide acessos e a secretaria tem de o poder copiar outra vez. Revogável a qualquer momento |
| O NIF na consola | só para quem tem `family:read` (direção, secretaria). Um treinador não o recebe, e a app do pai também não |

### NIF do atleta

Campo novo em `Athlete`, único por academia e **obrigatório em cada escrita nova** —
no formulário de *novo atleta* e na coluna *NIF* da importação por Excel. A coluna
na base aceita nulo, porque há atletas inscritos antes desta regra e apagá-los não é
opção; para esses, a ficha do atleta (separador **Família**) mostra o vazio como
aviso com a consequência escrita, e preenche-se ali.

A regra é deliberada: um atleta sem NIF é um atleta que **nenhuma família consegue
reclamar**, e a academia só descobre isso semanas depois, quando o pai liga a dizer
que a app não encontra o filho. Trinta segundos na inscrição contra um telefonema
por atleta.

Verificado por `npm run test:family-invite` (35 testes), que percorre o caminho
inteiro e, sobretudo, as recusas.

## Site público (`apps/site`)

O site da marca — o que angaria clubes. App à parte, sem dependência da API: é
HTML, CSS e um pouco de JavaScript, e uma página de marketing que precisa de um
servidor a responder para abrir é uma página que fica em baixo quando o servidor
fica.

`npm run dev:site` (:5190). Rotas: `/`, `/software`, `/planos`, `/contactos`,
`/termos`, `/privacidade`, `/cookies`, `/dpa`.

### A identidade é própria, e é deliberado

Não herda `packages/ui`. A consola, a app e o painel partilham tokens porque são o
**mesmo produto** visto de três lados; o site é a montra, e uma montra que herdasse
os tokens do produto acabaria a parecer uma captura de ecrã dele.

| | |
|---|---|
| **Tipografia** | Archivo (títulos, com eixo de largura a apertar em `wdth 88`), Instrument Sans (texto, a mesma do produto), Geist Mono (marcadores e números) |
| **Cor** | tinta quase preta com verde lá dentro, papel quente, e **uma** cor — o verde de campo do produto. Zero gradientes de duas cores, zero vidro fosco |
| **Raio** | 2–3px. O cartão arredondado de 16px é a assinatura de metade da internet; recusá-lo é a forma mais barata de não parecer um template |
| **Estrutura** | secções numeradas (01…11) com filetes de 1px — lê-se como ficha técnica, não como apresentação de vendas |
| **Contraste** | blocos claros e escuros a alternar. O ritmo faz-se com luz, não com sombras |
| **Movimento** | uma regra: `data-reveal` + `IntersectionObserver`, entrada de 14px com atraso escalonado. Sem biblioteca de animação, e desligado em `prefers-reduced-motion` |

### As capturas de produto

Três caras do produto — a consola, a app da família e a página pública de adesão a
sócio — estão **reconstruídas em HTML**, a partir dos ecrãs reais e com os tokens
reais: os mesmos grupos de navegação, os mesmos alertas com acção à direita, a mesma
faixa da semana, o mesmo cartão de sócio. Nítidas em qualquer resolução e sempre
iguais ao produto de hoje.

Largar `consola.png`, `app.png` e `socios.png` em `apps/site/public/shots/` substitui
as reconstruções automaticamente; se um ficheiro falhar, a reconstrução volta sozinha
(ver `public/shots/LEIA-ME.md`).

### O formulário de contacto cai na nossa CRM

`POST /api/site/contacto` — público, sem sessão, apertado a 5 pedidos por minuto
por IP (`site-contact.controller.ts`). Grava directamente na tabela `Contact` que o
Platform Admin lista em **Contactos** (ver `docs/04-plataforma.md`), sem
administrador atribuído — fica "por pegar" até alguém do lado de cá o assumir.

Substituiu um `mailto:` que era a única via. Um botão que só abre o cliente de
email não garante nada: sem cliente configurado, ou com o separador fechado antes
de carregar em enviar, o contacto nunca chegava a lado nenhum — e a página dizia
"aberto o teu email" na mesma. Agora a mensagem cai na base de dados antes de o
formulário dizer que está feito; o email directo continua disponível para quem o
preferir, mas deixou de ser o único caminho, e serve de recurso automático se o
pedido à API falhar.

Verificado por `npm run test:contacts` (33 testes), que cobre também esta rota:
aceita sem token, aparece na lista sem dono, guarda o assunto e a mensagem, e
recusa um pedido sem email.

### O convite de família não cai no login de staff

A landing (`apps/api/src/landing/landing.template.ts`) decide a composição pelo
dispositivo — telemóvel instala, computador entra — mas um link de convite de
família (`?convite=...`) já respondeu a essa pergunta sozinho: só um pai o recebe,
mesmo que o abra num computador a caminho do telemóvel. Sem isso, esse pai caía no
formulário de login da consola.

Agora `hasFamilyInvite` sobrepõe-se ao dispositivo: com o convite presente, o
computador mostra uma vista dedicada — "abre isto no teu telemóvel", com o link
para copiar e os três passos a seguir — em vez do ecrã de "Entrar". O login de
staff continua acessível por um botão discreto, reaproveitando os mesmos `id`s da
composição de telemóvel (`show-login`, `install-panel`, `login-panel`), por isso o
alternar entre os dois não precisou de JavaScript novo.

### O roteiro é uma linha do tempo

Com estações, não com datas exactas, e com a ordem à vista — integrações primeiro,
depois scouting avançado, depois IA sobre os dados. A ordem é a informação: "o que
vem primeiro" é a pergunta que um clube faz. A página diz que são intenções.

### O que a página promete

Só o que existe. Os módulos listados estão construídos; tudo o resto vive na secção
**A caminho**, marcado como em desenvolvimento e sem datas. Uma landing que mistura
o que existe com o que está planeado ganha a primeira reunião e perde o cliente na
segunda — e num mercado onde os clubes se conhecem todos, perde também os outros.

### Documentos legais

`/termos`, `/privacidade`, `/cookies` e `/dpa` estão escritos em português simples,
a descrever o que a plataforma faz. **Estrutura e linguagem, não parecer jurídico**:
falta a revisão de um advogado de RGPD e SaaS antes de publicar. O DPA assume a
relação certa — o clube é responsável pelo tratamento, nós somos subcontratante — e
diz explicitamente que temos acesso administrativo restrito e auditado, em vez da
frase confortável de que não conseguimos aceder.

A identificação legal da entidade está por preencher (`COMPANY` em
`src/lib/content.ts`): as frases que dependem dela só aparecem quando existir, para
nenhuma página mostrar um espaço por completar.

## Landing da academia

`GET /l/:slug` — HTML gerado no servidor (o preview do WhatsApp não corre
JavaScript). Instruções por plataforma, detectadas pelo User-Agent. No computador,
ecrã dividido com o login — é também aqui que a sessão nasce e é entregue à
consola.

## Importação de atletas por Excel

`Atletas → Importar Excel`, para quem tem `athlete:write` — o que inclui os
treinadores por omissão, limitados às suas equipas. Três passos:

1. **Descarregar o modelo** — um `.xlsx` gerado no browser com as colunas certas,
   uma linha de exemplo e a lista das equipas da academia. Sem modelo, cada clube
   inventava um formato.
2. **Carregar o ficheiro preenchido** — validado no browser e mostrado linha a
   linha *antes de gravar*: quantos estão prontos, e quais as linhas com erro (com
   o número da linha e o motivo). Datas em `AAAA-MM-DD`, `DD/MM/AAAA` ou número de
   série do Excel são todas normalizadas.
3. **Confirmar** — só as linhas válidas seguem, e o servidor **revalida tudo**.

O import é de **atletas**, não de encarregados: um encarregado é uma conta, e
liga-se sozinho pelo link do clube, identificando o educando pelo NIF e pela data
de nascimento (ver *Convite às famílias*). A coluna **NIF** do modelo é o que torna
esse caminho possível — é opcional, mas sem ela nenhuma família consegue reclamar
os atletas importados. O `SheetJS` é carregado sob procura
(429 KB num chunk à parte) — não pesa no arranque de quem nunca importa. O "Novo
atleta" individual passou também a escrever na API.

Validação por linha, não tudo-ou-nada: um ficheiro de 120 atletas com um erro na
linha 87 inscreve os outros 119. Verificado por `npm run test:athletes` (19) —
permissão, âmbito, duplicados, número repetido, e mass-assignment rejeitado.

---

## Segurança

Auditoria adversarial com exploits executados; detalhe em
[05-seguranca](05-seguranca.md). Uma falha **crítica** (webhook de pagamento
forjável por segredo vazio) e várias de endurecimento foram corrigidas: gate de
dados clínicos por `clinical:read`, rate-limiting global, XSS na página de convite,
DTOs validados contra mass-assignment, Helmet, verificação de valor no webhook.

A fundação multi-tenant **resistiu** aos ataques — atravessar de uma academia para
outra por header ou por IDOR é bloqueado (403/404). `npm run test:security` (31)
codifica cada exploit e cada fronteira, e trava o CI numa regressão.

**O código do cliente não é uma fronteira de segurança — e não se finge que é.**
Todo o JavaScript que corre no browser é, por definição, legível: o navegador tem
de o executar, logo tem de o ter. O build de produção **minifica e não emite source
maps** (`build.sourcemap: false`, `console`/`debugger` removidos), por isso no
"Inspecionar → Sources" vê-se o bundle comprimido e não o TypeScript comentado —
o que trava a leitura casual, que é o grosso do risco real. Não se foi além disto
de propósito: ofuscação a sério (control-flow flattening, string encryption) custa
tamanho, desempenho e capacidade de depurar, e **não acrescenta segurança nenhuma**
— quem reescrever o frontend inteiro continua a bater no 403 do servidor. As tabelas
de permissões do cliente só decidem o que se mostra, nunca o que se pode; a decisão
vive no servidor, e é lá que está protegida.

---

## Platform Admin

Painel próprio, `apps/platform`, para quem é dono do SaaS — não é a consola de
uma academia com mais botões. Identidade em tabela à parte (`PlatformAdmin`, sem
`Membership`), leituras por funções `SECURITY DEFINER` que devolvem agregados e
nunca dados de pessoas dentro das academias, guard e ligação à base próprios.

Overview (com "precisa de atenção" accionável), Academias (com progresso de
onboarding em %), Crescimento, Registo de auditoria. Criar academia gera convite
ao diretor pelo mesmo mecanismo de convites já existente.

Verificado por `npm run test:platform` (25, a fronteira ao nível da base de
dados) e `npm run test:platform-api` (30, os endpoints — nos dois sentidos: uma
academia não entra na plataforma, a plataforma não entra numa consola).

Detalhe completo, incluindo o que falta (impersonation, subscrições, papel de
base de dados dedicado), em [04-plataforma](04-plataforma.md).

---

## Backend

Esquema Prisma completo: multi-tenant com RLS, multi-desporto, RBAC com âmbito,
pagamentos, notificações, avaliações, convocatórias, e as tabelas da plataforma.
Módulos NestJS: academia (leituras **e escrita de atletas**), convocatórias,
convites, faturação euPago (webhook idempotente e assinado), notificações com
canais como adaptadores, landing SSR, plataforma.

**As mensalidades do mês emitem-se sozinhas.** No dia 1 não acontecia nada: a
emissão tinha três portas — o botão "Gerar mensalidades", gravar o calendário de
cobrança, definir um preço — e todas exigiam alguém a carregar. Um presidente
que se esquecesse duas semanas deixava as famílias sem mensalidade na app e sem
aviso, com o vencimento a passar pelo meio.

Agora o servidor varre os clubes de hora a hora e garante o período corrente,
pela mesma `gerarCobrancas` do botão — o mesmo calendário (`billingMonths`), o
mesmo dia de vencimento, os mesmos planos, o mesmo aviso à família. Não há uma
segunda regra de emissão a viver em paralelo.

De hora a hora, e não "à meia-noite do dia 1": um relógio que dispara uma vez
por mês falha uma vez por mês — basta o processo estar a reiniciar naquele
minuto. Uma varredura frequente sobre uma operação **idempotente** (`gerarCobrancas`
só cria o que falta) emite na primeira passagem depois da meia-noite, não faz
nada nas seguintes, e apanha o atraso sozinha se o servidor esteve em baixo. O
custo fica em nada por causa do memo `emitido`, que salta o clube até o mês virar.

Entram todos os clubes menos os `CANCELLED` — e não só os `ACTIVE`: na base real
há dezoito em `SETUP`, com atletas e pagamentos a sério, e um só em `ACTIVE`.
`AUTO_BILLING_INTERVAL_MIN=0` desliga, e **está a 0 no `.env` de
desenvolvimento**: esse ficheiro aponta para a base de produção, e um servidor
local a arrancar emitiria cobranças verdadeiras em todos os clubes. Verificado
por `npm run test:emissao` (21), sobre um clube descartável.

**O pagamento só muda de estado pelo servidor, com a euPago a dizer.** Não existe
endpoint que marque algo como pago; o navegador nunca decide. Há dois caminhos, e
liquidam pela mesma função (`confirmPayment`, com verificação de valor):

- o **webhook** — rápido, assinado (HMAC com segredo forte obrigatório);
- a **reconciliação** — de dez em dez minutos, o servidor pergunta à euPago pelos
  pagamentos em voo (`multibanco/info` para Multibanco; a lista de transacções
  pagas, por OAuth, para MB Way e o resto) e acerta o que ela souber. É a rede.

A rede existe porque foi precisa: dois pais pagaram por MB Way e de manhã a app
dizia-lhes que deviam. Em toda a base **não havia um único pagamento confirmado
pelo webhook** — o servidor aceita um evento bem assinado (verificado em
produção), mas o da euPago nunca chegou, ou chegou assinado com outra chave e caiu
em 401 sem rasto. Isso corrige-se no backoffice da euPago (URL, segredo, sem
encriptação); o que o código passou a garantir é que um webhook perdido já não
deixa um pagamento "a confirmar" para sempre. As rejeições do webhook passaram a
ficar gravadas em `WebhookEvent` com o motivo — o silêncio era metade do problema.

Sem `EUPAGO_CLIENT_ID`/`EUPAGO_CLIENT_SECRET` a reconciliação só confirma
Multibanco; MB Way fica dependente do webhook (e expira ao fim de dez minutos,
para a app dizer "por pagar" em vez de prometer). O servidor avisa-o ao arrancar.

Havia uma terceira causa, escondida atrás das outras duas: a migração
`app_do_clube` redefiniu `app.resolve_payment_academy` sem o `OR p.id = p_ref`
que `pagamentos_eupago` tinha acabado de acrescentar. Como o `identifier` que a
euPago devolve é o **nosso** id de `Payment`, um webhook de MB Way — mesmo bem
assinado — não encontrava o pagamento e saía em 200 "desconhecido". Reposto em
`resolver_pagamento_por_id`; apanhado pelo teste `test:reconciliar` ("expirar
não é negar"). E um detalhe da API antiga: em `multibanco/info` o estado por
palavras vem em `estado_referencia`, não em `estado` (que é um número).

**Ninguém mexe em quem está acima.** A patente de uma pessoa é a do cargo **mais
alto** que ela veste — principal ou secundário —, e é medida em `rankOf`
(`common/permissions.ts`), num sítio só. Quatro portas passaram a verificá-la, e
três delas não verificavam nada:

| Porta | Antes |
| --- | --- |
| apagar (`DELETE /memberships/:id`) | verificava — mas só o cargo principal |
| desactivar (`PATCH /memberships/:id/active`) | idem |
| **despromover** (`PATCH /roles/assign/:id`) | **não verificava o alvo** |
| **retirar acesso** (`PATCH /staff/:id/access`) | **não verificava o alvo** |

A despromoção era a que dava o clube: um director com `access:write` dava
"Roupeiro" ao presidente — cargo de patente 20, bem abaixo da dele, logo aceite
— e o presidente ficava `STAFF`. A seguir apagava-se pelas regras normais. A
protecção do apagar era verdadeira e inútil, porque se contornava com um pedido
antes. Retirar acesso era a mais silenciosa: um presidente sem `role:write` nem
`staff:write` é um presidente de nome.

O cargo principal deixou de descrever a pessoa quando os cargos passaram a ser
vários: na base real havia uma treinadora com o cargo secundário de *Diretora*
(patente 100) que, pelo principal, qualquer treinador podia apagar. As
permissões dela eram a soma dos cargos; a protecção tinha de ser da mesma soma.

A assimetria é deliberada: **quem age** mede-se pelo papel-base, **quem é alvo**
pelo cargo mais alto. As duas erram para o lado de recusar. Verificado por
`npm run test:hierarquia` (18) — e o teste foi validado ao contrário, com a
guarda desligada: sem ela, um treinador apagou a conta de quem também era
director, e a direcção despromoveu e neutralizou o presidente.

**Rate-limiting e cabeçalhos de segurança** globais (`@nestjs/throttler`,
`helmet`). Ver [05-seguranca](05-seguranca.md).

**Desempenho.** `connection_limit` da ligação à base estava em `1` — o servidor
inteiro serializava por uma única ligação, para todos os utilizadores. Subiu para
`5`. Fica registado como ponto de atenção em vez de resolvido por completo: um
patamar de ~1,2–1,5s por pedido continua a existir, aparentemente ligado a como as
ligações são reaproveitadas contra o pooler do Supabase — questão de configuração
de infraestrutura, não de código da aplicação.

---

## Por fazer

| | |
|---|---|
| Importação por Excel de **staff** | a de atletas está feita; a de staff (que são convites/contas) fica para depois |
| Convocatória na app das famílias | a notificação já é enviada e fica na base; falta o ecrã na PWA e um endpoint com âmbito por atleta |
| Analítica (Fase 5) | receita, retenção, actividade — parcialmente coberto pelo Platform Admin, do lado do negócio |
| Nota do jogo | o campo existe e é mostrado; **a fórmula está por decidir** |
| ZeroZero | fluxo completo, mas com dados **simulados** — falta resolver licenciamento |
| FPF (resultados.fpf.pt) | investigado e **descartado**: bloqueia `ClaudeBot` no `robots.txt` e reserva direitos ao abrigo da Directiva (UE) 2019/790 |
| Push em produção | chaves VAPID de desenvolvimento e subscrições em memória |
| Platform Admin: impersonation | "ver como academia" com MFA, motivo, prazo e registo — desenhado em 04-plataforma, não implementado |
| Platform Admin: subscrições | alterar plano, cobranças, faturação |
| Email enviado ao ZeroZero e FPF para termos acesso à API deles

## Dívida conhecida

- **Ligação da plataforma sem papel dedicado.** `PlatformPrisma` usa hoje as
  credenciais de administração da base (`BYPASSRLS`), só injectadas no módulo
  `platform`. Falta um papel `platform_app` com privilégios exactos, sem
  `BYPASSRLS` — as leituras globais já não precisam dele, passam pelas funções
  `SECURITY DEFINER`. Ver [05-seguranca](05-seguranca.md).
- **Latência base de ~1,2s por pedido autenticado**, ver secção Backend acima.
- O horário definido ao criar uma equipa **não gera treinos** no calendário; fica
  guardado e visível, mas a geração de sessões recorrentes está por fazer.
- **Equipas já escrevem na API.** "Nova equipa" faz `POST /api/teams` (exige
  `team:write` — direção e coordenação, não o treinador), resolve a época pelo
  rótulo (encontra-a ou cria-a), liga o treinador principal e recarrega o store.
  `lib/roster.ts` desapareceu — a cópia local deixou de existir. Verificado por
  `npm run test:teams` (15).
- **Eventos do calendário já escrevem na API.** Optou-se pelo **modelo de evento
  genérico**: nova tabela `CalendarEvent` (treino avulso, jogo, torneio, reunião),
  com RLS por academia. "Novo evento" faz `POST /api/events` e o cancelar faz
  `PATCH /api/events/:id` (exigem `calendar:write`, respeitam o âmbito — um treinador
  cria para as suas equipas mas não "toda a academia"); o calendário lê-os de
  `GET /api/events`. Verificado por `npm run test:events` (16).
- **Ainda local no calendário: o jogo rico** (convocatória + resultado, em
  `lib/calendar.ts`). As convocatórias submetidas já persistem em `Match` pelo ecrã
  de Convocatórias (`/api/matches` + endpoints), mas o *seed* de jogos de
  demonstração e o registo de resultado inline no detalhe do jogo continuam locais —
  falta um endpoint de resultado (`ourScore`/`theirScore`/marcadores → `Match` e
  `MatchAppearance`) para o fechar.
- **Comunicações já se enviam.** `POST /api/announcements` publica e notifica cada
  destinatário; `GET /api/announcements` devolve os avisos com a taxa de leitura
  (`reach`/`read`, contados das notificações). O **público** é da direção — **Geral**
  (toda a academia), **Pais** ou **Treinadores**; o treinador (agora com `comms:read`
  /`comms:write`) só fala com os **pais das suas equipas**, e o servidor recusa
  qualquer outro público em vez de confiar na UI. O menu do treinador ganhou
  Comunicação. Verificado por `npm run test:announcements` (16).
- **"Pais" recorta-se por escalão.** `POST /api/announcements` aceita `teamIds`:
  o mesmo público, estreitado às equipas escolhidas ("o Sub-19 muda o treino de
  sábado"). Vazio continua a ser *todos os pais de quem envia*. O recorte fica
  **gravado** na audiência — é o que o registo mostra ("Pais · Sub-19 Futebol") e
  o que a app da família já lia para não mostrar a um pai do Sub-11 o aviso do
  Sub-19. O treinador recorta dentro do âmbito dele e o servidor recusa o resto;
  o diálogo diz quantas famílias o recorte acorda antes de publicar.
- **O treino herda o treinador da equipa.** `TrainingSession.coachId` continua a
  ser a **excepção** ("hoje dá o adjunto") e não tem UI que a preencha — por isso
  todos os treinos diziam "Sem treinador atribuído", mesmo os de uma equipa com
  treinador principal. A queda para `TeamStaff` é feita na **leitura**
  (`headCoaches` em `academy.service.ts`), e não copiada para cada linha ao criar:
  assim mudar o treinador da equipa chega ao calendário, às presenças e à app da
  família no pedido seguinte, em vez de deixar treinos futuros com o nome de quem
  saiu. O alarme "sem treinador" passa a significar o que diz — a equipa não tem
  treinador nenhum.
- **A ficha de staff grava as equipas.** "Editar ficha" mandava-as para memória:
  a atribuição desaparecia ao recarregar, e o treinador entrava sem âmbito
  (`AuthService.scopeFor` deriva-o de `TeamStaff`). Passa por
  `PATCH /api/staff/:id/teams`, que exige `access:write` — as equipas de um
  treinador são o acesso dele aos dados, não uma etiqueta. O resto do diálogo
  (nome, contactos, cargo, departamento) **continua local**.
- **"Instalada" na página Famílias deixou de ser um `false` escrito à mão.** A
  API responde com `Membership.lastSeenAt` (marca de presença escrita no
  `bootstrap`, no máximo de hora a hora) **ou** uma `PushSubscription` viva. As
  duas metades são precisas: quem instala e salta as notificações não tem
  subscrição, e quem já usava a app é anterior à coluna.
- **O calendário de cobrança é do clube, e vê-se.** Os meses em que se cobra
  viviam em `SubscriptionPlan.months`, com um valor por omissão que exclui Agosto:
  ninguém o escolheu, nenhum ecrã o mostrava, e um clube que arrancou em Agosto
  inscrevia atletas e via Mensalidades vazia — sem erro nenhum. Subiu para
  `Academy.billingMonths` (migração `meses_de_cobranca`, mesmo valor por omissão,
  nenhum clube muda de comportamento), e Definições → Pagamentos passa a mostrar e
  a editar o dia de vencimento e os doze meses. Ligar um mês gera já as
  mensalidades em falta; desligar não apaga as emitidas. A coluna do plano fica
  como histórico e **deixou de ser lida** — o dia em que um plano precisar de
  calendário próprio, é aí que volta.
- **Quem se inscreve num mês é cobrado nesse mês**, esteja ele no calendário ou
  não. O calendário responde a "que meses é que o clube cobra a quem já cá está";
  não responde à inscrição — um atleta que entra a 27 de Agosto treinou em
  Agosto, e a mensalidade tem de aparecer. Nasce por pagar, como todas; se a
  direcção não a quiser cobrar, anula-a, e uma anulação registada vale mais do
  que uma cobrança que nunca existiu. A excepção é derivada de `Athlete.joinedAt`
  e não de uma opção, por isso vale em todos os caminhos que geram — a inscrição,
  a importação, e o "definir o preço" que apanha quem ficou para trás. Quem entra
  **depois** do dia de vencimento não nasce em dívida: a mensalidade continua a
  ser a desse mês e vence no prazo seguinte, senão nascia vermelha e com um
  lembrete automático a caminho da família na mesma noite.
- **A ausência em Mensalidades passou a ter explicação.** `GET /api/charges/em-falta`
  diz quem não tem mensalidade no período e porquê — `fora-do-mes` (o clube não
  cobra este mês), `sem-preco` (falta configurar) ou `por-gerar` (tem preço e
  falta emitir) — e o ecrã mostra-o por baixo da tabela, com a acção certa para
  cada caso. Antes eram três coisas diferentes debaixo da mesma frase, "Sem
  mensalidades neste filtro". O botão que emite chama `POST /api/charges/gerar`,
  que já existia e que nada na consola chegava a chamar.
- **Mensalidades exportam-se para Excel.** O botão existia e não fazia nada.
  Agora abre um diálogo com o intervalo em **meses** (uma mensalidade não tem
  dia: tem um período), atalhos para "Este mês", "Últimos 3 meses", "Época"
  (Agosto a Julho, como a idade dos atletas) e "Tudo", mais um filtro de estado
  para o caso mais pedido — a lista de quem está por cobrar. O ficheiro sai como
  `{clube}_mensalidades_{de}_a_{ate}.xlsx`, com uma folha de linhas (valor em
  número, vencimento em data, filtro do Excel já ligado) e uma de **Resumo**
  (totais por estado e por equipa, e a data em que foi gerado). Feito no browser
  com `xlsx` em `import()` dinâmico: os dados já estão em memória, e um endpoint
  de exportação seria a mesma pergunta com um segundo âmbito para divergir.
- **A app da família é da família, e o servidor sabe qual é o chapéu.** Um
  utilizador pode ter duas memberships na mesma academia — o treinador que também
  é pai é o caso mais banal que há num clube — e o `AuthService` escolhia **a
  primeira que encontrasse**. Com a de treinador, a app da família recebia o
  plantel inteiro de `/api/athletes` e mostrava-o como "os meus filhos", porque é
  assim que ela lê essa lista. Agora cada app declara-se (`x-app: family` /
  `x-app: console`) e `escolherMembership` decide: a app da família **exige**
  vínculo de família e recusa com 403 quem não o tiver; a consola **prefere** o de
  staff e aceita o outro. O cabeçalho não é uma credencial — só escolhe entre o
  que a pessoa já tem. Do lado da app há a segunda camada, que explica em vez de
  mostrar um erro. Verificado por `npm run test:family-scope` (24).
- **O push registava-se sempre contra a `life-club`.** `lib/push.ts` tinha o slug
  escrito à mão, de quando só havia a academia de demonstração: em qualquer outro
  clube o servidor recusava o registo e as notificações ficavam por activar sem
  explicação. Passou a usar o `academySlug()` do resto da app.
- **Um cargo novo nasce com o que o departamento dá.** O diálogo de criar cargo
  começava sempre no mínimo (`ROLE_PERMISSIONS.STAFF`) e só copiava o
  departamento quando alguém **trocava** o selector — mas quem carrega em "Novo
  cargo" dentro da Equipa Técnica nunca troca selector nenhum: já lá está. O
  resultado era um "Treinador Principal" sem `calendar:write` nem
  `attendance:write`, num departamento que dá as duas: o treinador não marcava
  treinos nem registava presenças, e nada no ecrã dizia porquê. Os cargos criados
  antes desta correcção arranjam-se num gesto — abrir o departamento, Guardar com
  "aplicar estas permissões aos N cargos".
- **Um treinador marca só para as equipas dele**, e isso está agora provado nos
  dois sentidos. O `test-events` usava o treinador semeado — que tem as **duas**
  equipas — e por isso só verificava o "toda a academia". Passou a usar o
  adjunto, que tem uma: marca treino e jogo na dele (200), leva 403 na do colega
  nos dois casos, não desmarca o treino de outra equipa, e a lista de eventos só
  lhe traz a equipa dele. Treino e jogo à parte porque por baixo são tabelas
  diferentes (`TrainingSession` e `Match`) e podiam ter guardas diferentes.
  Verificado por `npm run test:events` (24).
- **Um pedido ao scouting diz sempre para que escalão é.** O campo era texto
  livre e opcional — cada pessoa escrevia "Sub-15", "sub15" ou nada, e um pedido
  sem escalão chega ao scouting sem destino. Passou a ser a lista de equipas de
  quem pede, que para um treinador é o âmbito dele (`listTeams`), e é
  **obrigatório** para quem tem âmbito: um treinador pede para as equipas dele e
  não para o clube. A direcção mantém o "qualquer escalão" — é ela que pode
  procurar sem destino decidido. O servidor impõe o mesmo (`createRequest`): sem
  escalão dá 400, com o escalão de outra equipa dá 403.
- **Do calendário da equipa marca-se um evento.** O separador Calendário da ficha
  de equipa tem "Marcar treino" e "Marcar jogo", que levam ao calendário com o
  "Novo evento" já aberto no tipo **e na equipa certos**
  (`/calendario?novo=treino&equipa=…`). Marcar continua a ser do calendário — é lá
  que se vê o que já está ocupado —, o que desapareceu foi a viagem às cegas.
- **As presenças já se gravam a sério.** Viviam inteiras num `Record` em memória
  do browser: o treinador registava as faltas, carregava em Guardar, via a folha
  fechada — e ao recarregar a página estava tudo por registar outra vez. Sem erro
  nenhum, porque não havia erro: **a escrita nunca saía do browser**. O
  `GET /api/sessions` já devolvia as presenças da base desde sempre; o que faltava
  era um endpoint que lá pusesse alguma coisa.
  `PUT /api/sessions/:id/attendance` fecha a folha (`attendance:write`, com âmbito
  por equipa): substitui em vez de acumular — corrigir é regravar, e quem sai da
  segunda lista deixa de ter falta —, marca `attendanceClosedAt` e passa o treino
  a realizado. O corpo traz **só quem faltou**, e uma lista vazia continua a ser a
  afirmação "estiveram todos", diferente de ninguém ter verificado. O servidor
  recusa uma falta a quem está de baixa (a mesma regra da convocatória, derivada
  do boletim) e um atleta que não é do plantel daquela equipa. O diálogo passou a
  esperar pela resposta: só fecha quando o servidor confirmar, e uma recusa
  aparece lá dentro com as marcas todas onde estavam.
  Verificado por `npm run test:attendance` (28), que começa pelo que faltava —
  gravar, reler num pedido novo, e exigir que as faltas continuem lá.
- **Falta justificada leva motivo.** No registo de presenças, escolher "Justificada"
  abre um campo para o motivo (ex.: consulta médica); o motivo aparece também na
  ficha do atleta, ao lado da falta — e persiste com a folha, como o resto.
- **Sem escrita nenhuma ainda: avaliações.** **Não** tem escrita local a converter —
  é um ecrã só de leitura (`Evaluation` existe na base, mas não há UI que a crie nem
  endpoint de escrita). É uma feature a construir de raiz, não uma migração.
- MFA da impersonation e limite de tentativas no resgate de convite: o segundo
  **foi corrigido** (rate-limit de 5/min), o primeiro fica com a feature. Ver
  [05-seguranca](05-seguranca.md).
