# Arquitetura

## Stack

| Camada | Escolha |
|---|---|
| Frontend | React 19 + TypeScript + Vite 7 |
| Estilo | Tailwind CSS v4 (config em CSS) |
| Backend | NestJS 11 + TypeScript |
| Base de dados | Supabase PostgreSQL (região EU) |
| ORM | Prisma |
| Autenticação | Supabase Auth |
| Armazenamento | Supabase Storage |
| Pagamentos | euPago |
| PWA | `vite-plugin-pwa` |

Sem Next.js. Sem AWS. Monólito modular — um processo NestJS, módulos com fronteiras
reais, sem microserviços.

## Estrutura

```
academia-pro/
├─ apps/
│  ├─ console/     Web do diretor e do treinador
│  ├─ family/      PWA dos pais (white-label)
│  └─ api/         NestJS — monólito modular
├─ packages/
│  └─ ui/          Tokens e primitivas partilhadas
└─ docs/
```

`console` e `family` são apps separadas de propósito. Partilham tokens, não layout.
Encolher o dashboard para caber no telemóvel dá uma app que ninguém instala.

## Multi-tenancy

Uma linha em `Academy` por tenant. Todas as tabelas de domínio têm `academyId`.

Isolamento em duas camadas, porque uma só falha:

1. **Aplicação** — um `TenantGuard` põe `academyId` no contexto do pedido; o cliente
   Prisma tem uma extensão que injecta o filtro em todas as queries.
2. **Base de dados** — Row Level Security no Postgres com `current_setting('app.academy_id')`.

## Permissões

Papéis não são strings espalhadas por `if`s. São dados:

```
Permission  = "billing:read" | "billing:write" | "athlete:read" | ...
Role        → Permission[]
Membership  = (user, academy, role, scope)
```

`scope` é o que torna o treinador diferente do diretor: um `COACH` tem
`scope = { teamIds: [...] }` e o serviço estreita todas as queries a esse conjunto.
Um `GUARDIAN` tem `scope = { athleteIds: [...] }`.

No frontend a mesma tabela alimenta a navegação — um item sem permissão não aparece,
não aparece desactivado. Ver `apps/console/src/lib/permissions.ts`.

## Multi-desporto

Nada de futebol no modelo. `Sport` é uma linha de configuração da academia; posições,
competências e escalões são dados por desporto, não enums no código.

```
Academy ─ sports[] ─ Sport { name, positions[], skillFramework }
Team ─ sportId, maxAge, season
```

Uma academia de natação cria `Sport { name: "Natação", positions: [] }` e a UI adapta-se
por ausência, não por `if (sport === 'football')`.

## Fluxo de pagamento

O frontend **nunca** decide se um pagamento foi bem sucedido.

```
Pai → PWA → POST /billing/charges/:id/pay
              └─ API cria referência/link na euPago, grava Payment{PENDING}
              └─ devolve dados de pagamento ao PWA

euPago → POST /webhooks/eupago  (assinado)
              └─ verifica assinatura
              └─ idempotência por (provider, providerRef)
              └─ Payment{PAID}, Charge{SETTLED}
              └─ enfileira Notification → pai
```

Regras:

- O webhook é a única fonte de verdade sobre o estado de um pagamento.
- Todos os eventos entram em `WebhookEvent` em bruto antes de serem processados.
- Reprocessar o mesmo evento não pode cobrar nem notificar duas vezes.
- O retorno do utilizador (`/pagamento/retorno`) mostra "a confirmar" até o webhook
  chegar. Nunca "pago".

## Notificações

`Notification` é uma linha na base de dados com `type`, `payload`, `channels[]`,
`readAt`. Os canais (in-app agora; push e email depois) são adaptadores atrás de uma
interface. Adicionar SMS mais tarde não toca no código de domínio.

Tipos do MVP: `payment.received` `payment.pending` `payment.failed` `payment.due`
`session.changed` `session.cancelled` `announcement.published`.

## White-label

`Academy { slug, name, logoUrl, signalColor, appIcon }`.

### Uma origem por clube

`fafe.academias.pt` é o Fafe. `cdloureiro.academias.pt` é o CD Loureiro. As duas
são o **mesmo processo** — o domínio não escolhe a aplicação, só diz ao DNS para
onde mandar o pedido; quem escolhe o que responde é o caminho.

| Caminho | O que serve |
| --- | --- |
| `/` | a landing do clube (instalar a app, ou entrar) |
| `/ser-socio` | a adesão a sócio |
| `/convite/:token` · `/familia/:token` | os convites |
| `/consola/*` | a consola (estáticos do build do Vite) |
| `/app/*` | a PWA das famílias |
| `/manifest.webmanifest` | gerado, com a marca do clube |
| `/api/*` | a API |

Duas coisas decidem esta forma, e não são de arrumação:

1. **A instalação de uma PWA é same-origin.** O manifest, o service worker, os
   ícones e a `start_url` têm de estar na mesma origem da página que oferece a
   instalação — e essa página é a landing do clube. Uma app noutro domínio não se
   instala a partir do link que o diretor manda ao pai, que é o único caminho que
   ela tem.
2. **O manifest tem de ser por clube** — nome, cor e ícone da academia. Só o
   servidor os sabe. É o que faz o pai instalar "Academia Fafe" e não o nosso nome.

De lambuja: a consola e a app deixam de ser cross-origin (sem CORS, sem preflight),
e a entrega da sessão da landing para a consola volta a atravessar pelo
armazenamento do browser em vez de ir no fragmento do URL.

Fora desta forma ficam os dois clientes que não pertencem a clube nenhum, ambos no
Vercel: o site (`academias.pt`) e o painel da plataforma (`admin.academias.pt`).
São eles a razão de `api.academias.pt` continuar a existir.

Peças: `tenant/tenant.ts` (o `Host` → slug, com `TENANT_DOMAIN` e a lista de
subdomínios reservados), `tenant/tenant.middleware.ts` (a reescrita da raiz para
`/l/:slug/…`), `tenant/tenant-assets.controller.ts` (o manifest) e `serveApps` em
`main.ts` (os estáticos). O build é `npm run build:server`.

> O middleware está registado com `app.use()` no `main.ts` e **não** em
> `AppModule.configure`: no Express 5 o `forRoutes("*")` do Nest deixou de ser um
> apanha-tudo, e só a raiz era reescrita — em silêncio.

Em runtime a app escreve `--color-signal` no `:root`. Mais nada muda.

A landing page da academia tem de ser renderizada no servidor: os pais recebem o link
por WhatsApp e uma SPA não devolve OG tags. É a única peça de SSR do sistema — um
endpoint no NestJS que devolve HTML, não uma app Next. Implementado em
`apps/api/src/landing/` (`GET /l/:slug`): `landing.template.ts` é uma função pura
(academia + plataforma detectada do User-Agent → HTML), `landing.service.ts` é a
única coisa que sabe de onde vêm os dados da academia.

Em produção o `:slug` vem do subdomínio e não do caminho: `TenantMiddleware`
reescreve `fafe.academias.pt/ser-socio` para `/l/fafe/sersocio` antes de o router
lhe tocar, e nenhum controlador precisou de mudar. Em desenvolvimento o host é
`localhost`, nada é reescrito, e `/l/:slug/…` continua a ser o caminho de sempre.

## Estado actual

Implementado: tokens, primitivas, console do diretor e do treinador, casca da PWA,
landing SSR da academia, esquema Prisma, módulos NestJS com o fluxo de pagamento e
notificações.

As apps web correm com dados de demonstração (`src/data/`) para que o desenho seja
avaliável antes de a API estar ligada. A fronteira está isolada em `src/lib/api.ts` —
trocar mock por HTTP é um ficheiro.
