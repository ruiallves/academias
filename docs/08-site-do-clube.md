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
  → src/proxy.ts lê o Host, pergunta "de que clube é?" e reescreve para /adfafe/noticias
  → app/[clube]/noticias/page.tsx desenha a página com os dados desse clube, no layout que ele escolheu
```

Não é um redirecionamento: o endereço na barra fica o do clube. Os links
dentro do site são relativos à raiz (`/noticias`), e os dois segmentos são
postos pelo proxy em cada pedido, incluindo os prefetch do router.

## Dois temas

| `Clube.layout` | Nome | Como é |
| --- | --- | --- |
| `tribuna` | Tribuna | claro, cabeçalho em dois andares, herói com três notícias: o site de clube de sempre |
| `holofote` | Holofote | escuro, barra lateral fixa com ícones, carrossel a toda a largura, notícias em lista com cartaz ao lado: o jogo à noite |

Chamavam-se `classico` e `porto` até 20/10/2026; o segundo era o nome de um
clube a sério. A migração `20261020160000_nomes_dos_temas` renomeia o que
está gravado, e aplica-se **depois** do deploy da API e do site de 20/10 (a
API antiga lia "holofote" como "classico"); `layoutValido` (API) e
`layoutNormalizado` (site) aceitam os nomes antigos.

O layout é uma escolha do clube e decide-se **na página** (`layoutAtual` em
`lib/clube.ts`), a partir dos dados do clube (`fonte.clube`, em cache com a
etiqueta `clube:<slug>`, que a consola invalida ao gravar). Já esteve no
caminho interno (`/[clube]/[layout]/...`), decidido pelo proxy com uma cache
em memória de cinco minutos; no Vercel cada instância tem a sua memória, e
depois de o clube trocar de layout a página inicial vinha de uma instância
já atualizada e as notícias de outra ainda com o antigo. O que muda entre
temas é a **casca** (`src/layouts/<nome>/Casca.tsx`, ou o
`Cabecalho`/`Rodape` na Tribuna) e a **página de início**
(`src/layouts/<nome>/Inicio.tsx`). As páginas interiores são partilhadas e
ficam escuras no Holofote pelos tokens (`[data-layout="holofote"]` em
`globals.css`), com a cor do clube clareada até se ler sobre o escuro
(`estiloDoClube` em `lib/tema.ts`).

O interruptor de layout na faixa de cima só aparece em demonstração
(`SITE_FONTE=demo`), e só aí o cookie `site-layout` é lido. Com dados reais
o layout é o que o clube escolheu no menu Website.

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
GET /public/sites/:slug/eventos       → os eventos do calendário com `isPublic` (nunca treinos nem jogos), de ontem a um ano
GET /public/sites/:slug/produtos      (só visíveis; os de artigos arquivados do Inventário saem sozinhos)
GET /public/sites/:slug/produtos/:id
```

O `Clube` traz também `board` e `facilities` (de `identity.direcao` e
`identity.instalacoes`) e `home` (a ordem das secções da página de início e o
banner, de `SiteConfig.home`, sempre com as sete secções).

Do browser do visitante (`site-contacto.controller.ts`, sem sessão, pelo CORS
dos sites dos clubes, 5 por minuto por endereço), o formulário de contactos:

```
GET  /api/clubes/:slug/contacto/ficha → { ficha }   (pedida ao abrir; vale ao fim de 3 s, uma vez)
POST /api/clubes/:slug/contacto       { nome, email, telefone?, assunto, mensagem, notaExtra, ficha }
```

A mensagem fica em `SiteMessage`, vai por email ao endereço da Identidade do
site (`siteMensagemEmail`, com resposta para quem escreveu) e lê-se na
consola. O crivo é o do formulário do academias.pt (`TicketsService`):
campo-armadilha, ficha assinada, repetições, tectos por pessoa e por clube.

Treinos nunca saem: dizem onde estão crianças e a que horas.

Consola (`site.controller.ts`; ler é `website:read`, escrever é
`website:write`): `GET/PATCH /api/site` (o PATCH aceita também `inicio`),
`POST/PATCH/DELETE /api/site/noticias|produtos|patrocinadores`,
`PUT/DELETE /api/site/bilheteira/:matchId` (só jogos em casa),
`GET /api/site/mensagens`, `PATCH /api/site/mensagens/:id` (`lida`,
`tratada`), `DELETE /api/site/mensagens/:id`, e `POST /api/site/imagens`
(autoriza o carregamento para o bucket público `site-publico` e devolve o
endereço). Uma imagem só se grava se for do próprio clube nesse bucket. O que
vive em JSON é limpo à escrita e à leitura (`site.tipos.ts`; `npm run
test:site-tipos` prova-o): links `javascript:` saem, recintos partidos são
reparados, a página de início vem sempre completa.

Inventário → loja do site (`inventory.controller.ts`, `website:write` +
`inventory:read`, só com o site no plano): `PUT /api/inventory/items/:id/site`
`{ preco, categoria?, descricao?, visivel? }` e `DELETE …/site`. A ficha do
artigo (`GET …/items/:id`) traz `site: null` sem o plano, ou
`{ aVenda, produto }`. O produto fica ligado por `SiteProduct.inventoryItemId`
(único, cascata): o nome segue o artigo, a primeira fotografia é copiada para
o `site-publico`, e os tamanhos e o esgotado saem do stock disponível das
variantes na leitura pública.

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

### O roadmap (20/10/2026)

Verificado em produção a 20/10 (ad-fafe.website.academias.pt): as páginas
respondiam, mas não se comprava nada. Os botões de pagar da loja e da
bilheteira só mostravam um aviso; os contactos abriam o email de quem escreve.

**Fase 1: lançar sem vendas (feita a 20/10/2026, migração `20261020150000_site_fase_1`)**
- Contactos a sério: `POST /api/clubes/:slug/contacto` (browser do visitante,
  pelo CORS dos sites dos clubes, com a mesma ficha assinada, campo-armadilha,
  repetições e tectos do formulário do academias.pt, por clube). A mensagem
  fica em `SiteMessage`, vai por email ao endereço da Identidade do site
  (`siteMensagemEmail`, com resposta para quem escreveu) e lê-se em
  Website › Mensagens (lida, tratada, por quem).
- Política de privacidade do site do clube em `/privacidade` (gerada a partir
  dos dados do clube: ele é o responsável, nós subcontratantes) e o DPA 1.1 a
  dizer o mesmo. `sitemap.xml` e `robots.txt` por clube.
- Eventos públicos: `CalendarEvent.isPublic`, ligado evento a evento na consola
  (nunca treinos nem jogos). Direção e instalações dentro de
  `SiteConfig.identity` (`direcao`, `instalacoes`).
- A permissão própria `website:read` / `website:write`, distribuída a quem
  tinha `settings:write`. A direção dá-a a quem trata da comunicação sem lhe
  dar as Definições.
- Página de início configurável: `SiteConfig.home` com a ordem e a
  visibilidade das secções (jogo, notícias, equipas, sócios, loja,
  patrocinadores, uma vez cada, e até quatro banners, cada um com o seu
  conteúdo e `id`). O herói fica sempre no topo. Os dois temas leem a mesma
  ordem. Na consola é um desenho da página (`routes/website/Inicio.tsx`):
  arrasta-se pela pega, o olho esconde, o "+" entre secções põe um banner ou
  repõe uma escondida, e o que está escolhido edita-se à direita. O campo
  `home.banner` é o primeiro banner repetido, para o site de antes de 20/10;
  sai quando o site em produção ler os banners das secções.
- Artigos do Inventário à venda no site: `SiteProduct.inventoryItemId`. O
  clube põe um artigo à venda na ficha dele (painel "Loja do site"); o nome
  vem do artigo, o preço, a categoria e a descrição são do produto, os
  tamanhos e o esgotado saem do stock disponível das variantes na leitura, e a
  primeira fotografia é copiada do bucket privado para o `site-publico`.
  **Só com o site no plano**: a API responde 403 `SITE_NOT_IN_PLAN` e a ficha
  do artigo nem mostra o painel (`item.site === null`) nos outros planos.
- Loja e bilheteira como catálogo: os botões levam aos contactos com o assunto
  certo e dizem que a compra online abre em breve. Connect Pro já estava à
  venda no academias.pt.

**Antes da fase 2: decidir**
- A faturação (ver abaixo) e o plano pago do Resend: o gratuito tem 100
  emails por dia e bateu no limite a 14/10, e cada bilhete e encomenda é um email.

**O site só sai quando a bilheteira e a loja estiverem acabadas** (decisão do
Rui, 21/10). As faturas ficam para o fim.

**Fase 2: bilheteira, decisões de 21/10/2026**
- Preços por bancada × público geral ou categoria de sócio; preços por
  omissão em `SiteConfig.ticketDefaults`, copiados para cada jogo e editáveis.
- Venda por fases (`SiteMatchTickets.membersFrom`, `publicFrom`,
  `membersOnly`, `closesAt`); fecha à hora do jogo.
- Sócio no site: número + data de nascimento; na app, pela conta. Preço de
  sócio só com a quota a cobrir o dia do jogo, um bilhete de sócio por sócio.
  Quota em atraso: não compra a preço de sócio e o lugar anual não entra.
- Lugares anuais (`SeasonSeat`) descontam da lotação vendável da bancada.
- Lugares guardados 10 minutos (`TicketOrder.reservedUntil`); pago depois
  disso, sem bilhete e com reembolso por fazer (à mão na primeira versão).
- Portas no recinto (`venues[].portas`); o leitor abre numa porta e só aceita
  essas bancadas. Seguranças sem conta: link por jogo e porta + PIN
  (`TicketGateAccess`), bloqueio ao fim de 5 tentativas.
- Regras puras em `apps/api/src/bilheteira/regras.ts`, provadas por
  `npm run test:bilheteira`. Migração `20261021120000_bilheteira` (aditiva,
  ainda por aplicar).

**Fase 2: bilheteira (semanas)**
- Encomenda e pagamento MB WAY e Multibanco pelo canal euPago do clube.
- Lotação por bancada, com os lugares guardados enquanto uma referência
  Multibanco está por pagar e libertados quando expira.
- Bilhete com QR por email, leitor à entrada na app de staff (recusa os já usados).
- Vendas por jogo na consola, cancelamentos e reembolsos.

**Fase 3: loja (feita a 24/10/2026, ver `10-loja.md`)**
- Carrinho e encomendas, com o mesmo pagamento da bilheteira (MB WAY e
  Multibanco pela euPago do clube; `Payment.siteOrderId`).
- Stock por tamanho (`SiteProduct.stock` num produto sem artigo; as variantes
  do Inventário num produto com artigo, com a saída registada ao pagar),
  galeria (`SiteProduct.images`), levantamento ou envio (`SiteConfig.shop`),
  encomendas na consola (preparar, enviar, entregar, anular, reembolsar).
- Migração `20261024120000_loja`, aditiva, aplicada em produção a 24/10. A
  faturação continua para o fim.

### Faturação das vendas

- **Quem fatura é o clube**, com o NIF e as séries dele (ATCUD), no programa
  certificado dele. Nós não podemos faturar em nosso nome vendas que são dele.
- **A loja e a bilheteira só se ligam com a faturação ligada**, como os
  pagamentos só ligam com as chaves da euPago. Sem ela, ficam como catálogo.
  **Feito a 25/10/2026, à mão:** enquanto não há ligação por API, marca-se no
  painel da plataforma, na ficha do clube ("Vendas no site e faturação"), o
  programa que ele usa (`Academy.invoicingSystem`, `invoicingConfirmedAt`).
  A regra vive em `api/src/common/vendas-online.ts`; a ligação por API, quando
  existir, preenche os mesmos dois campos.
- **Ligação por API à conta do clube**, a cada venda paga: emite a
  fatura-recibo, buscamos o PDF e enviamo-lo no mesmo email do bilhete ou da
  encomenda. Se o programa estiver em baixo, a fatura fica numa fila.
  - InvoiceXpress: nome da conta + chave da API, que o clube copia (como a
    euPago). Cria faturas, faturas simplificadas e faturas-recibo, muda o
    estado e envia por email.
  - Moloni: OAuth 2.0. Registamo-nos uma vez como programadores (sem plano
    pago); o clube autoriza com a conta dele na página da Moloni. Acesso de
    1 hora, renovação válida 14 dias: renovar sempre antes de caducar.
  - Sage One (PT): só a API v2, que a Sage diz estar "ainda disponível para
    alguns utilizadores" e já não é a recomendada. Cria faturas (FT) e anula,
    mas a documentação não tem fatura-recibo, nem registo do pagamento, nem
    PDF, nem envio por email, nem ATCUD. Pedidos assinados (OAuth 1.0a) além
    do OAuth 2.0. Não serve para a venda online sem a Sage confirmar o contrário.
- Quem usa outro programa: ou liga um destes para as vendas do site, ou não
  vende pelo site.
- Confirmar com um contabilista o tipo de documento e o IVA de cada venda.

### O dinheiro

Nunca passa por nós: quem compra paga, o dinheiro vai para a conta euPago do
clube. Três faturas, de três origens: o clube a quem comprou (a venda,
automática), a euPago ao clube (as taxas), nós ao clube (o Connect Pro e, se
um dia houver, a comissão por venda, faturada ao mês).

## Ser sócio

Os botões "Ser sócio" e "Sócios" do site abrem a adesão numa janela por
cima da página (`componentes/socio/`), e não a página `/ser-socio` da API.
É a mesma adesão: os mesmos ecrãs, validações e pedido
(`POST /api/clubes/:slug/socios`), que fica pendente e aparece no painel do
clube em Sócios. O texto e as categorias vêm de
`GET /public/sites/:slug/socios` (o que o clube escreveu para a página de
adesão, ou o de omissão).

- O pedido sai do browser para a API, não do servidor do site: assim cada
  visitante conta para o tecto de 5 por minuto à parte. O CORS deixa os sites
  dos clubes (`*.website.academias.pt` e os domínios próprios com site
  publicado) chegar só a `/api/clubes/...`, sem credenciais
  (`site/origem-do-site.ts`, `main.ts`).
- Os botões são links para `/ser-socio`, uma página do site com o mesmo
  fluxo: é para lá que vão os links partilhados e quem abre noutro separador.
- A janela deixa o resto da página `inert`; Esc, "Fechar" e o voltar do
  browser fecham-na e o foco volta ao botão. O que se escreveu fica até se
  enviar.
- Em demonstração o envio é fingido (o clube inventado não existe na API).

## Páginas legais (25/10/2026)

Com a loja e a bilheteira a vender, o site de um clube é comércio eletrónico.
O site escreve três páginas com os dados do clube, sem o clube ter de
redigir nada:

- `/privacidade`: o que cada formulário recolhe, os prazos, quem trata por
  conta do clube, os direitos, e `#cookies` (a política de cookies).
- `/condicoes-de-venda`: quem vende, pagamento e reserva de 10 minutos,
  entrega (com o que está em `SiteConfig.shop`), bilhetes sem livre
  resolução (art. 17.º do DL 24/2014), devolução em 14 dias com o modelo,
  garantia (DL 84/2021), Livro de Reclamações e centro de arbitragem (Lei
  144/2015). O rodapé só a mostra com `legal.vendeOnline`.
- `/termos-do-socio`: o que se aceita na adesão. Remete para os estatutos.

O que só o clube sabe fica em `SiteConfig.identity.legal` (sem migração):
nome legal, NIPC (só se grava se passar na conta de controlo), centro de
arbitragem, estatutos e as notas do clube. Ver `api/src/site/site-legal.ts`;
a consola edita-o em Website › Informação legal. A API manda ao site o
centro já resolvido: o escolhido, ou o sugerido pela cidade (`entidadeSugerida`),
ou o CNIACC, que é nacional e supletivo. A lista dos centros é a do gov.pt
(consultada a 25/10/2026); a consola tem uma cópia em
`routes/website/entidades-ral.ts`.

**O que estas páginas dizem tem de bater com o que o site faz.** Um script
de fora, um cookie ou um formulário novo muda também a privacidade. Hoje o
site não põe cookies; o carrinho fica no `localStorage`; o mapa do Google só
abre ao clicar (`contactos/Mapa.tsx`), por isso não há aviso de cookies. A
ligação à plataforma europeia de litígios em linha não está lá de propósito:
deixou de ser exigida a 20/07/2025.

## Fotografias

O clube escolhe, no menu Website, a fotografia do clube (Identidade: bloco de
sócios e "Área do sócio") e uma fotografia por equipa (Equipas). Ficam em
`SiteConfig.identity.foto` e `SiteConfig.teams[id].foto`, e a API só aceita
imagens do próprio clube no bucket do site, como nas notícias.

Enquanto não escolhe, o site usa as **fotografias de omissão** de
`apps/clube-site/public/padrao/` (`lib/fotos.ts`): uma por modalidade
(futebol, futsal e basquetebol com três variantes, para várias equipas da
mesma modalidade não repetirem a imagem), uma genérica para as outras e uma
de bancada para o clube. São aplicadas em `dados/fonte.ts`, à saída dos
dados, para todas as páginas mostrarem a mesma. As fontes e licenças estão em
`public/padrao/FONTES.md`.

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
`dns1.host-redirect.com`), e não no Vercel. Para o Vercel emitir o
certificado wildcard sem gerir o domínio inteiro, ficou assim (feito a
13–14/10, uma vez para todos os clubes):

1. No dominios.pt, `*.website` CNAME `cname.vercel-dns.com`: todo o
   `<slug>.website.academias.pt` chega ao Vercel. O `*` do Railway não é
   tocado (o `*.website` é mais específico).
2. No dominios.pt, pedido ao suporte (o painel não tem NS):
   `_acme-challenge.website` NS `ns1.vercel-dns.com` e `ns2.vercel-dns.com`.
   É por aqui que o Vercel prova o domínio e renova o certificado.
3. No projeto do site no Vercel, o domínio `*.website.academias.pt`.

Um clube novo não precisa de nada disto: publica no menu Website e o
endereço funciona. Não se acrescentam endereços por clube ao Vercel.

Com `SITE_FONTE=demo` qualquer pré-visualização mostra o clube de
demonstração (`dominios.ts`), e os endereços `…vercel.app` também, com
`SITE_DEMO_SLUG`.
