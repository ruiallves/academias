# O site do clube

`apps/clube-site`. Uma app Next.js para todos os clubes, no Vercel, com o
domínio de cada clube (`www.adfafe.pt`) a apontar para ela. É o terceiro
plano do produto: tudo o que está no Connect, mais um site próprio com
domínio `.pt`, notícias, equipas, calendário, contactos, loja e bilheteira.

**Não há um site por clube.** Há um só, e o que muda de clube para clube são
dados: o emblema, a cor, as fotos, os textos, as notícias, os jogos. Um
clube novo é um domínio e uma linha na base de dados; um deploy actualiza
todos os clubes ao mesmo tempo. Cada excepção no código para um clube é o
primeiro passo para voltar a ter "um site por clube", e não se faz.

## Porquê Next, se `02-arquitetura.md` diz "sem Next"

A regra continua a valer para a consola e para a app da família: são apps
de sessão, ninguém chega lá pelo Google. O site é o contrário: vive do
Google, do WhatsApp e do Facebook, e cada página tem de chegar já desenhada,
com os OG tags certos e em cache. É o caso para que o Next existe, e é por
isso que fica no Vercel e não na API: se a API reiniciar num deploy, o site
de todos os clubes continua no ar com as páginas em cache. Um site de clube
em baixo num dia de jogo vê-se muito.

## Como um pedido chega ao site certo

```
www.adfafe.pt/noticias
  → DNS aponta para o Vercel
  → Vercel sabe que o domínio é do projeto clube-site (adicionado lá) e tem o SSL
  → src/proxy.ts lê o Host, pergunta "de que clube é, e com que layout?" e reescreve para /adfafe/classico/noticias
  → app/[clube]/[layout]/noticias/page.tsx desenha a página com os dados desse clube
```

Não é um redirecionamento: o endereço na barra fica o do clube. Os links
dentro do site são relativos à raiz (`/noticias`), e os dois segmentos são
postos pelo proxy em cada pedido, incluindo os prefetch do router.

## Dois layouts

| `Clube.layout` | Como é | Referência |
| --- | --- | --- |
| `classico` | claro, cabeçalho em dois andares, herói com três notícias | adfafe.pt |
| `porto` | claro, barra lateral fixa com ícones, carrossel a toda a largura, notícias em lista com cartaz ao lado | fcporto.pt |

O layout é uma escolha do clube e viaja no caminho interno
(`/[clube]/[layout]/...`), não num cookie lido pelas páginas: assim cada
página continua em cache, com (clube, layout) por chave. O que muda entre
layouts é a **casca** (`src/layouts/<nome>/Casca.tsx`, ou o
`Cabecalho`/`Rodape` no clássico) e a **página de início**
(`src/layouts/<nome>/Inicio.tsx`). As páginas interiores são partilhadas e
ficam escuras no `porto` pelos tokens (`[data-layout="porto"]` em
`globals.css`), com a cor do clube clareada até se ler sobre o escuro
(`estiloDoClube` em `lib/tema.ts`).

O interruptor de layout na faixa de cima só aparece em demonstração
(`SITE_FONTE=demo`). Com dados reais o layout é o que o clube escolheu no
menu Website, e o cookie `site-layout` é ignorado.

`src/dados/dominios.ts` responde ao "de que clube é?", por ordem:

1. `localhost`, `<slug>.localhost` e `…vercel.app`: desenvolvimento e os
   endereços de cada deploy. Sem subdomínio vale `SITE_DEMO_SLUG`.
2. `<slug>.<SITE_PREVIEW_DOMAIN>` (`ad-fafe.website.academias.pt`): o site de
   um clube sem domínio próprio. Se o clube tiver domínio, redireciona para
   ele (308), para o Google ver um site só.
3. O domínio do clube: pergunta à API (`app.resolve_site_by_domain`), com
   cache em memória de cinco minutos (trinta segundos para um "não há").

Sem resposta, `/sem-clube`. Não se adivinha. O endereço oficial vai no
`canonical` de cada página; os endereços `…vercel.app` levam `noindex`.

## De onde vêm os dados

`src/dados/fonte.ts` tem a interface `Fonte` e duas implementações:

| `SITE_FONTE` | O que faz |
| --- | --- |
| `api` (produção) | pede a `${SITE_API_URL}/public/sites/:slug/...`, com `revalidate: 60` e a etiqueta `clube:<slug>` |
| `demo` | lê `src/dados/demo/monteverde.ts`, um clube inventado, em qualquer endereço |

## A API do site

Migração `20261013120000_site_do_clube`: `Academy.siteDomain` (único) e
`siteDomainRenewsAt`, e as tabelas `SiteConfig` (uma por clube: publicado,
layout, identidade, equipas, recintos), `SiteNews`, `SiteSponsor`,
`SiteProduct` e `SiteMatchTickets`, todas com RLS. Código em
`apps/api/src/site/`.

**Só clubes que publicaram.** Sem `SiteConfig.published`, os endpoints
públicos respondem 404 e o domínio não resolve. Publicar é um interruptor na
Visão geral do menu Website.

**Só clubes no Connect Pro.** Migração `20261013160000_connect_pro`:
`Plan.includesWebsite`, o plano `plan_connect_pro` e a função
`app.academy_has_website(academyId)` (SECURITY DEFINER, porque as tabelas dos
planos estão fechadas ao `academia_app`). Sem o plano (ou com a subscrição
cancelada): o menu Website não aparece na consola (`academy.websiteIncluido`
no arranque, filtrado em `navFor`), `/api/site` responde 403
`SITE_NOT_IN_PLAN`, o público responde 404, o domínio não resolve e o painel
recusa ligar domínio. Mudar o plano no painel liga ou desliga tudo isto.
Código em `apps/api/src/site/plano.ts`.

Públicos (`site-publico.controller.ts`, sem sessão, tecto de 2000 pedidos por
minuto porque os sites de todos os clubes saem dos mesmos servidores do Vercel):

```
GET /public/sites/por-dominio/:host   → { slug, layout, dominio }
GET /public/sites/:slug/resumo        → { slug, layout, dominio }
GET /public/sites/:slug               → Clube
GET /public/sites/:slug/noticias?limit&category      (só publicadas)
GET /public/sites/:slug/noticias/:id
GET /public/sites/:slug/equipas       → época em curso, sem as escondidas; plantel só se o clube o ligou
GET /public/sites/:slug/equipas/:id
GET /public/sites/:slug/jogos         → 90 dias para trás, 180 para a frente, das equipas visíveis, com bilhetes
GET /public/sites/:slug/jogos/:id
GET /public/sites/:slug/eventos       → [] (o calendário ainda não marca eventos públicos)
GET /public/sites/:slug/produtos      (só visíveis)
GET /public/sites/:slug/produtos/:id
```

Treinos nunca saem: dizem onde estão crianças e a que horas.

Consola (`site.controller.ts`, `settings:write`): `GET/PATCH /api/site`,
`POST/PATCH/DELETE /api/site/noticias|produtos|patrocinadores`,
`PUT/DELETE /api/site/bilheteira/:matchId` (só jogos em casa) e
`POST /api/site/imagens` (autoriza o carregamento para o bucket público
`site-publico` e devolve o endereço). Uma imagem só se grava se for do
próprio clube nesse bucket. O que vive em JSON é limpo à escrita e à leitura
(`site.tipos.ts`): links `javascript:` saem, recintos partidos são reparados.

Painel da plataforma (`site-dominio.controller.ts`, `OWNER`/`ADMIN`):
`GET/PUT/DELETE /api/platform/academies/:id/site-dominio`. Ligar acrescenta
o domínio e o `www` (que redireciona) ao projeto do Vercel e grava
`siteDomain`.

A cada escrita, a API avisa o site (`SiteRevalidarService` →
`POST /api/revalidar` no site, com segredo partilhado) e a cache desse clube
cai: a mudança aparece na página seguinte.

`npm run test:site --workspace @academia/api` testa tudo isto contra uma API a
correr (por omissão em :3011), com as contas do Life Club, e deixa o clube
como o encontrou.

### Variáveis

| Onde | Variável | Valor |
| --- | --- | --- |
| Vercel (site) | `SITE_FONTE` | `api` (já no `.env.production`) |
| Vercel (site) | `SITE_API_URL` | `https://api.academias.pt` (já no `.env.production`) |
| Vercel (site) | `SITE_PREVIEW_DOMAIN` | `website.academias.pt` (já no `.env.production`) |
| Vercel (site) | `SITE_REVALIDATE_SECRET` | um segredo longo, **igual** ao da API |
| Railway (API) | `SITE_REVALIDATE_URL` | `https://<projeto-do-site>.vercel.app/api/revalidar` |
| Railway (API) | `SITE_REVALIDATE_SECRET` | o mesmo segredo |
| Railway (API) | `VERCEL_TOKEN` | token da equipa no Vercel (Account Settings → Tokens) |
| Railway (API) | `VERCEL_SITE_PROJECT_ID` | o id do projeto do site (Settings → General) |
| Railway (API) | `VERCEL_TEAM_ID` | o id da equipa (só se o projeto for de uma equipa) |
| Railway (API) | `SITE_PREVIEW_DOMAIN` | `website.academias.pt` (o painel mostra o endereço com ele) |

Sem as duas da revalidação, o site atualiza sozinho ao fim de um minuto. Sem
as do Vercel, "Ligar" grava o domínio no clube e o painel avisa que falta
acrescentá-lo ao projeto à mão.

### O que ainda não existe

- A venda: encomendas, pagamento (euPago, pelo canal do clube), bilhetes com
  QR e o leitor à entrada. O site mostra os bilhetes e a loja, e os botões de
  pagar dizem que ainda não está ativo.
- Faturação: a fatura tem de sair de software certificado pela AT. O clube
  fatura no programa dele. Validar com um contabilista antes de vender.
- Uma caixa de mensagens na consola. O formulário de contactos abre o email
  de quem escreve, já preenchido, para o email do clube.
- Eventos públicos no calendário, direção e instalações na página do clube.
- A permissão própria (`website:*`). Hoje é `settings:write`.

## Correr

```
npm run dev --workspace=@academia/clube-site     # http://localhost:5190
```

`.env.local` tem `SITE_DEMO_SLUG=monteverde`. Para testar outro clube,
`<slug>.localhost:5190`.

## Desenho

- Cabeçalho e rodapé escuros fixos (`night`); a cor do clube acende por cima
  deles, nos botões e nos acentos. Funciona com qualquer cor, incluindo as
  claras.
- A cor vem de `signalVars` em `packages/ui/tokens.ts`, a mesma função da
  consola e da app, escrita num `style` no contentor do clube.
- Uma letra, a Archivo variável, servida por nós. O eixo de largura dá os
  títulos apertados dos cartazes de jogo (`.display`).
- Grelhas sempre com `minmax(0,1fr)`, nunca `1fr`. É a regra de
  `academia-layout-largura`, e aqui também transbordava.
- Entrada ao rolar com um `IntersectionObserver` só (`Revelar.tsx`),
  desligada em `prefers-reduced-motion`.

## Deploy

Um projeto no Vercel, Root Directory `apps/clube-site`, com "Include files
outside root directory" ligado (o `@academia/ui` vem de `packages/`). Os
domínios dos clubes adicionam-se todos a este projeto; o Vercel emite e
renova o SSL. Variáveis: as de `.env.production`.

Por clube: registar o domínio com o **clube como titular** e nós como
contacto técnico; `A` do apex e `CNAME` do `www` para o Vercel; adicionar o
domínio ao projeto; gravar `siteDomain` no clube. Enquanto o domínio não
aponta, o clube vê o site em `<slug>.website.academias.pt`.

### Pré-visualizações em `<slug>.website.academias.pt`

O DNS do `academias.pt` é gerido no **dominios.pt** (SOA em
`dns1.host-redirect.com`), e não no Vercel. O Vercel só emite um certificado
wildcard com o domínio nos nameservers dele, por isso a solução é outra, e é
automática:

1. **Uma vez (feito a 13/10):** no dominios.pt, `*.website` CNAME
   `cname.vercel-dns.com`. Todo o `<slug>.website.academias.pt` chega ao
   Vercel. O `*` do Railway não é tocado: o `*.website` é mais específico.
2. **Por clube, sozinho:** ao publicar no menu Website, a API acrescenta
   `<slug>.website.academias.pt` ao projeto do site no Vercel
   (`SiteDominioService.garantirPreVisualizacao`), e o Vercel emite o
   certificado desse endereço. Abrir a ficha do clube no painel faz o mesmo
   (para clubes publicados antes disto). Precisa de `VERCEL_TOKEN` e
   `VERCEL_SITE_PROJECT_ID` no Railway; sem eles, acrescenta-se à mão em
   Settings → Domains.

O plano Hobby do Vercel limita os domínios por projeto: com muitos clubes, é
preciso o Pro.

Com `SITE_FONTE=demo` qualquer pré-visualização mostra o clube de
demonstração (`dominios.ts`), e os endereços `…vercel.app` também, com
`SITE_DEMO_SLUG`.
