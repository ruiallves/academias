# Academia

Sistema operativo para academias e escolas desportivas. Multi-desporto,
multi-tenant, white-label.

```
academia-pro/
├─ apps/
│  ├─ console/   React + Vite — diretor e treinador
│  ├─ family/    React + Vite + PWA — pais
│  └─ api/       NestJS + Prisma — monólito modular
├─ packages/
│  └─ ui/        Tokens partilhados pelas duas apps
└─ docs/
   ├─ 00-produto.md       o que é, quem usa, navegação, fases
   ├─ 01-design.md        princípios extraídos das referências + sistema
   ├─ 02-arquitetura.md   stack, multi-tenancy, permissões, pagamentos
   └─ 03-estado.md        o que está implementado, e o que falta
```

## Correr

```bash
npm install
npm run dev:console   # http://localhost:5173
npm run dev:family    # http://localhost:5174
```

As duas apps web correm com dados de demonstração, sem base de dados. A fronteira
está isolada em `apps/console/src/lib/api.ts` — trocar mock por HTTP é um ficheiro.

Na consola, o cartão de utilizador no fundo da barra lateral troca entre **Direção**
e **Equipa técnica**. Não é uma pré-visualização: a navegação, o âmbito dos dados e
as colunas das tabelas são todos derivados das permissões.

Em **Definições → Cor de sinal**, mudar a cor reescreve `--color-signal` e o produto
inteiro segue, ao vivo. O verde de "pago" e o vermelho de "vencido" não mudam — as
cores semânticas nunca são white-label.

## API

```bash
cd apps/api
cp .env.example .env      # preencher Supabase + euPago
npm run prisma:generate
npm run prisma:migrate
npm run start:dev
```

O esquema em `prisma/schema.prisma` é o artefacto de arquitetura mais importante do
repositório. Vale a pena lê-lo antes de escrever código de domínio.

`npm run start:dev` precisa de um Postgres alcançável em `DATABASE_URL` — o Prisma
liga-se a sério no arranque do módulo, não só quando alguém faz uma query. Sem base
de dados o processo não sobe.

## Landing page da academia

`GET /l/:slug` (`apps/api/src/landing/`) é HTML gerado no servidor, não a SPA — o
preview do WhatsApp não corre JavaScript, por isso as OG tags têm de vir já no
HTML. A página é deliberadamente assimétrica: para um pai só existe "instalar a
app" (com instruções para iOS, Android, ou um aviso a pedir para sair do
navegador embutido do WhatsApp/Instagram, consoante o User-Agent); para um
treinador ou diretor existe um link discreto no rodapé para a consola. Não há
formulário de login aqui — a consola trata disso.

Testável sem base de dados nem servidor a correr (`renderLanding` é uma função
pura em `landing.template.ts`); com o servidor a correr, `http://localhost:3000/l/life-club`.

### Testar num telemóvel

Instalar uma PWA exige HTTPS e um *service worker* — que só existe no build de
produção, não em `vite dev`. E a landing e a PWA têm de estar **na mesma origem**,
como vão estar em produção (`{slug}.dominio.pt`).

```bash
cd apps/family && npm run build          # gera dist/ com sw.js e ícones
cd ../api && npx tsc --outDir dist --module commonjs
node scripts/preview-landing.cjs 3000    # landing + PWA num processo só
npx localtunnel --port 3000              # HTTPS público para o telemóvel
```

`scripts/preview-landing.cjs` serve `/l/:slug` (landing SSR) e tudo o resto a
partir de `apps/family/dist`. Um servidor, uma origem, um túnel — o botão de
instalar é uma navegação normal dentro do mesmo sítio.

Os ícones da PWA geram-se com `node apps/family/scripts/generate-icons.mjs`
(quadrado na cor de sinal, sem dependências) — sem eles o Android não considera a
app instalável.

## Estado

Ver [docs/03-estado.md](docs/03-estado.md) — resumo do que está implementado, do
que falta e da dívida conhecida.
