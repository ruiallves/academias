#!/usr/bin/env node
/**
 * O armazém do clube.
 *
 * ## O que este teste existe para provar
 *
 * Que **o servidor é a fonte de verdade do stock**. Um inventário em que o
 * número da prateleira e o número do ecrã divergem é pior do que a folha de
 * Excel que veio substituir: a folha, ao menos, ninguém acredita cegamente.
 *
 * As quatro coisas que não podem falhar:
 *
 * 1. **Nunca entregar o que não há** — nem com dois pedidos ao mesmo tempo. É a
 *    corrida que uma leitura seguida de escrita não resolve, e por isso o
 *    desconto é um `UPDATE` condicional (ver `descontarDisponivel`).
 * 2. **Nenhuma quantidade muda sem um movimento.** O histórico não é um extra:
 *    é o que separa isto de um contador.
 * 3. **Isolamento entre clubes.** O inventário de um clube não existe para
 *    outro — nem para ler, nem para lhe mexer.
 * 4. **Permissões no servidor.** Quem abre a página sem `inventory:write` não
 *    altera stock por chamar a API directamente.
 *
 * Uso: node scripts/test-inventory.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const S = env("SUPABASE_URL").replace(/\/$/, "");
const A = env("SUPABASE_ANON_KEY");
const API = process.env.API_URL ?? "http://localhost:3000";

let ok = 0;
let bad = 0;
const check = (l, c, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

const login = async (email) =>
  (
    await (
      await fetch(`${S}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: A, "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "academia2026" }),
      })
    ).json()
  ).access_token;

const call = async (token, method, pathname, body, slug = "life-club") => {
  const r = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-academy-slug": slug,
      "x-app": "console",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const limpar = async () => {
  await db.query(`DELETE FROM "InventoryItem" WHERE name LIKE 'ZI %'`);
  await db.query(`DELETE FROM "CatalogItem" WHERE label LIKE 'ZI %'`);
};
await limpar();

const director = await login("direcao@lifeclub.pt");
const coach = await login("treinador@lifeclub.pt");

const academia = (await db.query(`SELECT id FROM "Academy" WHERE slug = 'life-club'`)).rows[0].id;
const atleta = (await db.query(`SELECT id, name FROM "Athlete" WHERE "academyId" = $1 LIMIT 1`, [academia])).rows[0];

/* ========================================================== artigos ===== */

console.log("=== Criar um artigo com tamanhos ===");
const criado = await call(director, "POST", "/api/inventory/items", {
  name: "ZI T-shirt de aquecimento",
  brand: "ZI Sport",
  minimumStock: 5,
  variants: [
    { label: "S", quantity: 10 },
    { label: "M", quantity: 3 },
    { label: "L", quantity: 0 },
  ],
});
check("o artigo é criado", criado.status === 201, `${criado.status} ${JSON.stringify(criado.body).slice(0, 140)}`);
const itemId = criado.body?.id;

const detalhe = await call(director, "GET", `/api/inventory/items/${itemId}`);
check("com os três tamanhos", detalhe.body?.variants?.length === 3, JSON.stringify(detalhe.body?.variants?.length));

/*
 * O disponível é derivado — `total − atribuído` — e não uma coluna. Se algum dia
 * alguém o guardar, é aqui que se vê a divergência.
 */
const M = detalhe.body.variants.find((v) => v.label === "M");
check("o disponível vem calculado", M.total === 3 && M.available === 3 && M.assigned === 0, JSON.stringify(M));

/*
 * O estado sai do disponível contra o mínimo: 3 de mínimo 5 é stock baixo, 0 é
 * esgotado. E o artigo herda o pior dos tamanhos — um M em falta não fica
 * escondido atrás de dez S.
 */
check("um tamanho abaixo do mínimo diz 'baixo'", M.status === "low", M.status);
check("um tamanho a zero diz 'esgotado'", detalhe.body.variants.find((v) => v.label === "L").status === "out");
check("e o artigo herda o pior dos tamanhos", detalhe.body.status === "out", detalhe.body.status);

console.log("\n=== O stock inicial entra no histórico ===");
/*
 * Um número que aparece sem movimento é um número em que não se pode confiar:
 * daqui a seis meses ninguém sabe se foram comprados, oferecidos ou inventados.
 */
check(
  "o stock com que o artigo nasce fica registado como entrada",
  detalhe.body.movements.filter((m) => m.type === "ENTRY").length === 2,
  JSON.stringify(detalhe.body.movements.map((m) => `${m.type} ${m.quantity}`)),
);

/* ============================================================ stock ===== */

console.log("\n=== Entradas, saídas e contagens ===");
const entrada = await call(director, "POST", `/api/inventory/variants/${M.id}/stock`, {
  type: "ENTRY",
  quantity: 50,
  reason: "Compra de época",
});
check("dar entrada de 50 soma ao total", entrada.body?.total === 53, JSON.stringify(entrada.body));

const saida = await call(director, "POST", `/api/inventory/variants/${M.id}/stock`, { type: "EXIT", quantity: 3 });
check("dar saída de 3 subtrai", saida.body?.total === 50, JSON.stringify(saida.body));

// "Contei" fixa o número — não soma. É a operação de quem está com a prateleira
// à frente, e a que mais se estragaria se pedisse a diferença.
const contagem = await call(director, "POST", `/api/inventory/variants/${M.id}/stock`, { type: "ADJUSTMENT", quantity: 48 });
check("uma contagem fixa o total no valor contado", contagem.body?.total === 48, JSON.stringify(contagem.body));

const demais = await call(director, "POST", `/api/inventory/variants/${M.id}/stock`, { type: "EXIT", quantity: 999 });
check("não se dá saída do que não há (400)", demais.status === 400, `${demais.status}`);

const negativo = await call(director, "POST", `/api/inventory/variants/${M.id}/stock`, { type: "ENTRY", quantity: -5 });
check("uma quantidade negativa é recusada (400)", negativo.status === 400, `${negativo.status}`);

/* ========================================================== entregas ==== */

console.log("\n=== Entregar a um atleta ===");
const entrega = await call(director, "POST", "/api/inventory/assignments", {
  athleteId: atleta.id,
  variantId: M.id,
  quantity: 2,
  notes: "Equipamento de treino",
});
check("a entrega é criada", entrega.status === 201, `${entrega.status} ${JSON.stringify(entrega.body).slice(0, 140)}`);

const depois = await db.query(`SELECT "totalQuantity" t, "assignedQuantity" a FROM "InventoryVariant" WHERE id = $1`, [M.id]);
/*
 * O total não muda numa entrega — a unidade só troca de sítio, da prateleira
 * para o atleta. É o atribuído que sobe, e é o disponível (derivado) que desce.
 */
check(
  "o total fica igual e o atribuído sobe",
  depois.rows[0].t === 48 && depois.rows[0].a === 2,
  JSON.stringify(depois.rows[0]),
);

const movEntrega = await db.query(
  `SELECT type, quantity, "athleteId" FROM "InventoryMovement" WHERE "variantId" = $1 AND type = 'ASSIGNMENT'`,
  [M.id],
);
check("e a entrega deixa um movimento com o atleta", movEntrega.rows[0]?.athleteId === atleta.id, JSON.stringify(movEntrega.rows[0]));

console.log("\n=== Não se entrega o que não há ===");
const L = detalhe.body.variants.find((v) => v.label === "L");
const semStock = await call(director, "POST", "/api/inventory/assignments", {
  athleteId: atleta.id,
  variantId: L.id,
  quantity: 1,
});
check("um tamanho esgotado é recusado (400)", semStock.status === 400, `${semStock.status}`);

const demasiados = await call(director, "POST", "/api/inventory/assignments", {
  athleteId: atleta.id,
  variantId: M.id,
  quantity: 500,
});
check("mais do que o disponível é recusado (400)", demasiados.status === 400, `${demasiados.status}`);
check(
  "e a mensagem diz quantas há",
  /\d+/.test(String(demasiados.body?.message ?? "")),
  JSON.stringify(demasiados.body?.message),
);

console.log("\n=== Duas entregas ao mesmo tempo ===");
/*
 * A corrida. Duas pessoas ao balcão a entregar a última unidade: as duas lêem
 * "1 disponível" e as duas gravam. Com a condição no `WHERE` do `UPDATE`, só
 * uma afecta uma linha — a outra perde e leva um erro.
 *
 * Sem isto o stock ia a -1 e ninguém dava por ela até faltar uma t-shirt.
 */
const ultimo = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Colete de treino",
  variants: [{ label: "Único", quantity: 1 }],
});
const uId = (await call(director, "GET", `/api/inventory/items/${ultimo.body.id}`)).body.variants[0].id;

const [a1, a2] = await Promise.all([
  call(director, "POST", "/api/inventory/assignments", { athleteId: atleta.id, variantId: uId, quantity: 1 }),
  call(director, "POST", "/api/inventory/assignments", { athleteId: atleta.id, variantId: uId, quantity: 1 }),
]);
const vencedores = [a1, a2].filter((r) => r.status === 201).length;
check("só uma das duas passa", vencedores === 1, `${a1.status} e ${a2.status}`);

const stockUnico = await db.query(`SELECT "totalQuantity" t, "assignedQuantity" a FROM "InventoryVariant" WHERE id = $1`, [uId]);
check(
  "e o stock não fica negativo",
  stockUnico.rows[0].a === 1 && stockUnico.rows[0].t === 1,
  JSON.stringify(stockUnico.rows[0]),
);

/* ======================================================== devoluções ==== */

console.log("\n=== Devolver em bom estado ===");
const minhas = await call(director, "GET", `/api/inventory/assignments?athleteId=${atleta.id}`);
const aDevolver = minhas.body.find((x) => x.variantId === M.id);
check("a entrega aparece na lista do atleta", Boolean(aDevolver), JSON.stringify(minhas.body?.length));

const boa = await call(director, "POST", `/api/inventory/assignments/${aDevolver.id}/return`, {
  condition: "GOOD",
  quantity: 1,
});
check("devolver 1 de 2 passa", boa.status === 201 || boa.status === 200, `${boa.status}`);

const parcial = await db.query(`SELECT "totalQuantity" t, "assignedQuantity" a FROM "InventoryVariant" WHERE id = $1`, [M.id]);
check("o total fica igual e o atribuído desce", parcial.rows[0].t === 48 && parcial.rows[0].a === 1, JSON.stringify(parcial.rows[0]));

/*
 * Devolução parcial: o que ficou com o atleta continua a ser uma linha por
 * devolver, e o que voltou fecha numa linha própria. Um saldo escondido não
 * responderia a "o que é que o João ainda tem".
 */
const aindaTem = await call(director, "GET", `/api/inventory/assignments?athleteId=${atleta.id}`);
check(
  "o que sobrou continua com ele",
  aindaTem.body.some((x) => x.variantId === M.id && x.quantity === 1 && x.status === "ACTIVE"),
  JSON.stringify(aindaTem.body.map((x) => `${x.quantity} ${x.status}`)),
);

console.log("\n=== Devolver danificado e perdido ===");
const paraEstragar = await call(director, "POST", "/api/inventory/assignments", {
  athleteId: atleta.id,
  variantId: M.id,
  quantity: 2,
});
const danificada = await call(director, "POST", `/api/inventory/assignments/${paraEstragar.body.id}/return`, {
  condition: "DAMAGED",
  quantity: 1,
});
check("uma devolução danificada passa", danificada.status === 201 || danificada.status === 200, `${danificada.status}`);

const comBaixa = await db.query(
  `SELECT "totalQuantity" t, "assignedQuantity" a, "damagedQuantity" d, "lostQuantity" p FROM "InventoryVariant" WHERE id = $1`,
  [M.id],
);
/*
 * Uma peça rasgada sai do total: deixa de ser uma t-shirt que o clube pode
 * entregar. Fica contada à parte, que é o que responde a "quanto se estragou".
 */
check("o danificado sai do total e conta como baixa", comBaixa.rows[0].d === 1 && comBaixa.rows[0].t === 47, JSON.stringify(comBaixa.rows[0]));

const restante = (await call(director, "GET", `/api/inventory/assignments?athleteId=${atleta.id}`)).body.find(
  (x) => x.variantId === M.id && x.quantity === 1 && x.status === "ACTIVE",
);
const perdida = await call(director, "POST", `/api/inventory/assignments/${restante.id}/return`, { condition: "LOST" });
check("uma devolução perdida passa", perdida.status === 201 || perdida.status === 200, `${perdida.status}`);

const comPerda = await db.query(`SELECT "totalQuantity" t, "lostQuantity" p FROM "InventoryVariant" WHERE id = $1`, [M.id]);
check("e o perdido também sai do total", comPerda.rows[0].p === 1 && comPerda.rows[0].t === 46, JSON.stringify(comPerda.rows[0]));

const jaFechada = await call(director, "POST", `/api/inventory/assignments/${restante.id}/return`, { condition: "GOOD" });
check("devolver duas vezes a mesma entrega é recusado (400)", jaFechada.status === 400, `${jaFechada.status}`);

/* ========================================================= histórico ==== */

console.log("\n=== O histórico guarda tudo ===");
const historico = await call(director, "GET", `/api/inventory/movements?itemId=${itemId}`);
const tipos = new Set(historico.body.map((m) => m.type));
check(
  "estão lá as entradas, saídas, ajustes, entregas, devoluções e baixas",
  ["ENTRY", "EXIT", "ADJUSTMENT", "ASSIGNMENT", "RETURN", "DAMAGE", "LOSS"].every((t) => tipos.has(t)),
  [...tipos].join(", "),
);
check("cada movimento diz quem o fez", historico.body.every((m) => m.by), "algum sem autor");

/* ======================================================== permissões ==== */

console.log("\n=== Permissões ===");
/*
 * A interface esconde os botões a quem não tem `inventory:write` — mas a
 * interface não é a fronteira. Estas são as verificações que contam.
 */
const leitura = await call(coach, "GET", "/api/inventory/items");
check("um treinador não vê o inventário por omissão (403)", leitura.status === 403, `${leitura.status}`);

const escrita = await call(coach, "POST", `/api/inventory/variants/${M.id}/stock`, { type: "ENTRY", quantity: 100 });
check("e não lhe mexe no stock (403)", escrita.status === 403, `${escrita.status}`);

const entregaSemPermissao = await call(coach, "POST", "/api/inventory/assignments", {
  athleteId: atleta.id,
  variantId: M.id,
  quantity: 1,
});
check("nem entrega equipamento (403)", entregaSemPermissao.status === 403, `${entregaSemPermissao.status}`);

/* ====================================================== multi-tenant ==== */

console.log("\n=== O inventário é de um clube só ===");
/*
 * A verificação que mais importa num produto multi-clube. O artigo criado no
 * Life Club não existe para quem entra noutra academia — e não é a aplicação a
 * filtrar: é a política na base de dados a recusar a linha.
 */
const outra = (await db.query(`SELECT slug FROM "Academy" WHERE id <> $1 LIMIT 1`, [academia])).rows[0];
if (outra) {
  const doOutro = await call(director, "GET", `/api/inventory/items/${itemId}`, undefined, outra.slug);
  check(
    `o artigo do Life Club não existe em ${outra.slug} (403/404)`,
    doOutro.status === 403 || doOutro.status === 404,
    `${doOutro.status}`,
  );

  const mexerNoOutro = await call(director, "POST", `/api/inventory/variants/${M.id}/stock`, { type: "ENTRY", quantity: 5 }, outra.slug);
  check("nem se lhe mexe no stock de fora (403/404)", mexerNoOutro.status === 403 || mexerNoOutro.status === 404, `${mexerNoOutro.status}`);
} else {
  console.log("  (só existe uma academia nesta base — salto)");
}

/* ========================================================== arquivo ===== */

console.log("\n=== Arquivar, nunca apagar ===");
const comMaterialNaRua = await call(director, "DELETE", `/api/inventory/items/${ultimo.body.id}`);
check("um artigo com material por devolver não se arquiva (400)", comMaterialNaRua.status === 400, `${comMaterialNaRua.status}`);

/*
 * Recolher o que ficou por devolver antes de arquivar.
 *
 * As devoluções acima foram todas parciais de propósito — é o caso que parte a
 * entrega em duas —, e por isso sobra material na rua. Arquivar aqui falhava, e
 * a falha era do teste: o servidor estava a recusar exactamente o que devia.
 */
const porRecolher = (await call(director, "GET", `/api/inventory/assignments?itemId=${itemId}`)).body;
for (const a of porRecolher) {
  await call(director, "POST", `/api/inventory/assignments/${a.id}/return`, { condition: "GOOD" });
}
check("recolhido o que faltava", porRecolher.length > 0, `${porRecolher.length}`);

const arquivar = await call(director, "DELETE", `/api/inventory/items/${itemId}`);
check("um artigo sem nada na rua arquiva-se", arquivar.status === 200, `${arquivar.status}`);

const linha = await db.query(`SELECT "archivedAt" FROM "InventoryItem" WHERE id = $1`, [itemId]);
check("a linha continua lá, marcada", linha.rowCount === 1 && linha.rows[0].archivedAt !== null);

const movimentosVivos = await db.query(
  `SELECT count(*)::int n FROM "InventoryMovement" m JOIN "InventoryVariant" v ON v.id = m."variantId" WHERE v."itemId" = $1`,
  [itemId],
);
check("e o histórico dele sobrevive", movimentosVivos.rows[0].n > 0, `${movimentosVivos.rows[0].n}`);

const listaDepois = await call(director, "GET", "/api/inventory/items");
check("mas sai da lista", !listaDepois.body.some((i) => i.id === itemId));

/* ======================================================== importação ==== */

console.log("\n=== Importar a folha do armazém ===");
/*
 * Uma linha por tamanho, como se conta uma prateleira — e linhas com o mesmo
 * nome de artigo juntam-se num artigo com vários tamanhos. É a tradução que
 * evita quarenta artigos chamados "T-shirt M", "T-shirt L", "T-shirt XL".
 */
const importado = await call(director, "POST", "/api/inventory/import", {
  rows: [
    { line: 2, name: "ZI Casaco de treino", size: "S", quantity: 4, category: "ZI Vestuário", minimumStock: 2 },
    { line: 3, name: "ZI Casaco de treino", size: "M", quantity: 6, category: "ZI Vestuário" },
    { line: 4, name: "ZI Casaco de treino", size: "L", quantity: 5, category: "ZI Vestuário" },
    // Sem tamanho: fica com a variante "Único". É o caso das bolas.
    { line: 5, name: "ZI Bola n4", quantity: 30, category: "ZI Material" },
  ],
});
check("a folha entra", importado.body?.ok === true, JSON.stringify(importado.body).slice(0, 160));
check("dois artigos, não quatro", importado.body?.created === 2, JSON.stringify(importado.body));

const casaco = (await call(director, "GET", "/api/inventory/items")).body.find((i) => i.name === "ZI Casaco de treino");
check("o casaco tem os três tamanhos", casaco?.variants?.length === 3, JSON.stringify(casaco?.variants?.map((v) => v.label)));
check("e o stock somado", casaco?.total === 15, `${casaco?.total}`);

const bola = (await call(director, "GET", "/api/inventory/items")).body.find((i) => i.name === "ZI Bola n4");
check("um artigo sem tamanho fica com 'Único'", bola?.variants?.[0]?.label === "Único", JSON.stringify(bola?.variants));

/*
 * As categorias novas criam-se — ao contrário dos sócios, onde se pergunta. Uma
 * gaveta do armazém não tem consequências em quotas nem no site.
 */
const categorias = await db.query(`SELECT count(*)::int n FROM "CatalogItem" WHERE kind = 'inventoryCategories' AND label LIKE 'ZI %'`);
check("as categorias da folha são criadas", categorias.rows[0].n === 2, `${categorias.rows[0].n}`);

const stockImportado = await call(director, "GET", `/api/inventory/items/${casaco.id}`);
check(
  "e o stock importado entra no histórico",
  stockImportado.body.movements.filter((m) => m.reason === "Importação").length === 3,
  JSON.stringify(stockImportado.body.movements.length),
);

// Reimportar a mesma folha não duplica: os tamanhos que já lá estão ignoram-se.
const outraVez = await call(director, "POST", "/api/inventory/import", {
  rows: [{ line: 2, name: "ZI Casaco de treino", size: "M", quantity: 99 }],
});
check("reimportar não duplica o artigo", outraVez.body?.created === 0 && outraVez.body?.updated === 1, JSON.stringify(outraVez.body));
const depoisDeReimportar = (await call(director, "GET", "/api/inventory/items")).body.find((i) => i.name === "ZI Casaco de treino");
check("nem o tamanho que já existia", depoisDeReimportar.variants.length === 3 && depoisDeReimportar.total === 15, `${depoisDeReimportar.total}`);

const semNome = await call(director, "POST", "/api/inventory/import", { rows: [{ line: 2, name: "", quantity: 5 }] });
check("uma linha sem artigo é recusada (400)", semNome.status === 400, `${semNome.status}`);

const semPermissaoImport = await call(coach, "POST", "/api/inventory/import", { rows: [{ line: 2, name: "ZI Nada" }] });
check("e um treinador não importa (403)", semPermissaoImport.status === 403, `${semPermissaoImport.status}`);

/* ========================================================= fotografias == */

console.log("\n=== Fotografias ===");
const autorizacao = await call(director, "POST", `/api/inventory/items/${casaco.id}/imagens/url`, {
  contentType: "image/jpeg",
});
check("pede-se um endereço assinado", autorizacao.status === 201 && Boolean(autorizacao.body?.url), `${autorizacao.status}`);
check("com uma chave deste artigo", String(autorizacao.body?.key ?? "").startsWith(`artigos/${casaco.id}/`), autorizacao.body?.key);

const tipoErrado = await call(director, "POST", `/api/inventory/items/${casaco.id}/imagens/url`, {
  contentType: "application/pdf",
});
check("um PDF é recusado (400)", tipoErrado.status === 400, `${tipoErrado.status}`);

/*
 * Confirmar uma chave que não chegou ao armazenamento tem de falhar: senão a
 * ficha ficava com uma imagem que não existe, e o ecrã com um quadrado partido.
 */
const semFicheiro = await call(director, "POST", `/api/inventory/items/${casaco.id}/imagens`, {
  key: `artigos/${casaco.id}/inexistente.jpg`,
});
check("confirmar sem o ficheiro lá é recusado (400)", semFicheiro.status === 400, `${semFicheiro.status}`);

// Uma chave de outro artigo não entra nesta ficha.
const chaveAlheia = await call(director, "POST", `/api/inventory/items/${casaco.id}/imagens`, {
  key: `artigos/${bola.id}/roubada.jpg`,
});
check("uma chave de outro artigo é recusada (400)", chaveAlheia.status === 400, `${chaveAlheia.status}`);

const fotoSemPermissao = await call(coach, "POST", `/api/inventory/items/${casaco.id}/imagens/url`, {
  contentType: "image/jpeg",
});
check("um treinador não carrega fotografias (403)", fotoSemPermissao.status === 403, `${fotoSemPermissao.status}`);

console.log("\n=== A referência escreve-se sozinha ===");
/*
 * Quem regista material não inventa códigos, e um campo em branco fica em branco
 * para sempre. `ET-0001`: prefixo da categoria e sequência — o que se usa em
 * armazém, porque se lê ao telefone e ordena-se sozinho.
 */
const cat = (await db.query(
  `SELECT id, label FROM "CatalogItem" WHERE "academyId" = $1 AND kind = 'inventoryCategories' AND label ILIKE 'Equipamento de treino' LIMIT 1`,
  [academia],
)).rows[0];

const semRef = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Camisola sem referência",
  categoryId: cat?.id,
  variants: [{ label: "M", quantity: 5 }, { label: "L", quantity: 3 }],
});
check("o artigo é criado", semRef.body?.ok === true, JSON.stringify(semRef.body));
check(
  "e ganha uma referência do prefixo da categoria",
  /^ET-\d{4}$/.test(semRef.body?.sku ?? ""),
  semRef.body?.sku,
);

const comVariantes = await call(director, "GET", `/api/inventory/items/${semRef.body.id}`);
/*
 * A variante herda a do artigo com o tamanho colado. É a convenção do retalho, e
 * é o que uma etiqueta precisa: identificar a peça exacta sem cruzar colunas.
 */
check(
  "cada tamanho herda-a com o sufixo",
  comVariantes.body.variants.every((v) => v.sku === `${semRef.body.sku}-${v.label}`),
  JSON.stringify(comVariantes.body.variants.map((v) => v.sku)),
);

// A sequência anda para a frente, não repete.
const segundo = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Segundo sem referência",
  categoryId: cat?.id,
  variants: [{ label: "Único", quantity: 1 }],
});
check("o artigo seguinte leva o número a seguir", segundo.body?.sku !== semRef.body?.sku, `${semRef.body?.sku} e ${segundo.body?.sku}`);
check(
  "e a sequência é crescente",
  Number(/-(\d+)$/.exec(segundo.body.sku)[1]) > Number(/-(\d+)$/.exec(semRef.body.sku)[1]),
  `${semRef.body?.sku} → ${segundo.body?.sku}`,
);

// Sem categoria, o prefixo vem do nome do artigo.
const semCategoria = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Bola de treino",
  variants: [{ label: "Único", quantity: 2 }],
});
check("sem categoria, o prefixo vem do nome", /^ZBT-\d{4}$/.test(semCategoria.body?.sku ?? ""), semCategoria.body?.sku);

// Uma referência escrita à mão manda sobre a gerada.
const refPropria = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Com referência própria",
  sku: "ZI-MINHA-001",
  variants: [{ label: "Único", quantity: 1 }],
});
check("uma referência escrita é respeitada", refPropria.body?.sku === "ZI-MINHA-001", refPropria.body?.sku);

console.log("\n=== A mesma referência é o mesmo artigo ===");
/*
 * Duas referências iguais não são duas coisas: são um registo repetido. Soma-se
 * o stock, sem perguntar — é o que a referência quer dizer. Sem isto, ao fim de
 * uma época o clube tem o mesmo artigo três vezes e nenhum com o número certo.
 */
const outraVezMesmaRef = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Nome completamente diferente",
  sku: "ZI-MINHA-001",
  variants: [{ label: "Único", quantity: 9 }],
});
check("não se cria um segundo", outraVezMesmaRef.body?.merged === true, JSON.stringify(outraVezMesmaRef.body));
check("é o mesmo artigo", outraVezMesmaRef.body?.id === refPropria.body.id);

const somado = await call(director, "GET", `/api/inventory/items/${refPropria.body.id}`);
check("e o stock soma", somado.body.variants[0].total === 10, `${somado.body.variants[0].total}`);
check(
  "com um movimento a explicar de onde veio",
  somado.body.movements.some((m) => m.type === "ENTRY" && m.quantity === 9),
  JSON.stringify(somado.body.movements.map((m) => `${m.type} ${m.quantity}`)),
);

// Um tamanho que o artigo ainda não tinha passa a existir.
const tamanhoNovo = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Com referência própria",
  sku: "ZI-MINHA-001",
  variants: [{ label: "XL", quantity: 4 }],
});
check("um tamanho novo junta-se ao artigo", tamanhoNovo.body?.merged === true);
const comXL = await call(director, "GET", `/api/inventory/items/${refPropria.body.id}`);
check("e passa a existir", comXL.body.variants.some((v) => v.label === "XL" && v.total === 4), JSON.stringify(comXL.body.variants.map((v) => v.label)));

console.log("\n=== O mesmo nome sem referência é uma pergunta ===");
/*
 * Sem referência, o nome é tudo o que há — e um nome repetido tanto pode ser a
 * mesma t-shirt como a de outra época. Quem regista é que sabe; o servidor
 * pergunta e não escreve nada até haver resposta.
 */
const pergunta = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Camisola sem referência",
  categoryId: cat?.id,
  variants: [{ label: "M", quantity: 7 }],
});
check("o servidor pergunta em vez de decidir", pergunta.body?.ok === false, JSON.stringify(pergunta.body));
check("e diz qual é o artigo que já existe", pergunta.body?.conflict?.id === semRef.body.id, JSON.stringify(pergunta.body?.conflict));

const naoMexeu = await call(director, "GET", `/api/inventory/items/${semRef.body.id}`);
check(
  "sem escrever nada enquanto não houver resposta",
  naoMexeu.body.variants.find((v) => v.label === "M").total === 5,
  `${naoMexeu.body.variants.find((v) => v.label === "M").total}`,
);

const juntar = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Camisola sem referência",
  categoryId: cat?.id,
  variants: [{ label: "M", quantity: 7 }],
  onConflict: "merge",
});
check("com 'juntar', soma ao que existe", juntar.body?.merged === true, JSON.stringify(juntar.body));
const juntado = await call(director, "GET", `/api/inventory/items/${semRef.body.id}`);
check("o M passa de 5 para 12", juntado.body.variants.find((v) => v.label === "M").total === 12, `${juntado.body.variants.find((v) => v.label === "M").total}`);

const aparte = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Camisola sem referência",
  categoryId: cat?.id,
  variants: [{ label: "M", quantity: 2 }],
  onConflict: "new",
});
check("com 'criar novo', nasce um artigo à parte", aparte.body?.ok === true && aparte.body?.id !== semRef.body.id, JSON.stringify(aparte.body));
check("com referência própria", aparte.body?.sku !== semRef.body?.sku, `${semRef.body?.sku} e ${aparte.body?.sku}`);

console.log("\n=== Apagar a sério, não só arquivar ===");
/*
 * Arquivar guarda o histórico; apagar leva-o. São perguntas diferentes: uma é
 * "já não usamos isto", a outra é "isto nunca devia ter existido" — o artigo
 * criado a testar, o nome duplicado, a importação com a coluna errada.
 */
const paraApagar = await call(director, "POST", "/api/inventory/items", {
  name: "ZI Artigo a apagar",
  variants: [{ label: "Único", quantity: 5 }],
});
const idApagar = paraApagar.body.id;

const nomeErrado = await call(director, "DELETE", `/api/inventory/items/${idApagar}/definitivo`, {
  confirmName: "outro nome qualquer",
});
check("um nome errado é recusado (400)", nomeErrado.status === 400, `${nomeErrado.status}`);
check(
  "e a mensagem diz o nome certo",
  String(nomeErrado.body?.message ?? "").includes("ZI Artigo a apagar"),
  JSON.stringify(nomeErrado.body?.message),
);
check(
  "depois da recusa o artigo continua lá",
  (await db.query(`SELECT 1 FROM "InventoryItem" WHERE id = $1`, [idApagar])).rowCount === 1,
);

// Material na rua trava: apagar apagaria a prova de que foi entregue, e alguém
// ficava com uma t-shirt que o clube não sabe que deu.
const varApagar = (await call(director, "GET", `/api/inventory/items/${idApagar}`)).body.variants[0];
const entregaBloqueante = await call(director, "POST", "/api/inventory/assignments", {
  athleteId: atleta.id,
  variantId: varApagar.id,
  quantity: 1,
});
const comMaterialFora = await call(director, "DELETE", `/api/inventory/items/${idApagar}/definitivo`, {
  confirmName: "ZI Artigo a apagar",
});
check("com material com atletas é recusado (400)", comMaterialFora.status === 400, `${comMaterialFora.status}`);

await call(director, "POST", `/api/inventory/assignments/${entregaBloqueante.body.id}/return`, { condition: "GOOD" });

const apagado = await call(director, "DELETE", `/api/inventory/items/${idApagar}/definitivo`, {
  confirmName: "  ZI ARTIGO A APAGAR  ",
});
check("o nome confere com espaços e maiúsculas diferentes", apagado.status === 200, `${apagado.status} ${JSON.stringify(apagado.body).slice(0, 120)}`);
check("e a resposta diz o que se perdeu", apagado.body?.movimentos > 0 && apagado.body?.tamanhos === 1, JSON.stringify(apagado.body));

check(
  "a linha desapareceu mesmo",
  (await db.query(`SELECT 1 FROM "InventoryItem" WHERE id = $1`, [idApagar])).rowCount === 0,
);
check(
  "os tamanhos foram com ela",
  (await db.query(`SELECT 1 FROM "InventoryVariant" WHERE "itemId" = $1`, [idApagar])).rowCount === 0,
);
check(
  "e o histórico também — é o que distingue apagar de arquivar",
  (await db.query(`SELECT 1 FROM "InventoryMovement" WHERE "variantId" = $1`, [varApagar.id])).rowCount === 0,
);

const semPermissaoApagar = await call(coach, "DELETE", `/api/inventory/items/${itemId}/definitivo`, {
  confirmName: "seja o que for",
});
check("um treinador não apaga artigos (403)", semPermissaoApagar.status === 403, `${semPermissaoApagar.status}`);

console.log("\n=== Ver e editar são duas permissões ===");
/*
 * Ver quantas t-shirts há e mexer no número são decisões diferentes. Por
 * omissão, o armazém é da primeira pessoa que entra no clube, da presidência e
 * da direção — o coordenador desportivo monta plantéis, não gere material.
 */
const cargoSoLeitura = "zi_role_leitura";
await db.query(`DELETE FROM "AcademyRole" WHERE id = $1`, [cargoSoLeitura]);
await db.query(
  `INSERT INTO "AcademyRole" (id, "academyId", key, name, "baseRole", permissions, "navKeys", "isSystem", rank, "createdAt", "updatedAt")
   VALUES ($1, $2, 'zi-roupeiro', 'ZI Roupeiro', 'STAFF', ARRAY['academy:read','inventory:read'], ARRAY[]::text[], false, 60, now(), now())`,
  [cargoSoLeitura, academia],
);

const membroCoach = (await db.query(
  `SELECT m.id, m."customRoleId" FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE u.email = 'treinador@lifeclub.pt' LIMIT 1`,
)).rows[0];
await db.query(`UPDATE "Membership" SET "customRoleId" = $2 WHERE id = $1`, [membroCoach.id, cargoSoLeitura]);

const soLe = await call(coach, "GET", "/api/inventory/items");
check("com só 'ver', a lista abre", soLe.status === 200, `${soLe.status}`);

const naoMexe = await call(coach, "POST", `/api/inventory/variants/${M.id}/stock`, { type: "ENTRY", quantity: 5 });
check("mas não mexe no stock (403)", naoMexe.status === 403, `${naoMexe.status}`);

const naoEntrega = await call(coach, "POST", "/api/inventory/assignments", {
  athleteId: atleta.id,
  variantId: M.id,
  quantity: 1,
});
check("nem entrega equipamento (403)", naoEntrega.status === 403, `${naoEntrega.status}`);

const naoApaga = await call(coach, "DELETE", `/api/inventory/items/${itemId}/definitivo`, { confirmName: "x" });
check("nem apaga artigos (403)", naoApaga.status === 403, `${naoApaga.status}`);

await db.query(`UPDATE "Membership" SET "customRoleId" = $2 WHERE id = $1`, [membroCoach.id, membroCoach.customRoleId]);
await db.query(`DELETE FROM "AcademyRole" WHERE id = $1`, [cargoSoLeitura]);

/* ------------------------------------------------------------------ limpeza */
await limpar();
await db.end();
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad ? 1 : 0);
