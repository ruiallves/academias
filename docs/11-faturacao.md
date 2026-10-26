# A faturação por API

Cada pagamento online a um clube (mensalidade, cobrança avulsa, quota de
sócio, bilhete, encomenda da loja do site) gera uma fatura no programa de
faturação certificado **do clube**, e o PDF segue por email a quem pagou.
Quem fatura é o clube, com o NIF e as séries dele: nós só carregamos no
botão. Feito a 26/10/2026.

## Os programas

| Programa | Como o clube liga | O que precisa | Documento |
|---|---|---|---|
| InvoiceXpress | Nome da conta + chave da API (app.invoicexpress.com/users/api) | Série registada na AT (ATCUD) | Fatura-recibo |
| Moloni | Autoriza na página da Moloni (OAuth) | Plano Flex ou Pro; escolher a empresa, a série e o método de pagamento | Fatura-recibo |
| Sage One (PT) | Autoriza na página da Sage (OAuth) | Plano Standard (o Básico dá 5 documentos/mês); conta bancária e tipo de pagamento do recibo | Fatura + recibo (não há fatura-recibo) |
| PHC GO | Endereço da instalação + utilizador + palavra-passe; antes, regista a nossa aplicação em "Aplicações externas licenciadas" | Pacote de pedidos da API (12 por fatura); série de fatura-recibo | Fatura-recibo |
| Vendus (Cegid) | Chave da API de um utilizador (Configuração › Utilizadores › API) | Plano Flex ou Pro; uma caixa (registo) e o método de pagamento | Fatura-recibo |

Fora, sem forma automática a partir da nuvem: **PHC CS / PHC Evolution** e
**Primavera V10 / Evolution** vivem no servidor do clube e não têm API a que
se chegue daqui; a Cegid manda hoje os pequenos para a Vendus, e o Jasmin
deixou de se vender em 2025. Um clube nesses programas, ou continua a faturar
à mão, ou liga um dos cinco para as vendas online.

Em todos, **o email sai por nós** (o Resend), com o PDF em anexo e o nome do
clube no remetente, com resposta para o email da Identidade do site. Assim
fica igual para todos os programas, e um programa que não envie emails (a
Sage) não é diferente dos outros.

## Onde vive

`apps/api/src/faturacao/`:

- `tipos.ts`: o documento a faturar (`DocumentoAFaturar`), as regras fiscais
  por tipo de venda, a interface `Conector` e `ErroDeFaturacao` (com
  `definitivo`, que decide se a fila repete).
- `documento.ts`: puro. O NIF (mod 11), as regras lidas de JSON, e
  `montarDocumento`, que aplica a regra do clube a cada linha, junta a
  comissão da euPago (quando quem paga a suporta) e **recusa se as linhas não
  somarem o pago**.
- `cofre.ts`: AES-256-GCM com `INVOICING_SECRET`; cifra as credenciais e
  assina o `state` do OAuth.
- um conector por programa: `invoicexpress.ts`, `moloni.ts`, `sage-one.ts`,
  `phc-go.ts`, `vendus.ts`. Sem estado; tudo vem por argumento.
- `faturacao.service.ts`: a ligação do clube, a fila, a emissão, o email.
- `faturacao.controller.ts`: `api/faturacao` (consola e apps) e o callback
  OAuth, público.

Base: `InvoicingAccount` (uma por clube: programa, credenciais cifradas,
`settings` com as escolhas, `taxRules`, `readyAt`) e `Invoice` (uma por
pagamento, `@unique` em `paymentId`). Migração `20261025180000_faturacao_por_api`
(aditiva; aplicada em produção a 26/10/2026, antes do deploy). `Academy.invoicingSystem` e
`invoicingConfirmedAt` continuam a ser o que a bilheteira e a loja leem para
vender: a ligação preenche-os ao ficar pronta e limpa-os ao desligar. O painel
da plataforma mostra "ligada pelo clube por API" e deixa de marcar à mão.

## O caminho de um pagamento

1. O webhook dá o pagamento por pago (`BillingService.confirmPayment`). Na
   mesma transação, `FaturacaoService.registar` lê o que ele liquida, monta
   o documento e grava a `Invoice` em `PENDING`. Se a transação se desfizer,
   a fatura vai com ela.
2. Depois do commit, `processar` emite no programa, vai buscar o PDF e manda o
   email. HTTP nunca entra num `runAs`.
3. A fila (`varrer`, de 5 em 5 minutos, `INVOICING_SWEEP_INTERVAL_MIN`)
   renova os tokens OAuth e apanha o que ficou por tratar, com o intervalo a
   crescer (1 min, 5, 15, 1 h, 4 h, 12 h). Um erro definitivo (chave
   recusada, série sem ATCUD, total diferente do pago) põe a fatura em
   `FAILED` e fica na conta do clube (`lastError`), para a consola mostrar.
4. Antes de criar, pergunta-se ao programa se já lá está um documento com a
   nossa referência (`procurar`): um servidor que caia entre o "criar" e o
   "gravar" não emite duas vezes. Quem trata uma fatura reclama-a primeiro
   (`nextAttemptAt` no futuro), para a fila e o "emitir já" não a apanharem
   ao mesmo tempo. As chamadas são uma de cada vez por clube.
5. Um reembolso na euPago anula a fatura (ou passa a nota de crédito, onde o
   programa não deixa anular).

Pagamentos **marcados à mão** na consola (numerário, transferência) não
geram fatura: o clube passa-a no programa dele, como sempre fez.

## A quem se fatura

- Mensalidade e cobrança avulsa: o encarregado que pagou (pelo nome, senão o
  primeiro), com os dados que guardou na app em Perfil › Dados para faturas
  (`Membership.invoiceDetails`: nome na fatura, NIF, morada). Sem nada, vai
  em nome dele, sem NIF (consumidor final).
- Quota de sócio: o sócio, com o NIF e a morada da ficha. Paga pela família
  (sócio menor), o encarregado que pagou.
- Bilhete e encomenda: quem comprou, com o NIF que deu no formulário
  (`buyerTaxId`, opcional).

Um NIF inválido vale menos do que nenhum: sai como consumidor final.

## As regras de IVA

Por tipo de venda (mensalidades, cobranças avulsas, quotas, bilhetes, loja,
portes, comissão do pagamento): uma taxa (0, 6, 13, 23 %) ou isento com
motivo (M07, M10, …). O ponto de partida é isento M07 em tudo menos na loja,
nos portes e na comissão (23 %). **O clube confirma-as nas Definições** antes
de sair a primeira fatura: é uma decisão do contabilista dele, não nossa. Os
preços são o que a pessoa pagou; os programas que faturam a partir do
líquido recebem `liquidoDeBruto` (4 casas) e a emissão confere o total.

## O ambiente

- `INVOICING_SECRET`: 16 caracteres no mínimo; sem ele a faturação fica
  desligada no servidor. **Mudá-lo torna as credenciais guardadas ilegíveis**:
  os clubes têm de voltar a ligar.
- `MOLONI_CLIENT_ID` / `MOLONI_CLIENT_SECRET`: a nossa aplicação na Moloni
  (Definições › Programadores, gratuito), com o callback
  `<PUBLIC_API_URL>/api/faturacao/callback/moloni`.
- `SAGE_CLIENT_ID` / `SAGE_CLIENT_SECRET`: a nossa aplicação "Academias" em
  developerselfservice.sageone.com (criada a 26/10/2026), callback
  `.../callback/sage_one`. `SAGE_SIGNING_SECRET` é opcional: o portal novo
  só dá as duas chaves, e a Sage diz que a assinatura deixou de ser
  verificada nas versões novas da API; sem ele assina-se com a chave vazia,
  e se a Sage ainda a exigir em PT a ligação é recusada (401) e vê-se na
  consola. Nesse caso, pedir o segredo a sageonedevelopers@sage.com.
- `PHC_GO_APP_ID`: o nosso AppID de programador PHC GO (DevGO).
- `INVOICING_SWEEP_INTERVAL_MIN`: a fila (5; 0 desliga).

Sem as chaves de um programa, ele aparece nas Definições como "Ainda não
disponível".

## Testar

`npm run test:faturacao` (88): as regras puras, o cofre, e os cinco
conectores contra um `fetch` de mentira que responde o que cada programa
responde e guarda o que lhe mandámos. Prova a forma dos pedidos e o
tratamento dos erros; não prova que os programas aceitam o que mandamos. Isso
só com uma conta de cada um, e é o que falta: a InvoiceXpress e a Moloni têm
contas de teste; a Sage One, o PHC GO e a Vendus pedem uma conta a sério ou
do clube (o Fundão, na Sage).

## O que fica por confirmar com cada programa

- InvoiceXpress: se `sequence_id` leva o id da série ou o
  `current_invoice_receipt_sequence_id`; a precisão do `unit_price`.
- Moloni: se o link de `getPDFLink` se descarrega do servidor (há o
  caminho do plugin oficial como segunda tentativa); se `documents/documentCancel`
  é o nome certo.
- Sage One: o nome do parâmetro do motivo de isenção (vão `vat_exemption_reason_id`
  e `vat_exemption_reason`); se o PDF traz ATCUD e QR; se a API v2 aceita
  aplicações novas em PT ("ainda disponível para alguns utilizadores").
- PHC GO: se uma referência desconhecida numa linha cria o artigo
  (`preparar` tenta `createProduct` por via das dúvidas); a validade do link
  do PDF; o nome do campo das observações na procura (`obs`).
- Vendus: se `client` sem `fiscal_id` é aceite com nome; a forma de
  `reference_document` na nota de crédito.
