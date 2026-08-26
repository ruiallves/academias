#!/usr/bin/env node
/**
 * Tickets — do formulário do site até à caixa de entrada da plataforma.
 *
 * O que interessa:
 *
 *  - o formulário do site é **público** e grava campos separados, não um bloco
 *    de texto;
 *  - a caixa de entrada é da plataforma, e ninguém de fora lá chega;
 *  - converter num contacto é um gesto, acontece uma vez, e liga os dois;
 *  - apagar é só do dono.
 *
 * Uso: node scripts/test-tickets.mjs
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
const API = "http://localhost:3000";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

const limpar = async () => {
  await db.query(`DELETE FROM "Ticket" WHERE email LIKE 'zz.%@exemplo.pt'`);
  await db.query(`DELETE FROM "Contact" WHERE email LIKE 'zz.%@exemplo.pt'`);
  await db.query(`DELETE FROM "AuditLog" WHERE action LIKE 'ticket.%' AND detail::text LIKE '%zz.%@exemplo.pt%'`);
};
await limpar();

/* -------------------------------------------------------------------------- */

console.log("=== O site grava, sem sessão nenhuma ===");
const enviar = (body) =>
  fetch(`${API}/api/site/contacto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const r1 = await enviar({
  name: "ZZ Ana Silva",
  email: "zz.ana@exemplo.pt",
  phone: "912345678",
  club: "ZZ Clube do Norte",
  subject: "Experimentar a plataforma",
  subjectId: "experimentar",
  athletes: "180",
  message: "Somos um clube de futebol com sete escalões.",
});
/*
 * 429 aqui não é um defeito — é a proteção a funcionar.
 *
 * O endpoint público aceita cinco pedidos por minuto por IP, e esta suite gasta
 * quatro. Corrê-la duas vezes seguidas bate no limite, e sem esta paragem o
 * resultado eram oito falhas em cascata a apontar para o sítio errado.
 */
if (r1.status === 429) {
  console.log("  PARADO — o limite de 5 pedidos/minuto do formulário está atingido.");
  console.log("  É a proteção contra spam a funcionar. Espera um minuto e corre outra vez.");
  await limpar();
  await db.end();
  process.exit(2);
}
check("o formulário do site aceita sem autenticação", r1.status === 201 || r1.status === 200, `${r1.status}`);

const guardado = (await db.query(
  `SELECT subject, "subjectId", name, email, phone, club, athletes, message, status
   FROM "Ticket" WHERE email = 'zz.ana@exemplo.pt'`,
)).rows[0];

check("nasceu um Ticket", Boolean(guardado));
/*
 * O ponto todo desta mudança.
 *
 * Isto era um `Contact` com "Assunto: … / Atletas: 180 / mensagem" enfiado dentro
 * de um campo `notes`. Um "180" dentro de uma string não se filtra, não se ordena
 * e não se conta — nasce estruturado e chegava desfeito.
 */
check("o assunto ficou em coluna própria", guardado?.subject === "Experimentar a plataforma", guardado?.subject);
check("com o id estável a par do rótulo", guardado?.subjectId === "experimentar", guardado?.subjectId);
check("os atletas ficaram num campo, não numa string", guardado?.athletes === "180", guardado?.athletes);
check("a mensagem ficou inteira", guardado?.message?.includes("sete escalões"), guardado?.message);
check("o telefone e o clube passaram", guardado?.phone === "912345678" && guardado?.club === "ZZ Clube do Norte");
check("e nasce por ver", guardado?.status === "NOVO", guardado?.status);

/*
 * Um `Contact` **não** nasce daqui. Era o que enchia a lista de vendas de
 * curiosos: quem manda uma pergunta não é um negócio até alguém dizer que é.
 */
const semContacto = (await db.query(`SELECT count(*)::int n FROM "Contact" WHERE email = 'zz.ana@exemplo.pt'`)).rows[0].n;
check("e NÃO nasce um contacto no funil", semContacto === 0, `${semContacto}`);

console.log("\n=== Validação e limites ===");
const semNome = await enviar({ name: "Z", email: "zz.mau@exemplo.pt", subject: "Outro assunto" });
check("nome curto recusado (400)", semNome.status === 400, `${semNome.status}`);
const semEmail = await enviar({ name: "ZZ Teste", email: "nao-e-email", subject: "Outro assunto" });
check("email inválido recusado (400)", semEmail.status === 400, `${semEmail.status}`);
const campoExtra = await enviar({
  name: "ZZ Extra", email: "zz.extra@exemplo.pt", subject: "Outro assunto", status: "FECHADO", assigneeId: "x",
});
if (campoExtra.status < 300) {
  const e = (await db.query(`SELECT status, "assigneeId" FROM "Ticket" WHERE email = 'zz.extra@exemplo.pt'`)).rows[0];
  check("campos extra no corpo não passam para a base", e?.status === "NOVO" && e?.assigneeId === null, JSON.stringify(e));
} else {
  check("campos extra no corpo recusados", campoExtra.status === 400, `${campoExtra.status}`);
}

console.log("\n=== A caixa de entrada é da plataforma ===");
const semSessao = await fetch(`${API}/api/platform/tickets`);
check("ler tickets sem sessão é recusado", semSessao.status === 401 || semSessao.status === 403, `${semSessao.status}`);

/*
 * Um utilizador de uma academia não é um administrador da plataforma. O token é
 * válido, a pessoa existe — e mesmo assim não passa, porque o `PlatformGuard`
 * pergunta outra coisa.
 */
const token = (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
  method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
  body: JSON.stringify({ email: "presidente@lifeclub.pt", password: "academia2026" }),
})).json()).access_token;
const porPresidente = await fetch(`${API}/api/platform/tickets`, { headers: { Authorization: `Bearer ${token}` } });
check(
  "o presidente de uma academia não entra na caixa de entrada",
  porPresidente.status === 401 || porPresidente.status === 403,
  `${porPresidente.status}`,
);

/* -------------------------------------------------------------------------- */

const admins = (await db.query(
  `SELECT id, "authId", email, role FROM "PlatformAdmin" WHERE "isActive" = true ORDER BY role LIMIT 1`,
)).rows;

if (admins.length === 0) {
  console.log("\n  SALTA o resto — não há administrador de plataforma activo.");
  console.log("  Cria um em Administradores e corre outra vez.");
} else {
  const admin = admins[0];
  console.log(`\n=== Como ${admin.email} (${admin.role}) ===`);

  /*
   * Entrar como o administrador. Sem a palavra-passe dele, o teste faz o que a
   * aplicação faz — pede um token ao Supabase — e por isso precisa de uma conta
   * com a palavra-passe de demonstração. Se não a tiver, salta em vez de falhar:
   * um teste vermelho por causa de credenciais não ensina nada.
   */
  const at = (await (await fetch(`${S}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email: admin.email, password: "academia2026" }),
  })).json()).access_token;

  if (!at) {
    console.log("  SALTA — não consegui entrar com a palavra-passe de demonstração.");
  } else {
    const call = async (method, p, body) => {
      const r = await fetch(API + p, {
        method,
        headers: { Authorization: `Bearer ${at}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    const lista = await call("GET", "/api/platform/tickets");
    check("o administrador lê a caixa de entrada", lista.status === 200, `${lista.status}`);
    const meu = lista.body?.tickets?.find((t) => t.email === "zz.ana@exemplo.pt");
    check("e o pedido da Ana está lá", Boolean(meu), "");
    check("com a contagem por estado", typeof lista.body?.counts === "object");

    // Por omissão a lista traz só o que está por fechar.
    const fechados = await call("GET", "/api/platform/tickets?estado=FECHADO");
    check(
      "o filtro por estado funciona",
      fechados.status === 200 && !fechados.body.tickets.some((t) => t.status !== "FECHADO"),
      "",
    );

    const busca = await call("GET", "/api/platform/tickets?q=Norte");
    check("a busca encontra pelo clube", busca.body?.tickets?.some((t) => t.email === "zz.ana@exemplo.pt"), "");

    console.log("\n  --- Notas internas ---");
    const comNota = await call("POST", `/api/platform/tickets/${meu.id}/notas`, {
      body: "ZZ Liguei, ficaram de responder.",
    });
    check("escreve uma nota interna", comNota.status === 201 || comNota.status === 200, `${comNota.status}`);
    check("a nota fica com autor", comNota.body?.notes?.[0]?.admin?.id === admin.id, "");
    /*
     * Escrever numa nota é pegar no pedido. Sem isto, um ticket já visto por três
     * pessoas continuava a aparecer como "por ver" — e é assim que se responde
     * duas vezes ou nenhuma.
     */
    check("e passa o pedido de NOVO a ABERTO sozinho", comNota.body?.status === "ABERTO", comNota.body?.status);

    const notaVazia = await call("POST", `/api/platform/tickets/${meu.id}/notas`, { body: " " });
    check("uma nota vazia é recusada (400)", notaVazia.status === 400, `${notaVazia.status}`);

    console.log("\n  --- Estado e responsável ---");
    const atribuido = await call("PATCH", `/api/platform/tickets/${meu.id}`, {
      status: "RESPONDIDO",
      assigneeId: admin.id,
    });
    check("muda o estado", atribuido.body?.status === "RESPONDIDO", atribuido.body?.status);
    check("e atribui a alguém", atribuido.body?.assignee?.id === admin.id, "");

    const desatribuido = await call("PATCH", `/api/platform/tickets/${meu.id}`, { assigneeId: null });
    check("desatribuir com null passa", desatribuido.body?.assignee === null, JSON.stringify(desatribuido.body?.assignee));

    const inventado = await call("PATCH", `/api/platform/tickets/${meu.id}`, { assigneeId: "nao_existe" });
    check("um responsável inventado dá 400 e não 500", inventado.status === 400, `${inventado.status}`);

    const estadoMau = await call("PATCH", `/api/platform/tickets/${meu.id}`, { status: "INVENTADO" });
    check("um estado inventado é recusado (400)", estadoMau.status === 400, `${estadoMau.status}`);

    console.log("\n  --- A ponte para o funil ---");
    const conv = await call("POST", `/api/platform/tickets/${meu.id}/converter`, {});
    check("converte num contacto", conv.status === 201 || conv.status === 200, `${conv.status}`);
    check("e diz que é novo", conv.body?.jaExistia === false, JSON.stringify(conv.body));

    const contacto = (await db.query(
      `SELECT id, name, club, notes, "ownerId" FROM "Contact" WHERE email = 'zz.ana@exemplo.pt'`,
    )).rows[0];
    check("o contacto nasceu com os dados certos", contacto?.name === "ZZ Ana Silva" && contacto?.club === "ZZ Clube do Norte", "");
    check("com a mensagem original nas notas", contacto?.notes?.includes("sete escalões"), "");
    check("e com dono — quem converteu", contacto?.ownerId === admin.id, "");

    const ligado = (await db.query(`SELECT "contactId" FROM "Ticket" WHERE email = 'zz.ana@exemplo.pt'`)).rows[0];
    check("o ticket fica a apontar para o contacto", ligado?.contactId === contacto?.id, "");

    /*
     * Converter duas vezes não pode criar dois contactos. Um duplo-clique num
     * botão é a coisa mais fácil de acontecer, e a lista de vendas com a mesma
     * pessoa duas vezes é trabalho perdido de alguém.
     */
    const outraVez = await call("POST", `/api/platform/tickets/${meu.id}/converter`, {});
    check("converter outra vez devolve o mesmo", outraVez.body?.contactId === contacto?.id && outraVez.body?.jaExistia === true, JSON.stringify(outraVez.body));
    const quantos = (await db.query(`SELECT count(*)::int n FROM "Contact" WHERE email = 'zz.ana@exemplo.pt'`)).rows[0].n;
    check("e continua a haver um contacto só", quantos === 1, `${quantos}`);

    console.log("\n  --- Apagar ---");
    const apagar = await call("DELETE", `/api/platform/tickets/${meu.id}`);
    if (admin.role === "OWNER") {
      check("o dono apaga o pedido", apagar.status === 200, `${apagar.status}`);
      const restam = (await db.query(`SELECT count(*)::int n FROM "Ticket" WHERE email = 'zz.ana@exemplo.pt'`)).rows[0].n;
      check("e some da base", restam === 0, `${restam}`);
      // O contacto sobrevive: apagar o pedido não apaga o negócio que nasceu dele.
      const sobra = (await db.query(`SELECT count(*)::int n FROM "Contact" WHERE email = 'zz.ana@exemplo.pt'`)).rows[0].n;
      check("mas o contacto no funil sobrevive", sobra === 1, `${sobra}`);
    } else {
      check("quem não é dono não apaga (403)", apagar.status === 403, `${apagar.status}`);
    }

    console.log("\n  --- Auditoria ---");
    const registos = (await db.query(
      `SELECT action FROM "AuditLog" WHERE action LIKE 'ticket.%' ORDER BY "createdAt" DESC LIMIT 10`,
    )).rows.map((r) => r.action);
    check("a chegada pelo site ficou registada", registos.includes("ticket.create.site"), registos.join(","));
    check("e a conversão também", registos.includes("ticket.convert"), registos.join(","));
  }
}

console.log("\n=== Limpeza ===");
await limpar();
await db.end();
console.log("  feito");

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);
