#!/usr/bin/env node
/**
 * Põe o horário semanal de uma equipa em cima dos treinos que já estão marcados.
 *
 * O que faz, por esta ordem:
 *
 *   1. **mantém** os treinos futuros que já batem certo com o horário pedido —
 *      um treino que já está à hora certa não se apaga para se criar igual: o
 *      que lhe estiver agarrado (presenças, plano, avisos das famílias) morria
 *      com ele, e o id muda debaixo de quem tenha o link aberto;
 *   2. **apaga** os outros treinos futuros da equipa;
 *   3. **cria** o que falta, semana a semana, até ao fim da época;
 *   4. escreve o horário no `Team.schedule`, para a ficha da equipa passar a
 *      dizer a verdade.
 *
 * O passado nunca é tocado. Um treino que já aconteceu é história — tem
 * presenças lançadas e faz parte da assiduidade de quem lá esteve.
 *
 * ## A coluna guarda UTC, e é preciso saber isso das duas pontas
 *
 * `TrainingSession.startsAt` é `timestamp **without time zone**`: guarda uma hora
 * nua, e quem a lê decide o que ela significa. O servidor corre em UTC e o Prisma
 * lê-a como UTC — portanto a convenção do produto é **gravar UTC**. É o que a
 * consola faz: o browser monta a hora local de quem marca e envia-a em UTC.
 *
 * Este script tem de fazer as duas conversões à mão, e falhou-as das duas vezes
 * na primeira versão:
 *
 *   - **a ler**: o driver entrega um `Date` construído em hora local a partir de
 *     uma hora que é UTC. Um treino gravado às 17:30 (18:30 em Lisboa, no verão)
 *     era lido como 17:30 local — e o relatório dizia que o clube treinava uma
 *     hora mais cedo do que treina. Lê-se o valor como texto e acrescenta-se o
 *     `Z` que lá devia estar;
 *   - **a escrever**: o driver grava um `Date` pela sua hora local, e ficavam
 *     19:30 nus onde deviam estar 18:30. O clube via os treinos uma hora mais
 *     tarde, de Setembro até à mudança da hora. Escreve-se a hora UTC em texto.
 *
 * "19:30" continua a querer dizer 19:30 em Portugal, em Setembro como em Janeiro:
 * a data é montada em hora local e convertida para UTC, e a mudança de Outubro
 * entra sozinha.
 *
 * ## Direto à base, e não pela API
 *
 * De propósito: criar oitenta treinos pela API mandava oitenta notificações às
 * famílias de um clube a sério. Aqui muda-se o calendário em silêncio, que é o
 * que se quer num acerto de horário.
 *
 * Por omissão só **mostra** o que ia fazer. Só com `--aplicar` é que escreve, e
 * aí guarda antes uma cópia das linhas apagadas em `.backups/`.
 *
 * Uso:
 *   node scripts/horario-da-equipa.mjs --clube <slug> --equipa "<nome>" \
 *     --slot seg:19:30-20:30 --slot qui:18:45-20:15 [--ate 2027-06-30] [--aplicar]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(`${k}=`));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

/* ----------------------------- os argumentos ----------------------------- */

const DIAS = { dom: 0, seg: 1, ter: 2, qua: 3, qui: 4, sex: 5, sab: 6 };
const NOME_DIA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

function args() {
  const a = process.argv.slice(2);
  const valor = (nome) => {
    const i = a.indexOf(`--${nome}`);
    return i === -1 ? undefined : a[i + 1];
  };
  const slots = [];
  a.forEach((x, i) => {
    if (x !== "--slot") return;
    const m = /^(dom|seg|ter|qua|qui|sex|sab):(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(a[i + 1] ?? "");
    if (!m) throw new Error(`--slot inválido: ${a[i + 1]} (esperado seg:19:30-20:30)`);
    slots.push({
      weekday: DIAS[m[1]],
      start: `${m[2]}:${m[3]}`,
      end: `${m[4]}:${m[5]}`,
      h1: Number(m[2]), m1: Number(m[3]), h2: Number(m[4]), m2: Number(m[5]),
    });
  });

  const o = {
    clube: valor("clube"),
    equipa: valor("equipa"),
    local: valor("local"),
    ate: valor("ate"),
    slots,
    aplicar: a.includes("--aplicar"),
  };
  if (!o.clube || !o.equipa || o.slots.length === 0) {
    throw new Error("faltam argumentos: --clube <slug> --equipa \"<nome>\" --slot dia:HH:MM-HH:MM");
  }
  return o;
}

const o = args();

/** Quando é que este treino começa e acaba, em hora de Portugal. */
const horas = (dia, slot) => [
  new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), slot.h1, slot.m1, 0, 0),
  new Date(dia.getFullYear(), dia.getMonth(), dia.getDate(), slot.h2, slot.m2, 0, 0),
];

/**
 * O instante de uma hora nua vinda da base.
 *
 * A coluna não tem fuso e o que lá está é UTC; sem este `Z` o `Date` nascia com
 * a hora certa no fuso errado. Ver o cabeçalho.
 */
const instante = (texto) => new Date(`${texto.replace(" ", "T")}Z`);

/** A hora UTC em texto, que é o que a coluna espera receber. */
const utc = (d) => d.toISOString().slice(0, 19).replace("T", " ");

/** A chave de comparação: dia da semana e horas, em hora local. */
const chave = (d) => `${d.getDay()}|${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const chaveSlot = (s) => `${s.weekday}|${s.start}`;
const dataCurta = (d) => d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit", year: "numeric" });
const horaCurta = (d) => d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

/* -------------------------------------------------------------------------- */

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

try {
  const academia = await db.query(`SELECT id, name FROM "Academy" WHERE slug = $1`, [o.clube]);
  if (academia.rowCount === 0) throw new Error(`não há clube com o endereço "${o.clube}"`);
  const { id: academyId, name: clube } = academia.rows[0];

  const equipas = await db.query(
    `SELECT id, name, "seasonId" FROM "Team" WHERE "academyId" = $1 AND name ILIKE $2`,
    [academyId, o.equipa],
  );
  if (equipas.rowCount !== 1) {
    const todas = await db.query(`SELECT name FROM "Team" WHERE "academyId" = $1 ORDER BY name`, [academyId]);
    throw new Error(
      `"${o.equipa}" deu ${equipas.rowCount} equipas. As do clube: ${todas.rows.map((t) => t.name).join(" · ")}`,
    );
  }
  const equipa = equipas.rows[0];

  /* Até quando. A época manda, salvo ordem em contrário. */
  const epoca = await db.query(
    `SELECT label, "endsOn" FROM "Season" WHERE id = $1 OR ("academyId" = $2 AND "isCurrent")
      ORDER BY ("isCurrent")::int DESC LIMIT 1`,
    [equipa.seasonId, academyId],
  );
  /* `endsOn` é uma coluna `date`: o driver devolve um `Date` à meia-noite local.
     Interessa o dia inteiro, por isso o fim é às 23:59 desse dia. */
  const ultimoDia = o.ate ? new Date(`${o.ate}T00:00:00`) : epoca.rows[0]?.endsOn;
  if (!ultimoDia || Number.isNaN(new Date(ultimoDia).getTime())) {
    throw new Error("não consegui saber o fim da época — usa --ate AAAA-MM-DD");
  }
  const d0 = new Date(ultimoDia);
  const fim = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 23, 59, 59);

  /* O sítio: o que a equipa já usa, salvo ordem em contrário. */
  const locais = await db.query(
    `SELECT venue, count(*)::int n FROM "TrainingSession" WHERE "teamId" = $1 GROUP BY venue ORDER BY n DESC LIMIT 1`,
    [equipa.id],
  );
  const local = o.local ?? locais.rows[0]?.venue;
  if (!local) throw new Error("a equipa não tem nenhum treino de onde tirar o local — usa --local \"<nome>\"");

  /* Os treinos por vir. O passado fica onde está. */
  const futuros = await db.query(
    `SELECT id, "startsAt"::text AS inicio_utc, "endsAt"::text AS fim_utc,
            venue, status, notes, "coachId", "dressingRooms"
       FROM "TrainingSession" WHERE "teamId" = $1 AND "startsAt" >= now() ORDER BY "startsAt"`,
    [equipa.id],
  );

  const pedidos = new Set(o.slots.map(chaveSlot));
  const manter = [];
  const apagar = [];
  for (const s of futuros.rows) {
    const inicio = instante(s.inicio_utc);
    const fimS = instante(s.fim_utc);
    const slot = o.slots.find((x) => chaveSlot(x) === chave(inicio));
    // O fim também tem de bater: 19:30–21:00 não é o mesmo treino que 19:30–20:30.
    if (slot && chave(fimS) === `${slot.weekday}|${slot.end}` && s.status !== "CANCELLED") manter.push({ ...s, inicio });
    else apagar.push({ ...s, inicio, fimS });
  }

  /* O que falta criar: semana a semana, do próximo dia em diante. */
  const jaTem = new Set(manter.map((s) => s.inicio.toDateString() + chave(s.inicio)));
  const criar = [];
  const agora = new Date();
  for (const slot of o.slots) {
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    d.setDate(d.getDate() + ((slot.weekday - d.getDay() + 7) % 7));
    for (; d <= fim; d.setDate(d.getDate() + 7)) {
      const [inicio, fimT] = horas(d, slot);
      if (inicio <= agora) continue;
      if (jaTem.has(inicio.toDateString() + chave(inicio))) continue;
      criar.push({ inicio, fim: fimT });
    }
  }
  criar.sort((a, b) => a.inicio - b.inicio);

  /* ------------------------------- o relato ------------------------------ */

  console.log(`\n${clube} · ${equipa.name}`);
  console.log(`Horário pedido: ${o.slots.map((s) => `${NOME_DIA[s.weekday]} ${s.start}–${s.end}`).join(" · ")}`);
  console.log(`Local: ${local}`);
  console.log(`Até: ${dataCurta(fim)}${o.ate ? "" : ` (fim da época ${epoca.rows[0]?.label ?? ""})`}\n`);

  const porPadrao = new Map();
  for (const s of apagar) {
    const k = `${NOME_DIA[s.inicio.getDay()]} ${horaCurta(s.inicio)}–${horaCurta(s.fimS)}`;
    porPadrao.set(k, (porPadrao.get(k) ?? 0) + 1);
  }
  console.log(`Mantém ${manter.length} treinos que já estão à hora certa`);
  console.log(`Apaga  ${apagar.length} treinos futuros:`);
  for (const [k, n] of [...porPadrao].sort((a, b) => b[1] - a[1])) console.log(`         ${n.toString().padStart(3)} × ${k}`);
  console.log(`Cria   ${criar.length} treinos${criar.length ? `, de ${dataCurta(criar[0].inicio)} a ${dataCurta(criar.at(-1).inicio)}` : ""}`);

  const ligados = await db.query(
    `SELECT (SELECT count(*)::int FROM "AttendanceRecord" WHERE "sessionId" = ANY($1)) presencas,
            (SELECT count(*)::int FROM "AbsenceNotice"   WHERE "sessionId" = ANY($1)) avisos,
            (SELECT count(*)::int FROM "SessionBlock"    WHERE "sessionId" = ANY($1)) planos`,
    [apagar.map((s) => s.id)],
  );
  const { presencas, avisos, planos } = ligados.rows[0];
  if (presencas || avisos || planos) {
    console.log(`\nAtenção: o que vai com eles — ${presencas} presenças, ${avisos} avisos de falta, ${planos} blocos de plano`);
  }

  if (!o.aplicar) {
    console.log("\n(ensaio — nada foi escrito. Junta --aplicar para o fazer a sério.)\n");
    process.exit(0);
  }

  /* ------------------------------ a escrita ------------------------------ */

  const pasta = path.join(HERE, ".backups");
  mkdirSync(pasta, { recursive: true });
  const copia = path.join(pasta, `${o.clube}-${equipa.id}-${Date.now()}.json`);
  writeFileSync(copia, JSON.stringify({ clube, equipa, apagados: apagar, criados: criar, slots: o.slots }, null, 2));
  console.log(`\nCópia do que vai ser apagado: ${copia}`);

  await db.query("BEGIN");
  try {
    if (apagar.length) {
      await db.query(`DELETE FROM "TrainingSession" WHERE id = ANY($1)`, [apagar.map((s) => s.id)]);
    }
    for (const c of criar) {
      await db.query(
        `INSERT INTO "TrainingSession" (id,"academyId","teamId","startsAt","endsAt",venue,status,"updatedAt")
         VALUES ($1,$2,$3,$4::timestamp,$5::timestamp,$6,'SCHEDULED'::"SessionStatus",now())`,
        // Em texto UTC, e não o `Date`: o driver gravaria a hora local dele.
        [`ses_${randomBytes(12).toString("hex")}`, academyId, equipa.id, utc(c.inicio), utc(c.fim), local],
      );
    }
    await db.query(`UPDATE "Team" SET schedule = $1::jsonb, "updatedAt" = now() WHERE id = $2`, [
      JSON.stringify(o.slots.map((s) => ({ weekday: s.weekday, start: s.start, end: s.end, venue: local }))),
      equipa.id,
    ]);
    await db.query("COMMIT");
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }

  const final = await db.query(
    `SELECT count(*)::int n, min("startsAt")::text primeiro, max("startsAt")::text ultimo,
            to_char("startsAt",'ID') dia_utc
       FROM "TrainingSession" WHERE "teamId" = $1 AND "startsAt" >= now()
      GROUP BY 4 ORDER BY n DESC`,
    [equipa.id],
  );
  console.log("\nFicou assim (em hora de Portugal, como a app mostra):");
  for (const r of final.rows) {
    const p = instante(r.primeiro);
    console.log(`  ${r.n} × ${NOME_DIA[p.getDay()]} ${horaCurta(p)} — de ${dataCurta(p)} a ${dataCurta(instante(r.ultimo))}`);
  }
  console.log();
} finally {
  await db.end();
}
