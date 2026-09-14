#!/usr/bin/env node
/**
 * Repõe a hora dos treinos que o `horario-da-equipa.mjs` gravou com o fuso trocado.
 *
 * ## O erro
 *
 * `TrainingSession.startsAt` é `timestamp **without time zone**` e a convenção do
 * produto é guardar lá **UTC** — é o que a consola faz, porque o browser converte
 * a hora local de quem marca antes de a enviar, e é como o Prisma a lê do outro
 * lado. A primeira versão da ferramenta de horários gravou a hora **local**: um
 * treino das 19:30 ficou com 19:30 nus onde deviam estar 18:30, e o clube passou
 * a vê-lo às 20:30.
 *
 * ## Porque é que são duas janelas, e não uma correcção a tudo
 *
 * O erro só se vê enquanto Portugal está em **hora de verão**, que é quando a
 * hora local vai uma hora à frente de UTC. No inverno as duas coincidem, e os
 * treinos desse período ficaram certos por acaso — corrigi-los seria estragá-los.
 *
 * Uma época atravessa essa fronteira duas vezes: de Setembro a 25/10 numa ponta,
 * e de 28/03 a Julho na outra. Por isso a janela vai em argumentos e não numa
 * constante: correr isto duas vezes sobre a mesma janela desloca os treinos mais
 * uma hora, e aí ninguém percebe o que aconteceu.
 *
 * ## Quais são os meus
 *
 * Pelo id **e** pelo clube: a ferramenta gera `ses_…` e a consola gera cuid, mas
 * a seed de desenvolvimento também usa `ses_…`. Sem o clube, isto mexia em
 * treinos de outra academia — e quase o fez.
 *
 * Por omissão só mostra. Escreve com `--aplicar`, e guarda antes o estado
 * anterior em `.backups/`.
 *
 * Uso:
 *   node scripts/corrigir-fuso-treinos.mjs --clube <slug> \
 *     --desde 2027-03-28 --ate 2027-10-31 [--aplicar]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(`${k}=`));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

const APLICAR = process.argv.includes("--aplicar");
const arg = (n) => {
  const v = process.argv[process.argv.indexOf(`--${n}`) + 1];
  return v && !v.startsWith("--") ? v : undefined;
};
const CLUBE = arg("clube");
const DESDE = arg("desde");
const ATE = arg("ate");
if (!CLUBE || !DESDE || !ATE) {
  throw new Error("uso: --clube <slug> --desde AAAA-MM-DD --ate AAAA-MM-DD [--aplicar]");
}

/** Hora nua vinda da base → instante. O que lá está é (ou passa a ser) UTC. */
const instante = (t) => new Date(`${t.replace(" ", "T")}Z`);
const hhmm = (d) => d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });

const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
await db.connect();

try {
  const clube = await db.query(`SELECT id, name FROM "Academy" WHERE slug = $1`, [CLUBE]);
  if (clube.rowCount === 0) throw new Error(`não há clube com o endereço "${CLUBE}"`);
  const academyId = clube.rows[0].id;

  const meus = await db.query(
    `SELECT count(*)::int n FROM "TrainingSession" WHERE id LIKE 'ses\\_%' AND "academyId" = $1`,
    [academyId],
  );
  console.log(`\n${clube.rows[0].name} — treinos criados pela ferramenta: ${meus.rows[0].n}`);

  const alvo = await db.query(
    `SELECT s.id, t.name AS equipa, s."startsAt"::text ini, s."endsAt"::text fim
       FROM "TrainingSession" s JOIN "Team" t ON t.id = s."teamId"
      WHERE s.id LIKE 'ses\\_%' AND s."academyId" = $3
        AND s."startsAt" >= $1 AND s."startsAt" < $2
      ORDER BY s."startsAt"`,
    [DESDE, ATE, academyId],
  );
  console.log(`A corrigir (de ${DESDE} a ${ATE}): ${alvo.rowCount}\n`);

  for (const x of alvo.rows.slice(0, 4)) {
    const antes = instante(x.ini);
    const depois = new Date(antes.getTime() - 3_600_000);
    console.log(
      `  ${x.equipa.padEnd(26)} ${x.ini} → ${depois.toISOString().slice(0, 19).replace("T", " ")}` +
        `   (a app passa a mostrar ${hhmm(depois)} em vez de ${hhmm(antes)})`,
    );
  }
  if (alvo.rowCount > 4) console.log(`  … e mais ${alvo.rowCount - 4}`);

  const fora = await db.query(
    `SELECT count(*)::int n FROM "TrainingSession"
      WHERE id LIKE 'ses\\_%' AND "academyId" = $3 AND ("startsAt" < $1 OR "startsAt" >= $2)`,
    [DESDE, ATE, academyId],
  );
  console.log(`\nFicam como estão (fora da janela): ${fora.rows[0].n}`);

  if (!APLICAR) {
    console.log("\n(ensaio — nada foi escrito. Junta --aplicar.)\n");
    process.exit(0);
  }

  const pasta = path.join(HERE, ".backups");
  mkdirSync(pasta, { recursive: true });
  const copia = path.join(pasta, `correcao-fuso-${CLUBE}-${DESDE}-${Date.now()}.json`);
  writeFileSync(copia, JSON.stringify(alvo.rows, null, 2));
  console.log(`\nEstado anterior guardado em: ${copia}`);

  await db.query("BEGIN");
  try {
    const r = await db.query(
      `UPDATE "TrainingSession"
          SET "startsAt" = "startsAt" - interval '1 hour',
              "endsAt"   = "endsAt"   - interval '1 hour',
              "updatedAt" = now()
        WHERE id LIKE 'ses\\_%' AND "academyId" = $3
          AND "startsAt" >= $1 AND "startsAt" < $2`,
      [DESDE, ATE, academyId],
    );
    await db.query("COMMIT");
    console.log(`Corrigidos: ${r.rowCount}\n`);
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  }
} finally {
  await db.end();
}
