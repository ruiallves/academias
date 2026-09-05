#!/usr/bin/env node
/**
 * As taxas da euPago, e a promessa de que aparecem em todo o lado.
 *
 * ## O que o clube pedia
 *
 * "Em todos os locais, agora **e no futuro**, em que alguém tenha de pagar
 * algo, quando o clube for configurar preços tem de aparecer quanto o clube vai
 * receber e quanto o pai vai pagar."
 *
 * O "agora" é fácil de ligar e fácil de verificar. O "no futuro" é o que este
 * teste existe para garantir: a última secção varre o código da consola à
 * procura de campos de dinheiro sem a linha de custo, e falha quando alguém
 * acrescentar um preço novo e se esquecer dela. Um combinado destes só se
 * mantém se houver algo a lembrá-lo.
 *
 * ## Sobre a API da euPago
 *
 * Não tem endpoint de taxas. Procurei no índice de documentação deles
 * (`eupago.readme.io/llms.txt`, 53 páginas) e não há preços, comissões nem
 * tarifário; a única fonte de comissão real seria `payouts/transactions`, cujo
 * esquema não está documentado. Os valores são os públicos, na configuração do
 * servidor, corrigíveis sem deploy. Ver `eupago-fees.ts`.
 *
 * Uso: node scripts/test-taxas-eupago.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONSOLA = path.join(HERE, "..", "..", "console", "src");
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split(/\r?\n/).find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://127.0.0.1:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => { if (c) { ok++; console.log("  OK    " + l); } else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); } };

const token = (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "direcao@lifeclub.pt", password: "academia2026" }),
})).json()).access_token;

const call = (p) =>
  fetch(API + p, { headers: { Authorization: `Bearer ${token}`, "x-academy-slug": "life-club" } })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

console.log("=== A tabela vem do servidor ===");
const r = await call("/billing/fees");
check("o endpoint responde", r.status === 200, `${r.status}`);
check("com métodos", Array.isArray(r.body?.methods) && r.body.methods.length > 0, JSON.stringify(r.body));
check("e com a taxa de IVA", typeof r.body?.vatPercent === "number", `${r.body?.vatPercent}`);
check("e diz de onde vêm os números", typeof r.body?.source === "string" && r.body.source.length > 0, `${r.body?.source}`);

const porMetodo = new Map((r.body?.methods ?? []).map((m) => [m.method, m]));
console.table([...porMetodo.values()].map((m) => ({ método: m.label, fixo: (m.fixedCents / 100).toFixed(2) + " €", percentagem: m.percent + " %" })));

/*
 * Os sete que a app da família oferece — ver METODOS em screens/Payments.tsx.
 * Se alguém acrescentar um botão de pagamento lá e se esquecer da taxa aqui, o
 * clube passa a ver um intervalo que a realidade fura.
 */
for (const m of ["MBWAY", "MULTIBANCO", "CARD", "APPLE_PAY", "GOOGLE_PAY", "DIRECT_DEBIT", "PAYSAFECARD"]) {
  check(`${m} tem taxa`, porMetodo.has(m), "falta na tabela do servidor");
}
check("e todos marcados como oferecidos", [...porMetodo.values()].every((m) => m.offered === true));

/*
 * Os valores públicos da euPago, a 5 de Setembro de 2026. Se um clube negociar
 * outro contrato, isto passa por `EUPAGO_FEES` e este bloco deixa de bater —
 * e é suposto: a falha aqui é o lembrete de que os números mudaram.
 */
if (r.body?.source === "tabela pública euPago") {
  check("MB Way a 0,07 € + 0,7 %", porMetodo.get("MBWAY")?.fixedCents === 7 && porMetodo.get("MBWAY")?.percent === 0.7);
  check("Multibanco a 0,20 € + 1,5 %", porMetodo.get("MULTIBANCO")?.fixedCents === 20 && porMetodo.get("MULTIBANCO")?.percent === 1.5);
} else {
  console.log(`  (a tabela vem do contrato — os valores públicos não se aplicam)`);
}

console.log("\n=== O caminho que a consola pede é o que o servidor serve ===");
/*
 * A lacuna que deixou isto passar despercebido.
 *
 * O teste provava que `/billing/fees` responde, e o guarda provava que os ecras
 * usam a `CustoDoPagamento`. Nenhum dos dois provava que a **consola pede o
 * caminho certo** — e nao pedia: estava la `/api/billing/fees`, porque o
 * controlador de finance tem prefixo `api` e o de billing nao. 404 a cada
 * arranque, engolido pelo `catch`, e a linha nao aparecia em ecra nenhum.
 *
 * Le-se o caminho do proprio ficheiro da consola e vai-se la bater. Duas pecas
 * que se provam separadas continuam a poder nao encaixar uma na outra.
 */
const clienteTaxas = readFileSync(path.join(CONSOLA, "lib", "eupago-fees.ts"), "utf8");
const mCaminho = clienteTaxas.match(/export const CAMINHO = "([^"]+)"/);
check("a consola declara o caminho numa constante", Boolean(mCaminho), "não encontrei export const CAMINHO");

if (mCaminho) {
  const pedido = mCaminho[1];
  console.log("     a consola pede:", pedido);
  const resposta = await call(pedido);
  check(`o servidor responde a ${pedido}`, resposta.status === 200, `deu ${resposta.status}`);
  check("e com a tabela lá dentro", Array.isArray(resposta.body?.methods) && resposta.body.methods.length > 0);
}

console.log("\n=== A conta ===");
/* A mesma fórmula das duas pontas. Reescrita aqui de propósito: se o teste
   importasse a função, provava que ela é igual a si própria. */
const liquido = (cents, m, iva) => cents - Math.ceil((m.fixedCents + (cents * m.percent) / 100) * (1 + iva / 100));

const iva = r.body.vatPercent;
const mbway = porMetodo.get("MBWAY");
const mb = porMetodo.get("MULTIBANCO");

/* 40 € por MB Way: 0,07 + 0,28 = 0,35, +IVA = 0,4305 → 0,44 arredondado acima. */
check("40 € por MB Way deixam 39,56 €", liquido(4000, mbway, iva) === 3956, `${liquido(4000, mbway, iva)}`);
/* 40 € por Multibanco: 0,20 + 0,60 = 0,80, +IVA = 0,984 → 0,99. */
check("40 € por Multibanco deixam 39,01 €", liquido(4000, mb, iva) === 3901, `${liquido(4000, mb, iva)}`);
check("e o Multibanco custa sempre mais do que o MB Way", liquido(4000, mb, iva) < liquido(4000, mbway, iva));

/* A comissão nunca pode comer o pagamento inteiro nem virar negativa. */
check("um pagamento de 1 € continua positivo", liquido(100, mb, iva) > 0, `${liquido(100, mb, iva)}`);
check("e a parte fixa pesa mais num valor pequeno", 100 - liquido(100, mb, iva) > (4000 - liquido(4000, mb, iva)) / 40);

/* Apple Pay e Google Pay correm sobre cartão — mesmo preço, e é isso que se afirma. */
check(
  "Apple Pay e Google Pay custam o mesmo que o cartão",
  liquido(4000, porMetodo.get("APPLE_PAY"), iva) === liquido(4000, porMetodo.get("CARD"), iva) &&
    liquido(4000, porMetodo.get("GOOGLE_PAY"), iva) === liquido(4000, porMetodo.get("CARD"), iva),
);
/* O débito directo não tem percentagem: num valor alto é o mais barato de todos. */
check(
  "num valor alto o débito directo é o melhor para o clube",
  liquido(20000, porMetodo.get("DIRECT_DEBIT"), iva) > liquido(20000, porMetodo.get("MBWAY"), iva),
);
/* E o PaySafeCard, a 12 %, é sempre o pior — é o que alarga o intervalo. */
const piores = [...porMetodo.values()].map((m) => ({ m: m.method, n: liquido(4000, m, iva) })).sort((a, b) => a.n - b.n);
check("o PaySafeCard é o mais caro de todos", piores[0].m === "PAYSAFECARD", piores[0].m);

console.log("\n=== E aparece em todo o lado — agora e no futuro ===");
/*
 * A varredura.
 *
 * Procura campos de dinheiro (`inputMode="decimal"`) nos ficheiros da consola e
 * exige que o ficheiro use a `CustoDoPagamento`. Os que ficam de fora estão
 * numa lista explícita, com a razão escrita — porque a excepção tem de ser uma
 * decisão de alguém, e não um esquecimento que passou despercebido.
 */
const FORA = {
  "routes/finance/Budget.tsx": "tectos de orçamento — dinheiro que o clube gasta, não que recebe",
  "routes/finance/Finance.tsx": "movimentos de tesouraria já acontecidos — não é um preço a fixar",
  "components/finance/TransactionDialog.tsx": "registo de uma despesa/receita — não passa pela euPago",
  "components/AthleteEditPanel.tsx": "altura e peso do atleta — não é dinheiro",
};

const ficheiros = [];
(function varrer(dir) {
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) varrer(p);
    else if (nome.endsWith(".tsx")) ficheiros.push(p);
  }
})(CONSOLA);

/*
 * Conta, não procura.
 *
 * A primeira versão perguntava "este ficheiro menciona a CustoDoPagamento?" — e
 * isso deixou passar exactamente o que existia para apanhar: o `Fees.tsx` tem
 * **dois** campos de preço (o da equipa e o do ajuste em massa por atleta) e só
 * um deles tinha a linha. O ficheiro mencionava-a, o teste passava, e o clube
 * abria o segundo diálogo e não via nada.
 *
 * Contar os dois lados apanha isso. Não é perfeito — dois campos e duas linhas
 * mal emparelhados passariam —, mas apanha o caso real, que é alguém acrescentar
 * um campo e esquecer-se da linha.
 */
const semLinha = [];
for (const f of ficheiros) {
  const texto = readFileSync(f, "utf8");
  const campos = (texto.match(/inputMode="decimal"/g) ?? []).length;
  if (campos === 0) continue;

  const rel = path.relative(CONSOLA, f).replace(/\\/g, "/");
  if (FORA[rel]) continue;

  const linhas = (texto.match(/<CustoDoPagamento/g) ?? []).length;
  if (linhas < campos) semLinha.push(`${rel} (${campos} campos, ${linhas} linhas de custo)`);
}

check(
  "cada campo de preço tem a sua linha de custo",
  semLinha.length === 0,
  semLinha.length
    ? `${semLinha.join("; ")} — ou usa <CustoDoPagamento>, ou entra na lista FORA deste teste com a razão`
    : "",
);

const total = ficheiros.reduce(
  (n, f) => n + (readFileSync(f, "utf8").match(/<CustoDoPagamento/g) ?? []).length,
  0,
);
console.log(`     ${total} campos de preço com a linha de custo`);
/*
 * Seis: preço por equipa, ajuste por atleta em massa, ajuste individual na ficha
 * do atleta, mensalidade nova, cobrança avulsa e quota de sócio.
 */
check("e estão todos os sítios conhecidos", total >= 6, `${total}`);

/* A lista de excepções não pode apodrecer: um ficheiro que já não existe (ou
   que já não tem campo de dinheiro) tem de sair de lá. */
const mortas = Object.keys(FORA).filter((rel) => {
  const p = path.join(CONSOLA, rel);
  try {
    return !readFileSync(p, "utf8").includes('inputMode="decimal"');
  } catch {
    return true;
  }
});
check("a lista de excepções não tem entradas mortas", mortas.length === 0, mortas.join(", "));

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);
