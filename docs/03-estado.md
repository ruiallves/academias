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
| **Avaliações** | por competência, rascunho vs publicada |
| **Relatórios** | cobertura por equipa (Fase 4 por construir) |
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
público "Geral" e "Treinadores" é da direção.

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

**Sobe, nunca desce.** Um treinador pode convidar um atleta de um escalão
inferior — um Sub-13 pode reforçar-se com um Sub-11 — nunca ao contrário. A regra
compara o número extraído do texto do escalão (`"Sub-13"` → 13); quando o texto
não segue esse padrão (natação com `"10–14 anos"`), a resposta é **nenhum
candidato**, nunca "todos são elegíveis". O que se mostra de uma equipa alheia é
nome, número, posição e disponibilidade — nunca o diagnóstico, que fica fora do
âmbito de quem convida.

O tecto de convocados (`Team.maxCallUps`) é configurável por equipa, ali mesmo no
ecrã. Um convocado emprestado aparece marcado como tal na convocatória e na
própria ficha ("Emprestado ao Sub-13"), e o pai recebe uma notificação concreta —
adversário, hora, sítio — não um "tens uma notificação".

Verificado por `npm run test:callups` (22, o essencial) e
`npm run test:guest-callups` (11, a regra de subida e o que se pode ver de fora).

---

## App das famílias (PWA)

| | |
|---|---|
| **Hoje** | mensalidade em falta primeiro · próximo treino · alterações · próxima consulta |
| **Agenda** | treinos por dia + consultas e exames agendados |
| **Pagamentos** | MB Way, Multibanco, cartão · estado "a confirmar" honesto · histórico |
| **Atleta** | assiduidade, avaliação do treinador, inscrição, notificações |

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
| Landing B2B | a página de marketing para angariar academias |
| Relatórios (Fase 4) | o que a família recebe no fim do período |
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
- **Falta justificada leva motivo.** No registo de presenças, escolher "Justificada"
  abre um campo para o motivo (ex.: consulta médica); o motivo aparece também na
  ficha do atleta, ao lado da falta. Vive com as presenças, que ainda são locais.
- **Sem escrita nenhuma ainda: avaliações.** **Não** tem escrita local a converter —
  é um ecrã só de leitura (`Evaluation` existe na base, mas não há UI que a crie nem
  endpoint de escrita). É uma feature a construir de raiz, não uma migração.
- MFA da impersonation e limite de tentativas no resgate de convite: o segundo
  **foi corrigido** (rate-limit de 5/min), o primeiro fica com a feature. Ver
  [05-seguranca](05-seguranca.md).
