#!/usr/bin/env node
/**
 * Um pedido do site avisa quem o atende, e conta-se no menu.
 *
 * ## As duas metades
 *
 * **O email.** Um pedido chega sem ninguém estar à espera dele. Vai para o
 * endereço de `PLATFORM_ALERT_EMAIL` ou, sem ela, para os donos activos — com o
 * pedido inteiro no corpo, para se poder decidir no telemóvel se espera pela
 * segunda-feira.
 *
 * **O contador.** Quem já está dentro da plataforma não tem o email à frente. O
 * número ao lado de "Tickets" responde de relance, de qualquer ecrã — e conta
 * **só o que ninguém abriu**. Contava também os que estavam a ser tratados e os
 * que esperavam resposta de terceiros, e ficava aceso durante dias; um emblema
 * que nunca apaga deixa de se olhar.
 *
 * ## O que este teste protege acima de tudo
 *
 * Que o correio **não** trava o formulário. O ticket é a coisa importante; o
 * aviso é o extra. Com o email por configurar — que é o estado de qualquer
 * ambiente novo — a inscrição tem de passar na mesma.
 *
 * Uso: node scripts/test-ticket-aviso.mjs
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
const SR = env("SUPABASE_SERVICE_ROLE_KEY");
const API = "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const EMAIL = "zz.admin.ticket@exemplo.pt";
const adminApi = (p, init) =>
  fetch(`${S}/auth/v1/admin/users${p}`, {
    ...init,
    headers: { apikey: SR, Authorization: `Bearer ${SR}`, "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

async function limpar() {
  await db.query(`DELETE FROM "Ticket" WHERE name LIKE 'ZZ %'`);
  await db.query(`DELETE FROM "MailLog" WHERE "to" LIKE 'zz.%' OR kind = 'ticket-alert' AND "to" LIKE '%exemplo.pt'`);
  await db.query(`DELETE FROM "PlatformAdmin" WHERE email = $1`, [EMAIL]);
  const lista = await (await adminApi(`?page=1&per_page=200`)).json();
  const antigo = (lista.users ?? []).find((u) => u.email === EMAIL);
  if (antigo) await adminApi(`/${antigo.id}`, { method: "DELETE" });
}
await limpar();

const criado = await (
  await adminApi("", { method: "POST", body: JSON.stringify({ email: EMAIL, password: "academia2026", email_confirm: true }) })
).json();
if (!criado.id) throw new Error("supabase: " + JSON.stringify(criado));
await db.query(
  `INSERT INTO "PlatformAdmin" (id, "authId", email, name, role, "isActive", "createdAt", "updatedAt")
   VALUES ('zz_admin_ticket', $1, $2, 'ZZ Admin Ticket', 'OWNER', true, NOW(), NOW())`,
  [criado.id, EMAIL],
);

const plataforma = (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: "academia2026" }),
})).json()).access_token;

const contar = async () =>
  (await (await fetch(`${API}/api/platform/tickets/por-tratar`, {
    headers: { Authorization: `Bearer ${plataforma}` },
  })).json()).n;

const PEDIDO = {
  name: "ZZ Joana Ferreira",
  email: "zz.joana@exemplo.pt",
  phone: "912345678",
  club: "ZZ Clube do Norte",
  subject: "Quero conhecer a plataforma",
  athletes: "120",
  message: "Boa tarde,\nSomos um clube com 120 atletas e queríamos perceber os preços.\nObrigada.",
};

try {
  console.log("=== O contador antes ===");
  const antes = await contar();
  check("o endpoint responde com um número", Number.isInteger(antes), `${antes}`);

  console.log("\n=== Chega um pedido pelo site ===");
  const r = await fetch(`${API}/api/site/contacto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(PEDIDO),
  });
  check("o formulário do site aceita (sem sessão)", r.status === 201 || r.status === 200, `${r.status}`);

  const guardado = (await db.query(
    `SELECT id, status, club, message FROM "Ticket" WHERE name = $1`, [PEDIDO.name],
  )).rows[0];
  check("o ticket ficou gravado", Boolean(guardado), "");
  check("por tratar", guardado?.status === "NOVO", guardado?.status);
  check("com a mensagem inteira", guardado?.message === PEDIDO.message, JSON.stringify(guardado?.message)?.slice(0, 60));

  console.log("\n=== O contador subiu ===");
  check("mais um por tratar", (await contar()) === antes + 1, `${antes} → ${await contar()}`);

  console.log("\n=== E tentou-se avisar quem atende ===");
  /*
   * O `MailLog` é o registo do que se tentou entregar — e é o que deixa medir
   * isto sem depender de o Resend estar configurado nesta máquina. Num ambiente
   * sem chave, `ok` vem falso com a razão; o que **tem** de existir é a linha.
   */
  const enviado = (await db.query(
    `SELECT "to", kind, ok, reason FROM "MailLog" WHERE kind = 'ticket-alert' ORDER BY "createdAt" DESC LIMIT 1`,
  )).rows[0];
  check("ficou registada uma tentativa de aviso", Boolean(enviado), "sem linha em MailLog");
  check("do tipo certo", enviado?.kind === "ticket-alert", enviado?.kind);
  check("para um endereço a sério", String(enviado?.to ?? "").includes("@"), `${enviado?.to}`);

  /*
   * Para onde, exactamente.
   *
   * Sem `PLATFORM_ALERT_EMAIL`, o aviso ia para o email dos donos tal como está
   * na base — o endereço de trabalho, não o que se lê ao domingo. Quem atende
   * escolhe onde quer ser incomodado, e essa escolha é configuração.
   */
  const destino = (readFileSync(path.join(HERE, "..", ".env"), "utf8")
    .split("\n")
    .find((x) => x.startsWith("PLATFORM_ALERT_EMAIL=")) ?? "")
    .split("=")[1]
    ?.trim()
    .replace(/^"|"$/g, "");

  if (destino) {
    check(
      `vai para o endereço configurado (${destino})`,
      String(enviado?.to ?? "").split(",").map((x) => x.trim()).includes(destino),
      `${enviado?.to}`,
    );
  } else {
    console.log("  (PLATFORM_ALERT_EMAIL por definir — o aviso segue para os donos activos)");
  }
  if (enviado && !enviado.ok) {
    console.log(`  (o envio não saiu: "${enviado.reason}" — o que importa aqui é que se tentou)`);
  }

  console.log("\n=== O ticket não depende do email ===");
  /*
   * A verificação que dá sentido a todas as outras: mesmo que o correio falhe,
   * o pedido está guardado e contado. Quem escreveu não pode receber um erro
   * por causa de uma chave de API que não é problema dele.
   */
  check("o pedido está lá, tenha o email saído ou não", Boolean(guardado), "");
  check("e conta no menu", (await contar()) > antes, "");

  console.log("\n=== O contador é dos que ninguém viu ===");
  /*
   * `ABERTO` e `RESPONDIDO` são trabalho por terminar — e mesmo assim não entram
   * no emblema. O menu não responde a "quanto trabalho tenho?"; responde a
   * "chegou alguma coisa?". Com os três estados, o número ficava aceso com
   * pedidos já lidos à espera de terceiros, e deixava de se olhar.
   */
  for (const estado of ["ABERTO", "RESPONDIDO"]) {
    await db.query(`UPDATE "Ticket" SET status = $2 WHERE id = $1`, [guardado.id, estado]);
    check(`um pedido ${estado} não conta`, (await contar()) === antes, `${await contar()} vs ${antes}`);
  }

  console.log("\n=== Abrir um pedido é vê-lo ===");
  /*
   * Sem isto, um pedido lido e deixado para depois ficava `NOVO` para sempre e o
   * emblema apontava para uma coisa que a pessoa já tinha lido. É a mesma regra
   * que já existia para as notas, aplicada ao gesto mais simples de todos.
   */
  await db.query(`UPDATE "Ticket" SET status = 'NOVO' WHERE id = $1`, [guardado.id]);
  check("de volta a por ver, conta outra vez", (await contar()) === antes + 1, `${await contar()}`);

  const visto = await fetch(`${API}/api/platform/tickets/${guardado.id}/visto`, {
    method: "POST",
    headers: { Authorization: `Bearer ${plataforma}`, "Content-Type": "application/json" },
    body: "{}",
  });
  check("marcar como visto responde ok", visto.status === 201 || visto.status === 200, `${visto.status}`);
  check("o emblema apaga-se", (await contar()) === antes, `${await contar()} vs ${antes}`);

  const depoisDeVer = (await db.query(`SELECT status FROM "Ticket" WHERE id = $1`, [guardado.id])).rows[0];
  check("e o pedido passa a ABERTO", depoisDeVer?.status === "ABERTO", depoisDeVer?.status);

  // Reabrir um pedido fechado para o reler não o pode desfechar: abrir a página
  // não é uma decisão, e os outros estados são-no.
  await db.query(`UPDATE "Ticket" SET status = 'FECHADO' WHERE id = $1`, [guardado.id]);
  await fetch(`${API}/api/platform/tickets/${guardado.id}/visto`, {
    method: "POST",
    headers: { Authorization: `Bearer ${plataforma}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const aindaFechado = (await db.query(`SELECT status FROM "Ticket" WHERE id = $1`, [guardado.id])).rows[0];
  check("abrir um pedido fechado não o reabre", aindaFechado?.status === "FECHADO", aindaFechado?.status);

  console.log("\n=== Tratar um ticket baixa o contador ===");
  check("volta ao que era", (await contar()) === antes, `${await contar()} vs ${antes}`);

  console.log("\n=== A contagem é só para quem é da plataforma ===");
  const semSessao = await fetch(`${API}/api/platform/tickets/por-tratar`);
  check("sem token, recusa", semSessao.status === 401 || semSessao.status === 403, `${semSessao.status}`);

  console.log("\n=== E `por-tratar` não é lido como um id ===");
  /*
   * `@Get(":id")` estava declarado antes. Sem a ordem certa, isto dava 404 — e a
   * causa não estaria no ficheiro onde se ia procurar.
   */
  const comoId = await (await fetch(`${API}/api/platform/tickets/por-tratar`, {
    headers: { Authorization: `Bearer ${plataforma}` },
  })).json();
  check("devolve a contagem e não um ticket", typeof comoId?.n === "number", JSON.stringify(comoId).slice(0, 80));
} finally {
  console.log("\n=== Limpeza ===");
  await limpar();
  const sobra = (await db.query(`SELECT count(*)::int n FROM "Ticket" WHERE name LIKE 'ZZ %'`)).rows[0].n;
  check("sem tickets de teste na base", sobra === 0, `${sobra}`);
  await db.end();
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);
