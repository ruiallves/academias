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
| Permissões | 26 permissões, 8 papéis, âmbito por equipa/atleta — cliente e servidor, gémeos |
| Dados reais | `npm run seed`: 1 academia, 2 equipas, 9 atletas, 5 pessoas de staff, 2 famílias, 3 jogos |

**A consola lê a base de dados a sério.** `data/demo.ts` foi apagado — não existe
mais. `lib/store.ts` traz a academia da API ao arrancar (`GET /api/bootstrap` +
leituras em paralelo) e os ecrãs continuam a escrever `teams.filter(...)` como
sempre escreveram, através de *live bindings* de ES modules. Onde ainda não há
endpoint — avaliações, histórico de equipas — os dados vêm **vazios**, nunca
inventados: um ecrã que diz "ainda não há avaliações" é honesto.

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
| **Convocatórias** | montar e submeter a lista de um jogo, com tecto configurável por equipa e convite de atletas de escalões inferiores |
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

Verificado por `npm run test:callups` (22, o essencial) e
`npm run test:guest-callups` (11, a regra de subida e o que se pode ver de fora).

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

**O pagamento só muda de estado pelo webhook.** Não existe endpoint que marque
algo como pago; o navegador nunca decide. O webhook verifica assinatura HMAC (com
segredo forte obrigatório) e o valor pago.

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
- **Falta justificada leva motivo.** No registo de presenças, escolher "Justificada"
  abre um campo para o motivo (ex.: consulta médica); o motivo aparece também na
  ficha do atleta, ao lado da falta. Vive com as presenças, que ainda são locais.
- **Sem escrita nenhuma ainda: avaliações.** **Não** tem escrita local a converter —
  é um ecrã só de leitura (`Evaluation` existe na base, mas não há UI que a crie nem
  endpoint de escrita). É uma feature a construir de raiz, não uma migração.
- MFA da impersonation e limite de tentativas no resgate de convite: o segundo
  **foi corrigido** (rate-limit de 5/min), o primeiro fica com a feature. Ver
  [05-seguranca](05-seguranca.md).
