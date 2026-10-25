# Loja do site

A venda online dos produtos da loja do site do clube: carrinho, encomenda,
pagamento pela euPago do clube, entrega por levantamento ou envio, e a gestão
das encomendas na consola. Faz parte do Connect Pro (site no plano). Feita a
24/10/2026 (fase 3 do site, ver `08-site-do-clube.md`).

Código: `apps/api/src/loja/` (regras puras em `regras.ts`, provadas por
`npm run test:loja`; as consultas de stock em `contexto.ts`; a emissão e os
emails em `emissao.service.ts`). Migração `20261024120000_loja`, **aplicada em produção a 24/10/2026**
(aditiva; só ela, com `prisma migrate resolve --applied`: a
`20261020160000_nomes_dos_temas` foi aplicada a seguir, também a 24/10).

## O modelo

| Tabela | O que é |
| --- | --- |
| `SiteProduct.stock` | O stock por tamanho de um produto **sem** artigo do Inventário: `{ "M": 3 }`, ou `{ "": 12 }` sem tamanhos. Um tamanho ausente vende-se sem contagem. |
| `SiteProduct.images` | A galeria, a seguir à capa (`imageUrl`). Até 8. |
| `SiteConfig.shop` | Como o clube entrega: levantamento (local, nota), envio (preço, grátis a partir de, nota) e o aviso da loja. Ver `lojaValida` em `site.tipos.ts`. |
| `SiteOrder` | Uma encomenda: número seguido por clube, quem comprou, entrega e morada, totais, `reservedUntil` (10 min), estado, reembolso, `accessToken` da página. |
| `SiteOrderItem` | Uma linha: produto, tamanho, quantidade, preço de então (fotografado), e a variante do Inventário a que o stock desce. |
| `Payment.siteOrderId` | O pagamento de uma encomenda, pelo mesmo webhook da euPago do clube. O `Payment` tem quatro donos possíveis. |

Estados da encomenda: `RESERVED` (à espera do pagamento) → `PAID` (paga, por
preparar) → `READY` (pronta para levantar) ou `SHIPPED` (enviada) →
`DELIVERED`. À parte: `EXPIRED` (caducou sem pagar), `LATE_PAYMENT` (pago
tarde e já sem stock, reembolso por fazer), `CANCELLED` (anulada pelo clube).

## As regras

- **Só vende com a faturação configurada** (desde 25/10/2026): a loja vende
  com os pagamentos do clube ligados, a faturação marcada no painel da
  plataforma (`Academy.invoicingConfirmedAt`) e uma forma de entrega. Falta
  uma, fica em catálogo. A regra está em `api/src/common/vendas-online.ts`.
- **Vende só com** pagamentos do clube ligados **e** uma forma de entrega
  ligada (`lojaVende`). Sem isso a loja fica em catálogo: os botões do site
  levam aos contactos, como antes.
- **Stock por tamanho.** Com artigo do Inventário, os tamanhos são as
  variantes e o disponível é `total − entregue a atletas`; sem artigo, o que o
  clube escreveu no produto. O que outras encomendas têm guardado (10 minutos)
  desconta-se na leitura (`reservadosPorLinha`). Um tamanho esgotado fica na
  lista do site, riscado.
- **10 minutos**: os artigos ficam guardados à espera do pagamento. Pago
  dentro do prazo, a encomenda confirma-se e o stock desce. **Pago depois**:
  se ainda houver stock para tudo, confirma-se na mesma (uma camisola não é um
  lugar que outro levou); se não houver, fica `LATE_PAYMENT` com o reembolso
  por fazer.
- **O stock desce ao pagar**, não ao reservar. No Inventário, a variante leva
  uma saída (`EXIT`) com "Venda no site · encomenda n.º N" e sem autor (foi o
  site); num produto sem artigo, o número gravado desce. Anular uma encomenda
  paga repõe o stock (uma `ENTRY`). Um reembolso feito na euPago anula a
  encomenda mas **não** repõe o stock (o clube pode ter devolvido o dinheiro
  por outra razão).
- **Máximos**: 10 unidades por linha, 20 por encomenda, 12 linhas.
- **Entrega**: levantamento sem custos; envio ao preço do clube, grátis a
  partir do valor que ele escrever. A morada pede-se só no envio.
- **Sem preço de sócio** na loja: os preços são os mesmos para todos.
- **Reembolsos à mão** na primeira versão, como nos bilhetes: o clube devolve
  por fora e marca na consola.
- **Escrita com a loja bloqueada**: um bloqueio consultivo por clube
  (`pg_advisory_xact_lock`, `bloquearLoja`) dá o número seguido da encomenda e
  impede duas encomendas de venderem a mesma última unidade. Como na
  bilheteira, as encomendas do mesmo clube esperam numa fila em memória antes
  da transação.

## A API

### Site (público, do browser de quem compra)

Base `{SITE_API_URL}/api/clubes/:slug/loja`. CORS aberto aos sites dos
clubes. Respostas `no-store`. Erros: 400 com `{ message }` em português.

```
GET  /ficha                      → { ficha }          (pedir ao abrir; vale após 3 s, 30 min, uma vez, presa ao clube)
POST /carrinho                   { linhas: [{ productId, tamanho?, quantidade }] }
                                 → { vende, entrega, ok, erro, itemsCents, envio, linhas: [{ …, nome, precoCents, disponivel, aVenda }] }
POST /encomendas                 { linhas, nome, email, telefone?, entrega: "PICKUP" | "SHIPPING", morada?, nota?,
                                   metodo: "MBWAY" | "MULTIBANCO", notaExtra, ficha, turnstile }
                                 → { token, numero, estado: "a-pagar" | "paga", totalCents, reservadoAte, pagamento }
GET  /encomendas/:token          → Encomenda
```

```ts
type Encomenda = {
  numero: number;
  estado: "a-pagar" | "paga" | "pronta" | "enviada" | "entregue" | "expirada" | "fora-do-prazo" | "anulada";
  comprador; email; reservadoAte; itemsCents; envioCents; totalCents;
  pagamento: { metodo; entidade; referencia; valorCents; estado } | null;   // só em "a-pagar"
  reembolso: { valorCents; feito } | null;
  entrega: { tipo: "PICKUP"; local; nota } | { tipo: "SHIPPING"; morada: string[]; nota; rastreio };
  nota; linhas: { nome; tamanho; quantidade; unitPriceCents; imageUrl }[];
  datas: { paga; pronta; enviada; entregue };
};
```

A loja pública (`GET /public/sites/:slug`) traz `loja: { compraOnline,
levantamento | null, envio | null, aviso }`; cada produto traz `images`,
`stock` (por tamanho, `null` = sem contagem) e `soldOut`.

### Consola (sessão normal)

```
GET    /api/site                               … + loja, encomendasPorTratar, pagamentosLigados
PATCH  /api/site                               { loja: { levantamento, envio, aviso } }   (em euros)
POST   /api/site/produtos, PATCH /api/site/produtos/:id   … + imagens: string[], stock: Record<tamanho, number>
GET    /api/loja/encomendas                    → Encomenda[]   (sem as que caducaram sem pagar)
POST   /api/loja/encomendas/:id/pronta         (levantamento; email a quem comprou)
POST   /api/loja/encomendas/:id/enviada        { rastreio? }   (envio; email)
POST   /api/loja/encomendas/:id/entregue
POST   /api/loja/encomendas/:id/anular         { motivo }      (repõe o stock; email; reembolso por fazer se estava paga)
POST   /api/loja/encomendas/:id/reembolsado    { nota? }
POST   /api/loja/encomendas/:id/reenviar
```

Permissões: ver é `website:read`, mexer é `website:write`. Tudo só com o site
no plano.

## O site (`apps/clube-site`)

- O carrinho vive no browser (`lib/loja.ts`, `localStorage`
  `loja-carrinho:<slug>`), com o número de artigos no ícone do cabeçalho nos
  dois temas e no menu do telemóvel.
- Produto: galeria (`Galeria.tsx`), tamanho (os esgotados riscados), quantidade,
  "Juntar ao carrinho" e "Comprar agora"; por baixo, como o clube entrega.
- `/loja/carrinho` (`Checkout.tsx`): a lista contra o stock de agora (a API
  junta e conta; o site só desenha), a entrega, os dados, o método, a ficha, o
  campo-armadilha e o Turnstile. Com sucesso esvazia o carrinho e vai para
  `/encomenda/<token>`.
- `/encomenda/<token>` (`PaginaDaEncomenda.tsx`): a contagem e a referência
  (ou o pedido MB WAY) enquanto falta pagar, de 4 em 4 segundos; paga, o
  número, os artigos, a entrega e os passos (paga → pronta/enviada →
  levantada/recebida). `noindex` e `X-Robots-Tag` (proxy).
- Em demonstração (`SITE_FONTE=demo`) a encomenda é fingida no
  `sessionStorage`, como os bilhetes.

## A consola

Website › Loja, em três vistas (`?vista=`): **Produtos** (galeria até 8 fotos,
stock por tamanho num produto sem artigo), **Encomendas** (por preparar,
prontas e enviadas, entregues, reembolsos por fazer, todas; cada uma abre-se
com os artigos, a morada e as ações) e **Entrega** (levantamento, envio e o
aviso, gravados como o resto da configuração). A pastilha do submenu conta as
encomendas pagas por preparar. O clube recebe também um email por encomenda
paga, no endereço da Identidade do site, com o link para a vista das
encomendas.

## Emails

`encomendaEmail` (confirmação, com a tabela dos artigos e a entrega),
`encomendaProntaEmail`, `encomendaEnviadaEmail` (com o código de seguimento),
`encomendaForaDoPrazoEmail`, `encomendaAnuladaEmail`, e `encomendaParaOClubeEmail`.
Todos saem **depois do commit** (ver `academia-push-depois-do-commit`).

## Por fazer / lembrar

- Devolução automática pela euPago (hoje à mão), como na bilheteira.
- Faturação das vendas (InvoiceXpress / Moloni): ver `08-site-do-clube.md`.
- A app do sócio não tem loja; compra-se no site.
- O Resend pago antes de vender a sério (cada encomenda são dois emails).
