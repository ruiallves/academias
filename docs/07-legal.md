# Documentos legais e aceitação

Termos de Serviço, Termos de Utilização, Política de Privacidade, Política de
Cookies, Acordo de Tratamento de Dados (DPA) e Política de Utilização Aceitável
— versionados, publicados pela plataforma, aceites na entrada, com registo.

---

## O modelo

```
LegalDocument      uma linha por VERSÃO de um tipo
  type             TERMS_OF_SERVICE | TERMS_OF_USE | PRIVACY_POLICY | COOKIE_POLICY | DPA |
                   ACCEPTABLE_USE | ACADEMIAS_AI_TERMS | DATA_RETENTION_POLICY
  version          "1.0", "1.1", "2.0"
  status           DRAFT → PUBLISHED → RETIRED  (nunca se apaga o publicado)
  scope            CLUB (vincula o clube) | USER (vincula a pessoa)
  audiences[]      CLUB_OWNER | STAFF | FAMILY | MEMBER — quem tem de aceitar
  acceptanceKind   ACCEPT ("Aceito") | ACKNOWLEDGE ("Li") | NONE (só se publica)
  effectiveAt      pode ser futura: publica-se hoje, vale daqui a 30 dias
  content, contentHash (SHA-256)

LegalAcceptance    append-only — a prova
  userId, academyId, membershipId, documentId
  documentType, documentVersion, contentHash, scope   (desnormalizados)
  onBehalfOfClub   true quando vincula o clube
  context          SIGNUP | LOGIN_GATE | TERMS_UPDATE | SETTINGS
  acceptedAt, ip, userAgent
```

**A versão em vigor** de um tipo é derivada: a `PUBLISHED` com o `effectiveAt`
mais recente que já passou. Não há coluna `isCurrent`. Cache de um minuto em
`LegalService.current()`, invalidada ao publicar ou retirar.

**Quem é quem** (`LegalService.audiencesOf*`). Uma pessoa está numa audiência
por clube, derivada do que já existe — nada de papéis novos:

| Audiência | Como se decide |
|---|---|
| `CLUB_OWNER` | tem a permissão `legal:club` (presidência e direção por omissão; delega-se num cargo, não pessoa a pessoa) |
| `STAFF` | vínculo de pessoal sem `legal:club` |
| `FAMILY` | `GUARDIAN` ou `ATHLETE` |
| `MEMBER` | ficha de sócio reclamada (`Member.userId`) |

Quem representa o clube é `CLUB_OWNER` **e não** `STAFF`: os Termos de Serviço
que aceita pelo clube cobrem a utilização que ele próprio faz. É uma decisão
jurídica a confirmar — está como dado em `legal.catalog.ts` e nas audiências de
cada versão, e muda-se sem tocar em `if`s.

**O que está pendente** (`statusFor`): para cada versão em vigor cuja audiência
inclua a pessoa e cujo `acceptanceKind` não seja `NONE`:

- âmbito `CLUB` → satisfeito se **alguém** do clube aceitou essa versão pelo clube;
- âmbito `USER` → satisfeito se **esta pessoa** aceitou essa versão, em qualquer clube.

Uma versão nova de um tipo já aceite aparece com `previousVersion` preenchido,
e o gate diz "Os termos foram atualizados" em vez de "Antes de começar".

**A confirmação de poderes** ("Confirmo que estou autorizado a representar o
clube") é `needsAuthority` no estado, e pede-se **uma vez por clube**, a quem o
inaugura: a primeira pessoa que o vincula a um documento contratual. A partir
daí ninguém mais responde à pergunta — nem essa pessoa numa actualização dos
termos, nem um segundo responsável que entre depois. `clubAlreadyBound()` é
quem decide, e o servidor volta a verificá-lo ao aceitar.

---

## O gate

**Servidor.** O `AuthGuard` chama `LegalService.assertClearContext()` no fim de
cada pedido autenticado de academia. Com pendentes, o pedido leva 403 com o
código `LEGAL_ACCEPTANCE_REQUIRED`. Rotas `@LegalExempt()` passam (o sinal de
presença); as rotas `/api/legal/*` são `@Public()` com autenticação própria —
são elas que permitem sair do gate. A área de sócio, que não passa pelo guard,
verifica em `ClubAppService.socioDe()`. Custo: zero enquanto não houver
documento em vigor para a audiência; depois, uma consulta por minuto por pessoa.

**Consola.** `LegalGate` em `main.tsx`, entre `LoginGate` e `AcademyBoot` — com
sessão, antes de pedir o `/api/bootstrap`. **App do clube.** `LegalGate` na
cascata do `App.tsx`, depois dos contextos e antes de escolher área. Nos dois, um
403 com o código durante a sessão recarrega a página, que volta a cair no gate.

**Na criação de conta** os termos aceitam-se ao escolher a password, e o gate
não chega a aparecer. Os três caminhos — o convite de staff
(`invite.template.ts` + `InvitesService.accept`), o registo de família
(`Entrar.tsx` + `FamilyInvitesService.register`) e o convite de sócio
(`ConviteSocio.tsx` + `ClubAppService.conviteRegistar`) — mostram uma caixa por
documento (`GET /api/legal/required?audience=…`, com link para o site) e enviam
`acceptLegal: true`. O servidor exige-o **antes** de criar a conta no Supabase
(`assertSignupConsent`) e grava as aceitações na mesma transação da
`Membership` (`acceptAtSignup`, contexto `SIGNUP`). O cargo do convite decide a
audiência: com `legal:club` (a presidência) mostram-se também os documentos de
clube, e a confirmação de poderes só aparece se o clube ainda não estiver
inaugurado. Sem documentos publicados nada é exigido.

**Aceitar** é `POST /api/legal/accept` com `documentIds` e, quando o clube
ainda não foi inaugurado e há documentos de âmbito `CLUB`, `confirmAuthority:
true`. O servidor valida tudo: a versão está em vigor, a audiência aplica-se,
quem vincula o clube tem `legal:club`, e a confirmação de poderes foi dada se
ainda era devida. Idempotente. O `context` é decidido no servidor (`SETTINGS` é
o único que o cliente pode pedir).

---

## Endpoints

| | |
|---|---|
| `GET /api/legal/documents` | as versões em vigor, sem texto (público) |
| `GET /api/legal/documents/:slug` | a versão em vigor, com texto (público) |
| `GET /api/legal/documents/:slug/versions` | as versões publicadas (público) |
| `GET /api/legal/documents/:slug/:version` | uma versão concreta (público) |
| `GET /api/legal/required?audience=` | o que uma audiência aceita ao criar conta, com link (público) |
| `GET /api/legal/status` | o que falta a esta conta neste clube |
| `POST /api/legal/accept` | aceitar |
| `GET /api/legal/history` | o que aceitei; e o que o clube aceitou, se o represento |
| `GET/POST /api/platform/legal/documents`, `PATCH/DELETE …/:id` | versões (plataforma; `OWNER`/`ADMIN`) |
| `POST /api/platform/legal/documents/:id/publish` · `…/retire` | só `OWNER`; ficam no `AuditLog` |
| `GET /api/platform/legal/stats` | aceitação por versão em vigor, e os clubes que faltam |
| `GET /api/platform/legal/acceptances` | o registo, com IP e dispositivo |

Slugs: `termos-de-servico`, `termos-de-utilizacao`, `privacidade`, `cookies`,
`dpa`, `utilizacao-aceitavel`, `academias-ai`, `retencao-de-dados`. Os caminhos
antigos do site (`/termos`, `/privacidade`, `/cookies`, `/dpa`) redireccionam.

---

## Isolamento

- `LegalDocument`: RLS `published_only`; `academia_app` só tem `SELECT`. Escreve a
  plataforma, pela ligação dela.
- `LegalAcceptance`: RLS `own_or_academy` — linhas do clube corrente
  (`app.academy_id`) **ou** do próprio (`app.user_id`, posto pelo serviço dentro
  de `runAs`, LOCAL como o outro). `academia_app` só tem `SELECT` e `INSERT`:
  nem o servidor apaga uma prova. Fora de `TENANT_SCOPED` de propósito.

---

## Pôr a funcionar

1. `npx prisma migrate deploy` — cria as tabelas. **Não bloqueia ninguém.**
2. Deploy da API, da consola, da app do clube, do site e da plataforma.
3. `npm run seed:legal --workspace=@academia/api` — publica a 1.0 de seis
   documentos (`prisma/legal/*.md`). **A partir daqui o gate está ligado**: cada
   pessoa vê-o na próxima entrada. `-- --dry-run` mostra o que faria.
4. Preencher `COMPANY` em `apps/site/src/lib/content.ts` antes de publicar.

Os clubes que já existem não são tocados: continuam intactos até o responsável
aceitar. A plataforma (`/legal`) lista quem ainda não aceitou cada documento de
clube — é o estado "por aceitar", derivado e não guardado.

**Os textos não passaram por advogado.** Ver `prisma/legal/LEIA-ME.md`.

Verificado por `npm run test:legal` (78 casos: clube existente bloqueado e a
aceitar, utilizador normal só com os dele, criação de conta por convite com e
sem `legal:club`, família, nova versão com histórico intacto, a confirmação de
poderes uma vez por clube, plataforma, isolamento). Cria os documentos que usa e
apaga-os no fim.

Com documentos publicados, a academia de demonstração também fica atrás do
gate — e os testes que entram como `direcao@lifeclub.pt` levam 403 até alguém
aceitar por ela. `node scripts/aceitar-termos-demo.mjs` faz isso pela API,
pelas nove contas semeadas.
