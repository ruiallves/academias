# Bilheteira

A venda de bilhetes para os jogos em casa, no site do clube e na app do sócio,
com o leitor dos seguranças à porta. Faz parte do Connect Pro (site no plano).
Decisões do Rui de 21/10/2026; a lista completa está no fim.

Código: `apps/api/src/bilheteira/` (regras puras em `regras.ts`, provadas por
`npm run test:bilheteira`; a base, por `npm run test:bilheteira-base`). Migração
`20261021120000_bilheteira`, aplicada em produção a 21/10/2026.

## O modelo

| Tabela | O que é |
| --- | --- |
| `SiteMatchTickets` | A venda de um jogo: aberta, recinto, lotação total, nota, os tipos de bilhete (`types`, JSON), e as fases (`membersFrom`, `publicFrom`, `membersOnly`, `closesAt`). |
| `SiteConfig.ticketDefaults` | Os preços por omissão, por recinto. Um jogo novo copia-os. |
| `SiteConfig.venues[].portas` | As portas do recinto: `{ id, nome, bancadaIds }`. |
| `TicketOrder` | Uma compra: comprador, canal (site/app), sócio (se comprou ao preço de sócio), total, `reservedUntil` (10 min), estado, reembolso. `accessToken` abre a página dos bilhetes. |
| `MatchTicket` | Um bilhete por pessoa: tipo, bancada, preço, sócio (bilhete de sócio), estado (`VALID`, `USED`, `VOID`). |
| `SeasonSeat` | O lugar anual de um sócio numa época: recinto, bancada, lugar. Desconta da lotação. |
| `TicketGateAccess` | O acesso de um segurança: link + PIN, por jogo e porta (ou "todas"). |
| `TicketScan` | Cada leitura à porta, aceite ou recusada. |
| `Payment.ticketOrderId` | O pagamento de uma compra, pelo mesmo webhook da euPago do clube. |

Um **tipo de bilhete** é um preço numa bancada para um público:

```ts
{ id, nome, preco /* euros */, bancadaId, para: "publico" | "socios", tierId: string | null }
```

`para: "socios"` com `tierId` nulo é para qualquer sócio; com `tierId`, só para
os sócios dessa categoria (`MemberTier`).

## As regras

- **Fases**: aberta a todos; só sócios (`membersOnly`); sócios a partir de
  `membersFrom`, público a partir de `publicFrom`. Fecha à hora do jogo, ou em
  `closesAt` se for antes. Nunca vende num jogo cancelado ou jogado.
- **Lotação**: por bancada, `lotacao − lugares anuais − bilhetes ocupados`;
  ocupam lugar os bilhetes de compras pagas e de compras guardadas dentro dos
  10 minutos. O total do jogo (`capacity`) também conta. Contado e escrito com a
  linha da venda bloqueada (`SELECT … FOR UPDATE`).
- **Sócio**: no site, número de sócio + data de nascimento; na app, a conta.
  Preço de sócio só com a quota a cobrir o dia do jogo (jogo em setembro com
  quotas até agosto não passa), um bilhete de sócio por sócio por jogo.
  Quota em atraso não compra a preço de sócio (compra como público) e o lugar
  anual é recusado à porta.
- **10 minutos**: os lugares ficam guardados 10 minutos. Pago dentro do prazo,
  há bilhetes. Pago depois, não há bilhetes e fica um reembolso por fazer (à
  mão na primeira versão: o clube devolve por fora e marca na consola).
- **Máximo** 10 bilhetes por compra, e duas compras à espera por email e jogo.
- **QR**: `T.<id do bilhete>.<assinatura>` ou `S.<id do lugar anual>.<assinatura>`
  (HMAC). Não se adivinha, não se copia para outro jogo, não muda de tipo.
- **Portas**: o leitor abre numa porta e só aceita as bancadas dela; "todas"
  aceita tudo. A porta errada diz qual é a certa.

## A API

### Site (público, do browser de quem compra)

Base `{SITE_API_URL}/api/clubes/:slug`. CORS aberto aos sites dos clubes.
Respostas `no-store`. Erros: 400 com `{ message }` em português, para mostrar.

```
GET  /bilhetes/ficha                → { ficha }          (pedir ao abrir a compra; vale após 3 s, uma vez)
GET  /bilhetes/:matchId             → Venda              (404 sem venda)
POST /bilhetes/:matchId/socio       { numero, nascimento: "AAAA-MM-DD" }
                                    → { credencial, venda: Venda (só os tipos dele), jaTemBilheteDeSocio }
POST /bilhetes/:matchId             { linhas: [{ typeId, quantidade }], nome, email, telefone?,
                                      metodo: "MBWAY" | "MULTIBANCO", credencial?, notaExtra, ficha }
                                    → Compra
GET  /bilhetes/pedido/:token        → Pedido
```

```ts
type Venda = {
  jogo: { id; startsAt; opponent; teamName; status };
  estado: { socios: boolean; publico: boolean; fechada: boolean; abreSociosEm: string | null; abrePublicoEm: string | null; soSocios: boolean };
  nota: string | null;
  recinto: { id; nome; tipo; bancadas: Bancada[] } | null;
  tipos: { id; nome; preco; bancadaId; bancada: string | null; para: "publico" | "socios"; tierId; tierNome }[];
  livres: Record<bancadaId, number | null>;   // null = sem limite próprio
  livresNoJogo: number | null;
  reservaMinutos: 10;
};

type Compra = {
  token: string;                              // para /bilhete/<token> e GET /bilhetes/pedido/:token
  estado: "a-pagar" | "pago";                 // "pago" só num total de 0 €
  totalCents: number;                         // com a comissão, se o clube a passa a quem paga
  reservadoAte: string;
  pagamento: { metodo: "MBWAY" | "MULTIBANCO"; entidade: string | null; referencia: string | null; valorCents: number } | null;
};

type Pedido = {
  estado: "a-pagar" | "pago" | "expirado" | "fora-do-prazo" | "anulado";
  comprador: string;
  reservadoAte: string;
  totalCents: number;
  pagamento: { metodo; entidade; referencia; valorCents; estado } | null;   // só em "a-pagar"
  reembolso: { valorCents: number; feito: boolean } | null;
  jogo: { startsAt; opponent; teamName; local } | null;
  bilhetes: { id; tipo; bancada: string | null; porta: string | null; usado: boolean; codigo: string }[];  // só em "pago"
};
```

A lista pública de jogos (`GET /public/sites/:slug/jogos`) traz em `tickets`:
`types[].forMembers`, `types[].tierId`, `membersOnly`, `membersOpen`,
`publicOpen`, `membersFrom`, `publicFrom`. A lotação não: conta-se na compra.

### App do sócio

Cabeçalhos `Authorization: Bearer <jwt>` e `x-academy-slug`.

```
GET  /api/socio/bilhetes                  → (Pedido & { token })[]   (as compras do sócio para jogos que não passaram)
GET  /api/socio/bilhetes/lugar-anual      → { lugares: { id, epoca, recinto, bancada, porta, lugar, quotaEmDia, codigo }[] }
GET  /api/socio/bilhetes/venda/:matchId   → Venda & { quotaEmDia, jaTemBilheteDeSocio }   (404 sem venda)
POST /api/socio/bilhetes/:matchId         { linhas, metodo, telefone? } → Compra
```

O `GET /api/socio/inicio` traz `matches[].bilheteira: boolean` (venda aberta).

### Consola (sessão normal)

```
GET    /api/site                                  … + precosBilheteira: Record<venueId, Tipo[]>, categoriasDeSocio: { id, nome }[]
PUT    /api/site/bilheteira/:matchId              { aberta, recintoId, lotacao?, nota?, tipos, sociosDesde?, publicoDesde?, soSocios?, fechaEm? }
                                                  (tipos vazio num jogo novo → copia os preços por omissão do recinto)
PUT    /api/site/bilheteira-precos                { porRecinto: Record<venueId, Tipo[]> }
GET    /api/bilheteira/jogos/:matchId/vendas      → { venda, anuais, ocupados, porTipo, receitaCents, entradas: Record<gateId, n>, pedidos[] }
POST   /api/bilheteira/jogos/:matchId/cancelar    { motivo }   (fecha a venda, anula tudo, avisa quem comprou)
POST   /api/bilheteira/pedidos/:id/anular         { motivo }
POST   /api/bilheteira/pedidos/:id/reembolsado    { nota? }
POST   /api/bilheteira/pedidos/:id/reenviar
GET    /api/bilheteira/jogos/:matchId/portas      → { portas: { id, nome }[], acessos[] }
POST   /api/bilheteira/jogos/:matchId/portas      { gateId, label? } → { id, link, pin, expiraEm }   (link e PIN só aqui, uma vez)
DELETE /api/bilheteira/portas/:id
GET    /api/bilheteira/lugares-anuais?seasonId&memberId
POST   /api/bilheteira/lugares-anuais             { memberId, seasonId, venueId, bancadaId, seat?, notes? }
DELETE /api/bilheteira/lugares-anuais/:id
```

Permissões: ver é `website:read`, mexer é `website:write`; os lugares anuais
são `member:read` / `member:write`. Tudo só com o site no plano.

### Leitor dos seguranças

O link é `https://<slug>.academias.pt/consola/porta/<token>`: uma rota da
consola que **não pede conta**. Base `/api/clubes/:slug` (mesma origem).

```
POST /porta/entrar   { token, pin }     → { sessao, jogo: { startsAt, nome }, porta: { nome, bancadas: string[] }, entradas }
POST /porta/estado   { sessao }         → { jogo, porta, entradas }
POST /porta/ler      { sessao, codigo } → { resultado, ok, mensagem, bilhete: { tipo, bancada, lugar } | null }
```

`resultado`: `OK`, `ALREADY_USED`, `WRONG_GATE`, `WRONG_MATCH`, `VOID`,
`INVALID`, `QUOTA_EM_ATRASO`. Cinco PINs errados bloqueiam o link 15 minutos.
A sessão vale até 14 horas e nunca para lá do acesso (fim do jogo + 6 h).

## Decisões do Rui (21/10/2026)

- O site só sai quando a bilheteira e a loja estiverem acabadas; as faturas ficam para o fim.
- Preços por bancada × público geral e categorias de sócio, com preços por omissão editáveis por jogo.
- Venda só para sócios, ou sócios primeiro e público depois.
- Sócio identificado por número + data de nascimento no site; também compra na app.
- Quota em atraso: não compra bilhete de sócio, e o lugar anual não entra. Sem opção do clube.
- Lugares anuais descontam da lotação da bancada.
- Lugares guardados 10 minutos; pago depois, reembolso.
- Portas: cada segurança só valida as bancadas da sua porta; um clube pode usar uma porta só.
- Seguranças sem conta: link por jogo e porta + PIN.
- Reembolsos à mão na primeira versão (**por fazer**: devolução automática pela euPago).

## Segurança (revisão de 22/10/2026)

Uma revisão adversarial independente encontrou 14 problemas (3 altos, 5
médios, 6 baixos); estão todos tratados. O que ficou como regra:

- **Sem tectos por endereço** nas rotas da bilheteira (`@SkipThrottle`): o
  endereço que a API vê é o do intermediário, partilhado por todos. A proteção
  vive no serviço: a ficha (presa ao clube, uma vez, 3 s a 30 min) na compra e
  na identificação de sócio; o campo-armadilha; duas compras à espera (ou
  gratuitas) por email e por telemóvel normalizados; 4 pedidos MB WAY por hora
  por telemóvel; no máximo 20% da lotação guardada sem pagar (só no site); a
  fila por jogo; 5 falhas por número de sócio; no leitor, o PIN (contado numa
  só escrita) e 120 leituras por minuto por acesso.
- **Compras não se apagam**: `TicketOrder → SiteMatchTickets` e
  `Payment → TicketOrder` com `ON DELETE RESTRICT`; o calendário recusa
  desmarcar ou apagar um jogo com bilhetes vendidos, e a bilheteira de um jogo
  com compras não se apaga. O caminho é "Cancelar a venda".
- **Confirmação de pagamento**: o `Payment` bloqueia-se antes de ser lido, e o
  jogo antes da compra. Uma compra cujos 10 minutos passaram conta como
  expirada (volta a ver a lotação). Um reembolso na euPago anula os bilhetes.
- **Segredo**: `TICKET_QR_SECRET` (cai no `SUPABASE_JWT_SECRET`). Assina os QR,
  as credenciais de sócio e as sessões do leitor; rodá-lo invalida os bilhetes
  emitidos. Em produção a API não arranca sem nenhum dos dois.

**Por fazer**: um desafio anti-robô a sério (Cloudflare Turnstile) na compra
do site, que precisa das chaves do Rui; a devolução automática pela euPago.
