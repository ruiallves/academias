/**
 * A faturação por API, sem base nem rede.
 *
 * Três camadas:
 *  - as regras puras (`documento.ts`): o NIF, as regras de IVA, a soma das
 *    linhas contra o pago;
 *  - o cofre (`cofre.ts`): cifra, decifra, recusa o que foi mexido, assina
 *    e verifica o `state` do OAuth;
 *  - os cinco conectores, contra um `fetch` de mentira que responde o que
 *    cada programa responderia e guarda o que lhe mandámos. Prova a forma
 *    dos pedidos (as taxas, o motivo de isenção, a referência, o fecho) e o
 *    tratamento dos erros, que é o que parte em silêncio.
 *
 * Uso: npm run test:faturacao
 */
import { Cofre } from "../src/faturacao/cofre";
import { dadosDeFaturacao, montarDocumento, nifOuNada, nifValido, regrasCompletas, regrasFiscais } from "../src/faturacao/documento";
import { InvoiceXpress, codigoDoCliente } from "../src/faturacao/invoicexpress";
import { Moloni } from "../src/faturacao/moloni";
import { SageOne, assinar, codificar } from "../src/faturacao/sage-one";
import { PhcGo } from "../src/faturacao/phc-go";
import { Vendus } from "../src/faturacao/vendus";
import { ErroDeFaturacao, liquidoDeBruto, type DocumentoAFaturar, type RegrasFiscais } from "../src/faturacao/tipos";

let ok = 0;
let falhas = 0;
const check = (rotulo: string, cond: boolean, detalhe = "") => {
  if (cond) {
    ok++;
    console.log(`  OK   ${rotulo}`);
  } else {
    falhas++;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
};

async function erroDe(p: Promise<unknown>): Promise<ErroDeFaturacao | Error | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e as Error;
  }
}

/* -------------------------------------------------------------------------- */
/* O servidor de mentira                                                       */
/* -------------------------------------------------------------------------- */

type Pedido = { url: string; metodo: string; headers: Record<string, string>; corpo: string; json: unknown };
type Resposta = { status?: number; json?: unknown; texto?: string; pdf?: boolean };
type Rota = (p: Pedido, vez: number) => Resposta;

const pedidos: Pedido[] = [];
const rotas: { quando: (p: Pedido) => boolean; responder: Rota; vezes: number }[] = [];

function rota(quando: (p: Pedido) => boolean, responder: Rota) {
  rotas.push({ quando, responder, vezes: 0 });
}
function limpar() {
  pedidos.length = 0;
  rotas.length = 0;
}
const ultimo = (filtro: (p: Pedido) => boolean) => [...pedidos].reverse().find(filtro);

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.toString() : entrada.url;
  const headers: Record<string, string> = {};
  const h = init?.headers;
  if (h) for (const [k, v] of Object.entries(h as Record<string, string>)) headers[k.toLowerCase()] = v;
  const corpo = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";
  let json: unknown = null;
  try {
    json = corpo && headers["content-type"]?.includes("json") ? JSON.parse(corpo) : null;
  } catch {
    json = null;
  }
  const p: Pedido = { url, metodo: (init?.method ?? "GET").toUpperCase(), headers, corpo, json };
  pedidos.push(p);
  const r = rotas.find((x) => x.quando(p));
  if (!r) return new Response(JSON.stringify({ erro: `sem rota para ${p.metodo} ${url}` }), { status: 599, headers: { "content-type": "application/json" } });
  const resp = r.responder(p, r.vezes++);
  if (resp.pdf) return new Response(Buffer.from("%PDF-1.4 teste " + "x".repeat(200)), { status: resp.status ?? 200, headers: { "content-type": "application/pdf" } });
  const texto = resp.texto ?? (resp.json !== undefined ? JSON.stringify(resp.json) : "");
  return new Response(texto, { status: resp.status ?? 200, headers: { "content-type": "application/json" } });
}) as typeof fetch;

/* -------------------------------------------------------------------------- */

const regras: RegrasFiscais = { confirmadas: true, porTipo: { MENSALIDADE: { iva: 0, isencao: "M07" }, LOJA: { iva: 23 }, TAXA: { iva: 23 } } };

const docMensalidade = (): DocumentoAFaturar =>
  montarDocumento({
    cliente: { nome: "Maria Silva", email: "maria@exemplo.pt", nif: "123456789", morada: null, codigoPostal: null, localidade: null },
    itens: [{ tipo: "MENSALIDADE", descricao: "Mensalidade de Outubro de 2026 · João Silva", quantidade: 1, unitarioCents: 2500 }],
    surchargeCents: 0,
    totalCents: 2500,
    regras,
    referencia: "AC-MENS-2026-10-JOAO-MARIA-abc123",
    pagoEm: new Date("2026-10-25T10:31:00Z"),
    metodo: "MB WAY",
    resumo: "a mensalidade de Outubro de 2026 de João Silva",
  });

function testarRegras() {
  console.log("=== Regras puras ===");
  check("NIF válido", nifValido("123456789"));
  check("NIF do consumidor final é válido", nifValido("999999990"));
  check("NIF com dígito de controlo errado", !nifValido("123456780"));
  check("NIF curto", !nifValido("12345678"));
  check("NIF a começar por 0 ou 4", !nifValido("012345678") && !nifValido("412345678"));
  check("nifOuNada limpa espaços", nifOuNada(" 123 456 789 ") === "123456789");
  check("nifOuNada devolve nulo ao inválido", nifOuNada("111") === null);

  check("liquidoDeBruto a 0 % é o próprio", liquidoDeBruto(2500, 0) === 25);
  check("liquidoDeBruto a 23 % com 4 casas", liquidoDeBruto(2500, 23) === 20.3252);
  check("liquidoDeBruto × 1,23 arredonda ao pago", Math.round(liquidoDeBruto(2500, 23) * 1.23 * 100) === 2500);

  const d = docMensalidade();
  check("documento com uma linha isenta M07", d.linhas.length === 1 && d.linhas[0]!.regra.iva === 0 && d.linhas[0]!.regra.isencao === "M07");
  const comTaxa = montarDocumento({ ...d, itens: [{ tipo: "LOJA", descricao: "Cachecol", quantidade: 2, unitarioCents: 1000 }], surchargeCents: 63, totalCents: 2063, regras, pagoEm: new Date(), metodo: "Multibanco", resumo: "x" });
  check("a comissão vira uma linha a 23 %", comTaxa.linhas.length === 2 && comTaxa.linhas[1]!.tipo === "TAXA" && comTaxa.linhas[1]!.regra.iva === 23);
  check("linhas da loja a 23 %", comTaxa.linhas[0]!.regra.iva === 23 && comTaxa.linhas[0]!.quantidade === 2);
  let rebentou = false;
  try {
    montarDocumento({ ...d, itens: [{ tipo: "QUOTA", descricao: "x", quantidade: 1, unitarioCents: 1000 }], surchargeCents: 0, totalCents: 2500, regras, pagoEm: new Date(), metodo: "x", resumo: "x" });
  } catch {
    rebentou = true;
  }
  check("linhas que não somam o pago: recusa", rebentou);
  check("tipo sem regra do clube usa a sugerida (QUOTA → M07)", montarDocumento({ ...d, itens: [{ tipo: "QUOTA", descricao: "x", quantidade: 1, unitarioCents: 2500 }], surchargeCents: 0, totalCents: 2500, regras, pagoEm: new Date(), metodo: "x", resumo: "x" }).linhas[0]!.regra.isencao === "M07");

  const lidas = regrasFiscais({ confirmadas: true, porTipo: { LOJA: { iva: 23 }, QUOTA: { iva: 0, isencao: "M10" }, BILHETE: { iva: 99 }, ENVIO: { iva: 0, isencao: "lixo" } } });
  check("regrasFiscais ignora IVA inválido e motivo mal formado", !lidas.porTipo.BILHETE && lidas.porTipo.ENVIO?.iva === 0 && !lidas.porTipo.ENVIO?.isencao && lidas.porTipo.QUOTA?.isencao === "M10");
  check("regrasCompletas recusa 0 % sem motivo", !regrasCompletas(lidas));
  check("regrasCompletas aceita as sugeridas", regrasCompletas({ confirmadas: true, porTipo: {} }));
  check("regrasFiscais de lixo", regrasFiscais("x").confirmadas === false);

  const dados = dadosDeFaturacao({ nome: "  Empresa X ", nif: "123456789", morada: 5, codigoPostal: "1000-100" });
  check("dadosDeFaturacao limpa e valida", dados.nome === "Empresa X" && dados.nif === "123456789" && dados.morada === null && dados.codigoPostal === "1000-100");

  check("código do cliente: o NIF quando há", codigoDoCliente({ nif: "123456789", email: "a@b.pt", nome: "A" }) === "123456789");
  const c1 = codigoDoCliente({ nif: null, email: "A@B.pt", nome: "A" });
  check("código do cliente: estável pelo email, sem distinguir maiúsculas", c1 === codigoDoCliente({ nif: null, email: "a@b.pt", nome: "Outro" }) && c1.startsWith("AC-"));
}

function testarCofre() {
  console.log("=== Cofre ===");
  const cofre = new Cofre("uma frase comprida que serve de segredo");
  check("pronto com segredo", cofre.pronto);
  check("sem segredo não está pronto", !new Cofre("").pronto && !new Cofre("curto").pronto);
  const guardado = cofre.cifrar('{"apiKey":"segredo-do-clube"}');
  check("cifrado não contém o texto", !guardado.includes("segredo-do-clube") && guardado.startsWith("v1."));
  check("decifra", cofre.decifrar(guardado) === '{"apiKey":"segredo-do-clube"}');
  check("dois cifrados do mesmo texto são diferentes (nonce)", cofre.cifrar("x") !== cofre.cifrar("x"));
  const mexido = guardado.slice(0, -3) + (guardado.endsWith("A") ? "BBB" : "AAA");
  let recusou = false;
  try {
    cofre.decifrar(mexido);
  } catch {
    recusou = true;
  }
  check("recusa o que foi mexido", recusou);
  let outro = false;
  try {
    new Cofre("outro segredo qualquer, também comprido").decifrar(guardado);
  } catch {
    outro = true;
  }
  check("recusa com outro segredo", outro);

  const state = cofre.assinar({ a: "clube1", p: "MOLONI" }, 60_000);
  const lido = cofre.verificar(state);
  check("state assinado volta inteiro", lido?.a === "clube1" && lido?.p === "MOLONI");
  check("state mexido é recusado", cofre.verificar(state.slice(0, -2) + "zz") === null);
  check("state caducado é recusado", cofre.verificar(cofre.assinar({ a: "x" }, -1000)) === null);
  check("state de outro cofre é recusado", new Cofre("outro segredo qualquer, também comprido").verificar(state) === null);
}

async function testarInvoiceXpress() {
  console.log("=== InvoiceXpress ===");
  limpar();
  const ix = new InvoiceXpress();
  const cred = { provider: "INVOICEXPRESS" as const, accountName: "clube-fundao", apiKey: "chave123" };

  rota((p) => p.url.includes("/taxes.json") && p.metodo === "GET", () => ({ json: { taxes: [{ id: 1, name: "IVA23", value: "23.0", region: "PT", default_tax: 1 }, { id: 2, name: "Isento", value: "0.0", region: "PT", code: "ISE" }] } }));
  check("verificar com 200", (await ix.verificar(cred)).nome === "clube-fundao");
  check("a chave vai na query", ultimo((p) => p.url.includes("/taxes.json"))?.url.includes("api_key=chave123") === true);

  const def = await ix.preparar(cred, {});
  check("preparar resolve os nomes das taxas", def.interno?.taxa23 === "IVA23" && def.interno?.taxa0 === "Isento" && !def.interno?.taxa6);

  rota((p) => p.url.includes("/taxes.json") && p.metodo === "GET", () => ({ status: 401, json: { errors: [{ error: "Authentication Error" }] } }));
  rotas.reverse();
  const e401 = await erroDe(ix.verificar(cred));
  check("401 é definitivo e explica", e401 instanceof ErroDeFaturacao && e401.definitivo && /chave/i.test(e401.message));
  limpar();

  rota((p) => p.url.includes("/invoices.json"), () => ({ json: { invoices: [] } }));
  rota((p) => p.url.includes("/invoice_receipts.json") && p.metodo === "POST", () => ({ status: 201, json: { invoice_receipt: { id: 77, status: "draft" } } }));
  rota((p) => p.url.includes("/invoice_receipts/77/change-state.json"), () => ({ json: { invoice_receipt: { id: 77, status: "settled", sequence_number: "6/G", atcud: "ABCD1234-6", permalink: "https://ix/p/77" } } }));
  const doc = docMensalidade();
  const emitido = await ix.emitir(cred, def, doc);
  check("emite e finaliza", emitido.externalId === "77" && emitido.number === "FR 6/G" && emitido.atcud === "ABCD1234-6");
  const criar = ultimo((p) => p.url.includes("/invoice_receipts.json"))?.json as { invoice: Record<string, unknown>; proprietary_uid: string };
  check("a referência e o uid são os nossos", criar.invoice.reference === doc.referencia && criar.proprietary_uid === doc.referencia);
  check("a data vai dd/mm/aaaa", criar.invoice.date === "25/10/2026");
  check("a linha isenta leva a taxa a 0 % e o motivo no documento", (criar.invoice.items as { tax: { name: string } }[])[0]!.tax.name === "Isento" && criar.invoice.tax_exemption === "M07");
  check("o cliente leva o NIF como código", (criar.invoice.client as { code: string; fiscal_id: string }).code === "123456789");
  check("o fecho pede finalized", (ultimo((p) => p.url.includes("change-state"))?.json as { invoice: { state: string } }).invoice.state === "finalized");

  rota((p) => p.url.includes("/api/pdf/77.json"), (_p, vez) => (vez === 0 ? { status: 202, texto: "" } : { json: { output: { pdfUrl: "https://ix/pdf/77.pdf" } } }));
  rota((p) => p.url === "https://ix/pdf/77.pdf", () => ({ pdf: true }));
  const pdf = await ix.pdf(cred, def, emitido);
  check("PDF: espera o 202 e descarrega", pdf.subarray(0, 4).toString() === "%PDF" && pedidos.filter((p) => p.url.includes("/api/pdf/77.json")).length === 2);

  limpar();
  rota((p) => p.url.includes("/invoices.json"), () => ({ json: { invoices: [{ id: 78, reference: doc.referencia, status: "draft" }] } }));
  rota((p) => p.url.includes("/invoice_receipts/78/change-state.json"), () => ({ json: { invoice_receipt: { id: 78, sequence_number: "7/G", atcud: "N/D" } } }));
  const semAtcud = await erroDe(ix.procurar(cred, def, doc.referencia));
  check("rascunho já existente é fechado e não criado outro", pedidos.some((p) => p.url.includes("/78/change-state")) && !pedidos.some((p) => p.url.endsWith("/invoice_receipts.json")));
  check("ATCUD N/D é erro definitivo", semAtcud instanceof ErroDeFaturacao && semAtcud.definitivo && /ATCUD/.test(semAtcud.message));

  limpar();
  rota((p) => p.url.includes("/invoice_receipts.json"), () => ({ status: 422, json: { errors: { error: "Client name can't be blank" } } }));
  const e422 = await erroDe(ix.emitir(cred, def, doc));
  check("422 é definitivo com a mensagem do programa", e422 instanceof ErroDeFaturacao && e422.definitivo && /Client name/.test(e422.message));
  limpar();
  rota((p) => p.url.includes("/invoice_receipts.json"), () => ({ status: 503, texto: "down" }));
  const e503 = await erroDe(ix.emitir(cred, def, doc));
  check("503 é de passagem", e503 instanceof ErroDeFaturacao && !e503.definitivo);
  const semTaxa = await erroDe(ix.emitir(cred, { interno: { taxa23: "IVA23" } }, doc));
  check("sem taxa a 0 % na conta: definitivo, sem chamar o programa", semTaxa instanceof ErroDeFaturacao && semTaxa.definitivo && pedidos.length === 1);
}

async function testarMoloni() {
  console.log("=== Moloni ===");
  limpar();
  const moloni = new Moloni({ clientId: "dev", clientSecret: "seg" });
  const cred = { provider: "MOLONI" as const, accessToken: "tok", refreshToken: "ref", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  const def = { companyId: "5", serieId: "123", paymentMethodId: "11", interno: { taxa23: "7", unitId: "1", categoryId: "2", maturityDateId: "3", produto_MENSALIDADE: "900", produto_LOJA: "901", produto_TAXA: "902", preparadoEm: "x" } };

  check("url de autorização nova", moloni.urlDeAutorizacao("https://api/cb", "st").startsWith("https://www.moloni.pt/ac/root/oauth/?response_type=code&client_id=dev"));
  check("não renova com mais de 30 min de vida", (await moloni.renovar(cred)) === null);
  rota((p) => p.url.includes("/grant/"), () => ({ json: { access_token: "novo", refresh_token: "novoref", expires_in: 3600 } }));
  const renovadas = await moloni.renovar({ ...cred, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  check("renova perto do fim e devolve o par novo", renovadas?.provider === "MOLONI" && renovadas.accessToken === "novo" && renovadas.refreshToken === "novoref");
  check("a renovação vai na query", ultimo((p) => p.url.includes("/grant/"))?.url.includes("grant_type=refresh_token&client_id=dev&client_secret=seg&refresh_token=ref") === true);

  limpar();
  rota((p) => p.url.includes("/invoiceReceipts/getAll/"), () => ({ json: [] }));
  rota((p) => p.url.includes("/customers/getByVat/"), () => ({ json: [] }));
  rota((p) => p.url.includes("/customers/getNextNumber/"), () => ({ json: { number: "42" } }));
  rota((p) => p.url.includes("/customers/insert/"), () => ({ json: { valid: 1, customer_id: 9 } }));
  rota((p) => p.url.includes("/invoiceReceipts/insert/"), () => ({ json: { valid: 1, document_id: 44 } }));
  rota((p) => p.url.includes("/documents/getOne/"), () => ({ json: { document_id: 44, net_value: 25, document_set_name: "A", number: 12, status: 1 } }));
  rota((p) => p.url.includes("/invoiceReceipts/update/"), () => ({ json: { valid: 1 } }));
  const doc = docMensalidade();
  const emitido = await moloni.emitir(cred, def, doc);
  check("emite, confere o total e fecha", emitido.externalId === "44" && emitido.number === "FR A/12");
  check("o token vai na query e o corpo em JSON", pedidos.every((p) => p.url.includes("access_token=tok") && p.url.includes("json=true") && p.headers["content-type"] === "application/json"));
  const cliente = ultimo((p) => p.url.includes("/customers/insert/"))?.json as Record<string, unknown>;
  check("cliente novo com o NIF e os ids da conta", cliente.vat === "123456789" && cliente.number === "42" && cliente.maturity_date_id === 3 && cliente.payment_method_id === 11 && cliente.zip_code === "1000-100");
  const insert = ultimo((p) => p.url.includes("/invoiceReceipts/insert/"))?.json as Record<string, unknown>;
  const linha = (insert.products as Record<string, unknown>[])[0]!;
  check("linha isenta: sem taxas, com motivo, preço sem IVA = pago", Array.isArray(linha.taxes) && (linha.taxes as unknown[]).length === 0 && linha.exemption_reason === "M07" && linha.price === 25 && linha.product_id === 900);
  check("nasce rascunho, com a nossa referência e o pagamento", insert.status === 0 && insert.our_reference === doc.referencia && (insert.payments as { value: number }[])[0]!.value === 25);
  check("fecha com status 1", (ultimo((p) => p.url.includes("/invoiceReceipts/update/"))?.json as { status: number }).status === 1);

  limpar();
  rota((p) => p.url.includes("/invoiceReceipts/getAll/"), () => ({ json: [] }));
  rota((p) => p.url.includes("/customers/getByVat/"), () => ({ json: [{ customer_id: 3, vat: "123456789" }] }));
  rota((p) => p.url.includes("/invoiceReceipts/insert/"), () => ({ json: { valid: 1, document_id: 45 } }));
  rota((p) => p.url.includes("/documents/getOne/"), () => ({ json: { document_id: 45, net_value: 24.99 } }));
  rota((p) => p.url.includes("/invoiceReceipts/delete/"), () => ({ json: { valid: 1 } }));
  const divergente = await erroDe(moloni.emitir(cred, def, doc));
  check("total diferente do pago: apaga o rascunho e é definitivo", divergente instanceof ErroDeFaturacao && divergente.definitivo && pedidos.some((p) => p.url.includes("/invoiceReceipts/delete/")) && !pedidos.some((p) => p.url.includes("/customers/insert/")));

  limpar();
  rota((p) => p.url.includes("/invoiceReceipts/getAll/"), () => ({ json: [] }));
  rota((p) => p.url.includes("/customers/getByVat/"), () => ({ json: [{ code: 16, description: "O cliente precisa de morada" }] }));
  const dados = await erroDe(moloni.emitir(cred, def, doc));
  check("lista de erros com 200 é definitivo", dados instanceof ErroDeFaturacao && dados.definitivo && /morada/.test(dados.message));

  limpar();
  rota((p) => p.url.includes("/companies/getAll/"), () => ({ status: 401, json: { error: "invalid_token" } }));
  const token = await erroDe(moloni.verificar(cred));
  check("token recusado pede nova autorização", token instanceof ErroDeFaturacao && token.definitivo && /autorizar/.test(token.message));

  limpar();
  rota((p) => p.url.includes("/documents/getPDFLink/"), () => ({ json: { url: "https://moloni/pdf?x=1&y=2" } }));
  rota((p) => p.url.startsWith("https://moloni/pdf"), () => ({ status: 200, texto: "<html>não é pdf</html>" }));
  rota((p) => p.url.startsWith("https://www.moloni.pt/downloads/index.php"), () => ({ pdf: true }));
  const pdf = await moloni.pdf(cred, def, emitido);
  check("PDF: tenta o link e depois o do plugin", pdf.subarray(0, 4).toString() === "%PDF" && pedidos.some((p) => p.url.includes("action=getDownload&x=1&y=2")));
}

async function testarSage() {
  console.log("=== Sage One ===");
  check("codificar segue a RFC 3986", codificar("a b!*'()") === "a%20b%21%2A%27%28%29");
  const params = new URLSearchParams();
  params.append("sales_invoice[date]", "2026-10-25");
  params.append("sales_invoice[contact_id]", "2");
  const a = assinar("POST", "https://api.sageone.com/accounts/v2/sales_invoices", params, "nonce1", "seg", "tok");
  const invertidos = new URLSearchParams();
  invertidos.append("sales_invoice[contact_id]", "2");
  invertidos.append("sales_invoice[date]", "2026-10-25");
  check("a assinatura não depende da ordem dos parâmetros", a === assinar("POST", "https://api.sageone.com/accounts/v2/sales_invoices", invertidos, "nonce1", "seg", "tok"));
  check("muda com o nonce, o token e o método", a !== assinar("POST", "https://api.sageone.com/accounts/v2/sales_invoices", params, "nonce2", "seg", "tok") && a !== assinar("GET", "https://api.sageone.com/accounts/v2/sales_invoices", params, "nonce1", "seg", "tok"));
  check("é base64 de 20 bytes (SHA-1)", Buffer.from(a, "base64").length === 20);

  limpar();
  const sage = new SageOne({ clientId: "c", clientSecret: "s", signingSecret: "assina" });
  const cred = { provider: "SAGE_ONE" as const, accessToken: "tok", refreshToken: "ref", expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
  const def = { bankAccountId: "18918", paymentTypeId: "1", interno: { taxa0: "4", taxa23: "1", isencao_M07: "7", preparadoEm: "x" } };
  rota((p) => p.url.startsWith("https://api.sageone.com/accounts/v2/sales_invoices?") || p.url === "https://api.sageone.com/accounts/v2/sales_invoices" && p.metodo === "GET", () => ({ json: { $items: [] } }));
  rota((p) => p.url.includes("/accounts/v2/contacts") && p.metodo === "GET", () => ({ json: { $items: [] } }));
  rota((p) => p.url.includes("/accounts/v2/contacts") && p.metodo === "POST", () => ({ status: 201, json: { id: 25 } }));
  rota((p) => p.url === "https://api.sageone.com/accounts/v2/sales_invoices" && p.metodo === "POST", () => ({ status: 201, json: { id: 41869, artefact_number: "FT 2026/1", total_net_amount: "25.0", total_tax_amount: "0.0" } }));
  rota((p) => p.url.includes("/accounts/v1/sales_invoices/41869/payments"), () => ({ status: 201, json: { id: 113157 } }));
  const doc = docMensalidade();
  const emitido = await sage.emitir(cred, def, doc);
  check("fatura + recibo", emitido.externalId === "41869" && emitido.number === "FT 2026/1" && emitido.receiptExternalId === "113157");
  const criar = ultimo((p) => p.url === "https://api.sageone.com/accounts/v2/sales_invoices" && p.metodo === "POST")!;
  check("corpo em formulário com as linhas aninhadas", criar.corpo.includes("sales_invoice%5Bline_items_attributes%5D%5B0%5D%5Bunit_price_includes_tax%5D=1") && criar.corpo.includes("sales_invoice%5Bcontact_id%5D=25"));
  check("o motivo de isenção vai por id", criar.corpo.includes("sales_invoice%5Bvat_exemption_reason_id%5D=7"));
  check("cabeçalhos assinados", Boolean(criar.headers["x-signature"] && criar.headers["x-nonce"] && criar.headers.authorization === "Bearer tok"));
  check("o recibo leva a conta e o tipo", ultimo((p) => p.url.includes("/payments"))!.corpo.includes("sales_invoice_payment%5Bbank_account_id%5D=18918"));

  rota((p) => p.url === "https://api.sageone.com/accounts/v2/sales_invoices/41869", () => ({ pdf: true }));
  const pdf = await sage.pdf(cred, def, emitido);
  check("PDF com Accept application/pdf", pdf.subarray(0, 4).toString() === "%PDF" && ultimo((p) => p.url.endsWith("/41869"))?.headers.accept === "application/pdf");

  const semMotivo = await erroDe(sage.emitir(cred, { ...def, interno: { taxa0: "4", preparadoEm: "x" } }, doc));
  check("motivo de isenção desconhecido na conta: definitivo", semMotivo instanceof ErroDeFaturacao && semMotivo.definitivo);
}

async function testarPhcGo() {
  console.log("=== PHC GO ===");
  limpar();
  const phc = new PhcGo({ appId: "APP" });
  const cred = { provider: "PHC_GO" as const, backendUrl: "https://sis50.phcgo.net/clube", userCode: "api", password: "pw", company: "" };
  rota((p) => p.url.endsWith("/generateAccessToken"), () => ({ json: { code: 0, message: "Token generated.", token: "T1" } }));
  const v = await phc.verificar(cred);
  check("verificar pede o token sem prazo e guarda-o", (v.cred as { token?: string }).token === "T1" && (ultimo((p) => p.url.endsWith("/generateAccessToken"))?.json as { credentials: { tokenLifeTime: string; appId: string } }).credentials.tokenLifeTime === "Never");
  const mau = await erroDe(phc.verificar({ ...cred, backendUrl: "https://outro.site/x" }));
  check("endereço fora do phcgo.net é recusado", mau instanceof ErroDeFaturacao);

  const comToken = v.cred as typeof cred & { token: string };
  rota((p) => p.url.endsWith("/searchEntities"), () => ({ json: { code: 0, entities: [] } }));
  rota((p) => p.url.endsWith("/createDocument"), () => ({ json: { code: 1, pdf: "https://phc/pdf/1", requestedFields: { fno: 285, ftstamp: "ST", nmdoc: "Fatura/Recibo", ftano: 2026, etotal: 25 } } }));
  const emitido = await phc.emitir(comToken, { serieId: "2", interno: { preparadoEm: "x" } }, docMensalidade());
  check("emite com a série e devolve o número", emitido.number === "Fatura/Recibo 2026/285" && emitido.externalId === "2:2026:285:ST" && emitido.permalink === "https://phc/pdf/1");
  const criar = ultimo((p) => p.url.endsWith("/createDocument"))?.json as Record<string, Record<string, unknown> & unknown[]>;
  check("o token vai no Authorization sem Bearer", ultimo((p) => p.url.endsWith("/createDocument"))?.headers.authorization === "T1");
  check("linha com IVA incluído, taxa 0 e motivo", (criar.products as unknown as Record<string, unknown>[])[0]!.taxIncluded === true && (criar.products as unknown as Record<string, unknown>[])[0]!.taxExemptionCode === "M07" && criar.document.docType === 2 && criar.requestOptions.option === 1);
  rota((p) => p.url === "https://phc/pdf/1", () => ({ pdf: true }));
  check("PDF pelo link da emissão", (await phc.pdf(comToken, {}, emitido)).subarray(0, 4).toString() === "%PDF");
  rota((p) => p.url.endsWith("/createDocument"), () => ({ json: { code: 100, message: "Monthly request limit exceeded" } }));
  rotas.reverse();
  const limite = await erroDe(phc.emitir(comToken, { serieId: "2", interno: { preparadoEm: "x" } }, docMensalidade()));
  check("pacote esgotado: definitivo e explica", limite instanceof ErroDeFaturacao && limite.definitivo && /pacote/.test(limite.message));
}

async function testarVendus() {
  console.log("=== Vendus ===");
  limpar();
  const vendus = new Vendus();
  const cred = { provider: "VENDUS" as const, apiKey: "chave" };
  rota((p) => p.url.includes("/documents/?external_reference="), () => ({ json: [] }));
  rota((p) => p.url.endsWith("/documents/") && p.metodo === "POST", () => ({ status: 201, json: { id: 501, number: "FR 01P2026/3", atcud: "JX7Q-3", amount_gross: 25, output: "https://vendus/pdf/501" } }));
  const doc = docMensalidade();
  const emitido = await vendus.emitir(cred, { serieId: "7", paymentMethodId: "3" }, doc);
  check("emite final com número e ATCUD", emitido.externalId === "501" && emitido.number === "FR 01P2026/3" && emitido.atcud === "JX7Q-3");
  const criar = ultimo((p) => p.url.endsWith("/documents/") && p.metodo === "POST")!;
  const corpo = criar.json as Record<string, unknown>;
  check("Bearer com a chave", criar.headers.authorization === "Bearer chave");
  check("FR na caixa, com tx_id e pagamento", corpo.type === "FR" && corpo.register_id === 7 && corpo.tx_id === doc.referencia && (corpo.payments as { id: number; amount: number }[])[0]!.amount === 25);
  const item = (corpo.items as Record<string, unknown>[])[0]!;
  check("linha isenta: ISE + motivo, preço bruto", item.tax_id === "ISE" && item.tax_exemption === "M07" && item.gross_price === 25);
  check("cliente com NIF e sem email da Vendus", (corpo.client as { fiscal_id: string; send_email: string }).fiscal_id === "123456789" && (corpo.client as { send_email: string }).send_email === "no");
  rota((p) => p.url.includes("/documents/501.pdf"), () => ({ pdf: true }));
  check("PDF pelo endereço do documento", (await vendus.pdf(cred, {}, emitido)).subarray(0, 4).toString() === "%PDF");
  limpar();
  rota((p) => p.url.includes("/registers/"), () => ({ status: 401, texto: "{}" }));
  const chave = await erroDe(vendus.verificar(cred));
  check("chave recusada é definitivo", chave instanceof ErroDeFaturacao && chave.definitivo && /chave/.test(chave.message));
}

async function main() {
  testarRegras();
  testarCofre();
  await testarInvoiceXpress();
  await testarMoloni();
  await testarSage();
  await testarPhcGo();
  await testarVendus();
  console.log(`\n${falhas === 0 ? "TUDO OK" : "FALHOU"} — ${ok} ok, ${falhas} falhas`);
  process.exitCode = falhas === 0 ? 0 : 1;
}

void main();
