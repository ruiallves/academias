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
| `porto` | escuro, barra lateral fixa com ícones, carrossel a toda a largura, notícias em lista com cartaz ao lado | fcporto.pt |

O layout é uma escolha do clube e viaja no caminho interno
(`/[clube]/[layout]/...`), não num cookie lido pelas páginas: assim cada
página continua em cache, com (clube, layout) por chave. O que muda entre
layouts é a **casca** (`src/layouts/<nome>/Casca.tsx`, ou o
`Cabecalho`/`Rodape` no clássico) e a **página de início**
(`src/layouts/<nome>/Inicio.tsx`). As páginas interiores são partilhadas e
ficam escuras no `porto` pelos tokens (`[data-layout="porto"]` em
`globals.css`), com a cor do clube clareada até se ler sobre o escuro
(`estiloDoClube` em `lib/tema.ts`).

Para pré-visualizar, o interruptor na faixa de cima (ao lado da Bilheteira)
grava o cookie `site-layout` e o proxy sobrepõe a escolha do clube. É uma
ferramenta de montagem; quando o clube escolher na consola, sai do site.

`src/dados/dominios.ts` responde ao "de que clube é?", por ordem:

1. `localhost` e `<slug>.localhost`: desenvolvimento. Sem subdomínio vale
   `SITE_DEMO_SLUG`.
2. `<slug>.<SITE_PREVIEW_DOMAIN>` (`monteverde.sites.academias.pt`): a
   pré-visualização de um clube antes de o domínio dele apontar para aqui.
3. O domínio do clube: com `SITE_FONTE=api`, pela API, com cache em memória
   de cinco minutos.

Sem resposta, `/sem-clube`. Não se adivinha.

## De onde vêm os dados

`src/dados/fonte.ts` tem a interface `Fonte` e duas implementações:

| `SITE_FONTE` | O que faz |
| --- | --- |
| `demo` (omissão) | lê `src/dados/demo/monteverde.ts`, um clube inventado. É o que corre hoje |
| `api` | pede a `${SITE_API_URL}/public/sites/:slug/...`, com `revalidate: 60` e a etiqueta `clube:<slug>` |

As páginas só conhecem a `Fonte`. Os tipos (`tipos.ts`) seguem os nomes do
esquema da API (`signalColor`, `opponent`, `isHome`, `maxAge`) para a troca
ser passar o JSON e não traduzir modelos.

### Os endpoints públicos que faltam na API

Tudo só de leitura, sem sessão, e só com o que o clube marcou como público.
Treinos nunca: dizem onde estão crianças e a que horas.

```
GET /public/sites/por-dominio/:host        → { slug }
GET /public/sites/:slug                    → Clube (identidade, morada, redes, direção, instalações, patrocinadores)
GET /public/sites/:slug/noticias?limit&category
GET /public/sites/:slug/noticias/:slug
GET /public/sites/:slug/equipas            → só staff; plantel só se publicado, menores só com consentimento
GET /public/sites/:slug/equipas/:slug
GET /public/sites/:slug/jogos              → Match de todas as equipas, com tickets quando há bilheteira
GET /public/sites/:slug/jogos/:id
GET /public/sites/:slug/eventos            → CalendarEvent marcados como públicos
GET /public/sites/:slug/produtos           → InventoryItem + InventoryVariant marcados para a loja
GET /public/sites/:slug/produtos/:slug
```

Ao publicar na consola, a API chama o site para invalidar a etiqueta do
clube (`revalidateTag("clube:<slug>")`) e a alteração aparece em segundos.

### O que ainda não existe

- Modelos: `NewsPost` (a `Announcement` é interna e por público), o domínio
  do clube em `Academy` (`siteDomain`), o consentimento de imagem por
  atleta, os bilhetes (`MatchTicket`: `Ticket` já é o suporte) e as
  encomendas da loja.
- Pagamento de bilhetes e da loja: pela euPago, pelo canal do clube, como as
  mensalidades. Os botões no site dizem hoje que ainda não está ligado.
- Faturação: a fatura tem de sair de software certificado pela AT. O clube
  fatura no programa dele; nós damos a lista de vendas. Validar com um
  contabilista antes de vender.
- O formulário de contactos cria um `Ticket` na consola do clube, como o do
  site academias.pt faz para a plataforma.
- O menu **Site** na consola, para o clube editar tudo isto.

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
aponta, o clube vê o site em `<slug>.sites.academias.pt`.
