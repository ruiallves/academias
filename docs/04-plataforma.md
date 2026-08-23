# Platform Admin

O painel de quem é dono do SaaS. Não é a consola de uma academia com mais botões —
é outro produto, com outro utilizador, outra pergunta e outra fronteira de
segurança.

---

## Os três níveis

| Nível | Quem | Pergunta que responde | Âmbito |
|---|---|---|---|
| **Platform Admin** | nós | O negócio está a crescer? O que precisa da minha atenção? | todas as academias |
| **Academy Console** | direção, treinadores, clínico | A minha academia está a funcionar? | uma academia |
| **Family PWA** | pais | O meu filho treina quando? Devo alguma coisa? | um ou dois atletas |

A regra que os separa: **cada nível vê estritamente menos do que o de cima, e
nunca de lado**. Uma academia nunca vê outra academia. É isto que o resto do
documento existe para garantir.

---

## Identidade: porque é que "PLATFORM_ADMIN" não é um papel

A tentação óbvia é acrescentar `PLATFORM_ADMIN` ao enum `Role` e seguir viagem.
Seria um erro, e vale a pena perceber porquê antes de escrever código.

`Role` vive em `Membership`, que é **a ligação de uma pessoa a uma academia**. Todo
o sistema — a RLS, o `AuthService.contextFor`, o `teamScopeFilter` — parte do
princípio de que um pedido pertence a uma academia. Um papel que significasse
"todas as academias" seria um valor especial que cada uma dessas peças teria de
tratar à parte, e bastava uma esquecer-se para a separação deixar de existir. Pior:
a falha seria silenciosa, e do lado errado.

Por isso um administrador da plataforma é **uma tabela à parte**:

```
PlatformAdmin
  authId    -> auth.users.id do Supabase
  name, email
  role      OWNER | ADMIN | SUPPORT
  isActive
  mfaEnrolledAt
```

Consequências, todas desejadas:

- Um administrador da plataforma **não tem `Membership` nenhuma**. Se abrir a
  consola de uma academia pelo caminho normal, leva 403 — como qualquer estranho.
- Um utilizador de academia **não pode ganhar acesso à plataforma** por muito que
  lhe concedam permissões: `access:write` mexe em `Membership.grants`, e isso não
  chega a esta tabela.
- As duas verificações são feitas por guards diferentes, em módulos diferentes.
  Não há um `if` partilhado onde um engano contamine os dois lados.

### Papéis dentro da plataforma

| Papel | O que pode |
|---|---|
| `OWNER` | tudo, incluindo gerir administradores e planos |
| `ADMIN` | academias, subscrições, convites, analítica |
| `SUPPORT` | leitura + "Ver como academia" — não mexe em faturação |

---

## O problema da RLS, e a saída

A RLS existente filtra tudo por `app.current_academy_id()`. O Platform Admin
precisa exactamente do contrário: contar atletas de **todas** as academias, listar
academias, somar MRR.

Há duas formas de resolver isto, e uma delas é má:

**Má:** dar ao servidor uma ligação com `BYPASSRLS` para os pedidos da plataforma.
Funciona no primeiro dia e, no dia em que alguém reutilizar essa ligação por
comodidade, a separação entre academias desaparece sem deixar rasto.

**A que se usa:** funções `SECURITY DEFINER` estreitas, o mesmo padrão já usado em
`app.resolve_academy_by_slug`, `app.resolve_payment_academy` e `app.resolve_invite`.
Cada uma sabe fazer **uma** pergunta e devolve **agregados ou metadados**, nunca
linhas de domínio:

| Função | Devolve |
|---|---|
| `app.platform_overview()` | contagens e somatórios globais — uma linha |
| `app.platform_academies()` | uma linha por academia: nome, estado, plano, contagens, MRR |
| `app.platform_academy(id)` | o detalhe de uma academia: contagens, progresso, faturação |
| `app.platform_series(from, to)` | séries mensais para os gráficos |

Nenhuma delas devolve o nome de um atleta, um contacto de um pai ou um boletim
clínico. **O Platform Admin vê o negócio, não vê as pessoas dentro das academias.**
Para ver dados de uma academia há um caminho só, e está desenhado abaixo.

---

## "Ver como academia" — impersonation

A funcionalidade mais perigosa do produto. O desenho parte do princípio de que ela
vai ser usada num dia mau, com um cliente ao telefone, por alguém com pressa.

**Como funciona**

1. Só `OWNER` e `SUPPORT`, e só com **MFA verificado nos últimos 15 minutos**.
2. Exige um **motivo escrito** e, quando exista, o ticket de suporte associado.
3. Emite uma sessão de suporte com **validade de 30 minutos**, para uma academia
   só, e **de leitura**. Escrever em nome de um cliente é outra decisão e não entra
   nesta versão.
4. Fica registada em `AuditLog` na abertura, e cada pedido feito com ela é marcado.
5. A consola mostra uma **barra fixa e inequívoca** no topo: *"Modo de suporte —
   estás a ver a Academia X como leitura. Termina em 24 min."* Não é um badge
   discreto; ocupa espaço e não se fecha.
6. Termina sozinha. Não há renovação silenciosa.

**O que não faz:** não dá acesso a dados clínicos. São categoria especial no RGPD,
e "estava a dar apoio" não é fundamento legal para os ler. Um pedido de suporte que
precise mesmo disso escala para um pedido formal ao cliente.

---

## Estrutura do painel

```
Overview          o que precisa de atenção, depois os números
Academias         lista, detalhe, criação e convite
Contactos         quem já falámos, e em que pé está a conversa
Subscrições       planos, faturação, cobranças falhadas
Analytics         crescimento, retenção, utilização
Operações
  ├── Audit log   quem fez o quê, incluindo impersonation
  ├── Suporte     pedidos abertos e "ver como academia"
  └── Sistema     saúde dos serviços e webhooks
Definições        administradores da plataforma, planos
```

### Overview

A regra desta página: **primeiro o que exige acção, depois o que descreve o
estado**. É a mesma decisão já tomada na consola da academia, e pela mesma razão —
uma grelha de cartões obriga a procurar o problema; uma lista entrega-o.

**Needs attention** (no topo, accionável, cada item com um destino):

| Sinal | Porque importa |
|---|---|
| Trial a acabar em ≤ 3 dias sem cartão | é a conversão a escapar-se |
| Onboarding parado há > 7 dias | cliente que assinou e não arrancou — o preditor de churn mais forte |
| Academia sem atividade há > 14 dias | deixou de registar presenças; vai cancelar |
| Pagamento de subscrição falhado | receita em risco, e resolve-se com um telefonema |
| Webhook euPago com erros | dinheiro do cliente por confirmar |
| Academia sem treinadores ativos | comprou e não usa |

Só depois: MRR, ARR, academias por estado, atletas, famílias, adesão à PWA.

**Gráficos — quatro, e só quatro.** Um gráfico que não muda uma decisão é ruído:

1. **MRR ao longo do tempo**, com novo / expansão / churn empilhados. É o único
   gráfico que conta a história inteira do negócio.
2. **Academias novas por mês** vs canceladas — barras para cima e para baixo do
   mesmo eixo.
3. **Retenção por coorte** — mês de entrada em linhas, quantas sobrevivem. É o que
   diz se o produto está a melhorar ou só a vender melhor.
4. **Utilização** — % de academias que registaram presenças esta semana. O melhor
   preditor isolado de renovação neste produto.

Não há gráficos de pizza, não há velocímetros, não há "atividade recente" em
gráfico. Contagens simples ficam em texto grande, que se lê mais depressa.

### Academias

Tabela densa, ordenável, uma linha por academia:

`Nome · Estado · Plano · Atletas · Staff · MRR · Entrou em · Onboarding · Última atividade`

O **estado** é derivado, não escrito à mão:

| Estado | Como se decide |
|---|---|
| `SETUP` | convite aceite, onboarding por completar |
| `TRIAL` | a usar, dentro do período de avaliação |
| `ACTIVE` | subscrição a pagar |
| `PAST_DUE` | pagamento falhado, ainda com acesso |
| `CANCELLED` | terminou |

**Onboarding em percentagem** — os oito passos abaixo, contados a partir dos dados
reais da academia. Nenhum deles é uma caixa que alguém marca; é a mesma disciplina
do painel de primeiros passos da consola.

### Criar academia + convite ao diretor

```
+ Nova Academia
   Nome da academia          → gera o slug, editável
   Email do diretor
   Plano                     → e duração do trial
   [ Criar e enviar convite ]
```

Cria a `Academy` em `SETUP` e emite um `StaffInvite` de `DIRECTOR` — **reutilizando
o mecanismo de convites que já existe**: token de 32 bytes, só o hash guardado,
7 dias, uso único, revogável. Não se inventa um segundo sistema de convites.

O diretor recebe o link, escolhe password, e cai no onboarding.

### Onboarding do diretor — oito passos

| # | Passo | Conta como feito quando |
|---|---|---|
| 1 | Criar conta | o convite é resgatado |
| 2 | Dados e branding | nome, cidade e cor definidos |
| 3 | Modalidades | ≥ 1 `Sport` |
| 4 | Equipas | ≥ 1 `Team` |
| 5 | Staff | ≥ 1 treinador com conta ou convite pendente |
| 6 | Pagamentos | credenciais euPago validadas |
| 7 | Atletas | ≥ 1 `Athlete` |
| 8 | Pronta | os sete anteriores |

`78% setup completed` é `passos feitos / 8`. Derivado a cada leitura, nunca
guardado — um número guardado à parte diverge no dia em que alguém apagar uma
equipa.

### Contactos

A lista de quem já falámos e ainda não é cliente. Responde a uma pergunta só — **a
quem ligo hoje** — e é isso que decide tudo o resto do desenho.

`Nome · Número · Clube · Estado · Seguimento · Último contacto`

Quatro colunas de identidade e duas de tempo. O cargo, o email, as notas e o
histórico das conversas ficam na ficha, a um clique: uma tabela com dezoito colunas
obriga a procurar, uma com quatro entrega. As duas colunas de tempo ganham o lugar
por serem as únicas que geram trabalho — o **seguimento** é o que há para fazer, o
**último contacto** é quem está a esfriar.

A ordem por omissão não é alfabética nem por data de entrada: **seguimento
atrasado primeiro**, depois o marcado, depois o resto por ordem de esfriamento. É
a ordem por que o dia se faz.

**Os sete estados**, e cada um muda o que se faz a seguir:

| Estado | O que significa |
|---|---|
| `NOVO` | está na lista, ninguém falou com ele |
| `CONTACTADO` | falámos; a bola está do lado deles |
| `SEM_RESPOSTA` | falámos e não voltaram — é o estado que pede insistência |
| `REUNIAO` | há reunião ou demonstração marcada |
| `PROPOSTA` | proposta entregue, à espera de resposta |
| `CLIENTE` | fechou; costuma ter a `Academy` ligada |
| `PERDIDO` | disse que não, ou deixou de fazer sentido |

**Registar um contacto** é uma operação só, e não três: o que aconteceu (canal e
nota), em que pé ficou (estado) e quando se volta a falar (data). São a mesma
pergunta na cabeça de quem acabou de desligar o telefone, e separá-las em ecrãs
seria garantir que o terceiro nunca se preenche. Cada registo fica em
`ContactTouch` — é o histórico que distingue "contactado" de "contactado três
vezes sem resposta", e é essa diferença que decide se se volta a ligar.

#### A fronteira, outra vez

Estas pessoas são **de fora**: um diretor de um clube que ainda não é cliente. É o
que faz isto ser legítimo deste lado — continua a valer que o Platform Admin não
vê as pessoas dentro das academias. Um pai ou um treinador de um cliente **não
entra nesta tabela**, e a razão é essa.

Como as outras tabelas da plataforma, `Contact` e `ContactTouch` são retiradas ao
papel `academia_app` na migração. Não é decoração: a migração de RLS deixou
`ALTER DEFAULT PRIVILEGES` a conceder acesso a *qualquer tabela nova*, por isso uma
tabela da plataforma que não revogue explicitamente nasce legível a partir de um
pedido de academia — e sem RLS, legível por inteiro.

#### Google Calendar

Os seguimentos aparecem no calendário de quem anda a falar com clubes, por duas
vias deliberadamente diferentes:

| Via | O que faz | Quando serve |
|---|---|---|
| **Feed `.ics` subscrito** | um endereço que o Google vai buscar sozinho; cada contacto com data futura é um evento que se move quando a data muda | o pano de fundo — tudo o que está marcado, sempre actualizado |
| **"Agendar no Google"** | abre o Google com o evento preenchido; guarda-se com um clique, com convidados e notificações | quando é para amanhã de manhã e não pode esperar pela sincronização |

**Porque não a API do Google.** OAuth traria um projecto na Google Cloud, um ecrã
de consentimento a rever, tokens de refresh guardados e um escopo de escrita no
calendário de uma pessoa — muita superfície, e uma dependência de terceiros no
caminho de uma lista que tem de abrir. Um feed subscrito faz o que é preciso.

**O token é a autenticação.** Uma subscrição de calendário é um `GET` anónimo dos
servidores do Google: não há onde levar um cabeçalho de sessão. Consequências,
todas assumidas e ditas no ecrã: o segredo é por administrador, nasce só quando
alguém o pede, revoga-se gerando outro, e a rotação fica no `AuditLog`. O feed vive
num controlador à parte — `ContactsCalendarController` — precisamente para que
ninguém acrescente ali uma rota a pensar que está protegida.

O que o feed **não** mostra: contactos sem data marcada, o histórico das conversas,
e nada de nenhuma academia. Fechados (`CLIENTE`, `PERDIDO`) também não — não geram
trabalho, e não têm por que tocar no telemóvel de ninguém.

### Subscrições

Plano por academia, ciclo, próxima cobrança, histórico, cobranças falhadas com
acção directa. Um plano é `Plan` na plataforma — não confundir com
`SubscriptionPlan`, que é a mensalidade que a academia cobra às famílias. **São dois
negócios diferentes e não se tocam:** nós cobramos à academia, a academia cobra aos
pais.

### Analytics

Onde os quatro gráficos vivem em detalhe, com corte por plano, por antiguidade e
por modalidade. Nada aqui é accionável — é para perceber, não para agir. Por isso
está longe do Overview.

### Audit log

Quem fez o quê, com IP e hora. Impersonation aparece a destaque e não se pode
filtrar para fora. O registo é **append-only**: não há endpoint que apague uma
entrada, e não deve haver.

### Sistema

Estado da base de dados, do Supabase Auth, do euPago e das notificações. Fila de
webhooks e falhas por reprocessar — o sítio onde se percebe que o dinheiro de um
cliente ficou por confirmar antes de o cliente ligar a perguntar.

---

## Desenho

Herda os tokens de `packages/ui` — mesma tipografia, mesmas hairlines, mesma
densidade. Duas diferenças deliberadas:

- **Cor de sinal própria**, fixa e distinta da cor de qualquer academia. Quem
  trabalha nos dois produtos tem de saber onde está pelo canto do olho.
- **Mais densa.** Este painel é para quem passa o dia nele e compara linhas; a
  consola é para quem entra três vezes por dia.

O que não se faz: cartões todos iguais em grelha, gráficos decorativos, números
sem unidade nem comparação. Todo o número tem contexto — variação face ao período
anterior, ou nada.

---

## Fronteiras que não se atravessam

1. O Platform Admin **não lê dados clínicos**. Nunca, nem em impersonation.
2. As funções de plataforma **não devolvem linhas de domínio** — só agregados e
   metadados de academia.
3. Um `Membership` nunca dá acesso à plataforma; um `PlatformAdmin` nunca dá acesso
   a uma consola sem passar pela sessão de suporte, registada e temporária.
   Em **Contactos** só entram pessoas de fora — nunca alguém que já pertence a uma
   academia cliente.
4. Impersonation é **de leitura**, com MFA, com motivo, com prazo e com registo.

---

## Estado da implementação

| Peça | Estado |
|---|---|
| Modelos, migração e separação de privilégios | **feito** |
| Funções `SECURITY DEFINER`: overview, academias, séries | **feito** |
| `PlatformGuard`, módulo `platform`, endpoints | **feito** |
| App `apps/platform` — Visão geral, Academias, Crescimento, Registo | **feito** |
| Contactos: lista, ficha, histórico de conversas | **feito** |
| Contactos: feed `.ics` para o Google Calendar + "Agendar no Google" | **feito** |
| Criar academia + convite ao diretor | **feito** (reutiliza o mecanismo de convites) |
| Papel `platform_app` sem BYPASSRLS | **por fazer** — ver `platform.prisma.ts` |
| Impersonation ("ver como academia") com MFA | por fazer |
| Subscrições: alterar plano, cobranças, faturação | por fazer |
| Onboarding guiado do diretor (os 8 passos no lado dele) | por fazer |
| System health e suporte | por fazer |

Verificado por `npm run test:platform` (25 testes, a fronteira ao nível da base de
dados), `npm run test:platform-api` (30 testes, os endpoints) e
`npm run test:contacts` (os contactos e o feed de calendário, incluindo o token
rodado a invalidar o anterior). Provam as duas
direcções: um diretor de academia leva 403 no painel, e um administrador da
plataforma leva 403 numa consola.

## Correr em desenvolvimento

```
cd apps/api      && npm run seed && npm run seed:platform && node dist/main.js
cd apps/platform && npm run dev      # :5180
```

Entrar com a conta criada por `seed:platform`. Em produção isto vive em
`admin.academias.pt`, e a variável `PLATFORM_ORIGIN` diz à API que essa origem
existe.
