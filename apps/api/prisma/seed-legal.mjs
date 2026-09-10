#!/usr/bin/env node
/**
 * Publica a versão 1.0 dos documentos legais.
 *
 * Lê `prisma/legal/*.md` (frontmatter + Markdown) e insere cada um como
 * `LegalDocument` publicado, em vigor desde agora. **Idempotente**: um tipo que
 * já tenha essa versão na base é deixado como está — nunca se reescreve o texto
 * de uma versão que alguém possa já ter aceite.
 *
 * ## Porque é um seed e não a migração
 *
 * Porque publicar um documento é o gesto que **liga o gate**: a partir daí, quem
 * ainda não o aceitou fica à porta na próxima entrada. A migração cria as
 * tabelas e não bloqueia ninguém; publicar é uma decisão à parte, tomada de
 * propósito, com a API e as apps já actualizadas. Ver `prisma/legal/LEIA-ME.md`.
 *
 * Os textos ainda não passaram por advogado — está dito lá.
 *
 * Uso: npm run seed:legal            publica o que falta
 *      npm run seed:legal -- --dry-run  só lê os ficheiros e diz o que faria
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const env = (k) => {
  const l = readFileSync(path.join(HERE, "..", ".env"), "utf8").split("\n").find((x) => x.startsWith(k + "="));
  if (!l) throw new Error(`${k} não está em .env`);
  return l.slice(k.length + 1).trim().replace(/^"|"$/g, "");
};

/*
 * Os valores por omissão do catálogo (`src/legal/legal.catalog.ts`), repetidos
 * aqui porque o seed corre sem compilar o servidor. Se mudarem lá, mudam aqui.
 */
const DEFAULTS = {
  TERMS_OF_SERVICE: { scope: "CLUB", audiences: ["CLUB_OWNER"], acceptanceKind: "ACCEPT" },
  TERMS_OF_USE: { scope: "USER", audiences: ["STAFF", "FAMILY", "MEMBER"], acceptanceKind: "ACCEPT" },
  PRIVACY_POLICY: { scope: "USER", audiences: ["CLUB_OWNER", "STAFF", "FAMILY", "MEMBER"], acceptanceKind: "ACKNOWLEDGE" },
  COOKIE_POLICY: { scope: "USER", audiences: [], acceptanceKind: "NONE" },
  DPA: { scope: "CLUB", audiences: ["CLUB_OWNER"], acceptanceKind: "ACCEPT" },
  ACCEPTABLE_USE: { scope: "USER", audiences: ["CLUB_OWNER", "STAFF", "FAMILY", "MEMBER"], acceptanceKind: "ACCEPT" },
  ACADEMIAS_AI_TERMS: { scope: "CLUB", audiences: ["CLUB_OWNER"], acceptanceKind: "ACCEPT" },
  DATA_RETENTION_POLICY: { scope: "USER", audiences: [], acceptanceKind: "NONE" },
};

function parse(file) {
  const raw = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`${path.basename(file)}: falta o frontmatter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  for (const k of ["type", "version", "title"]) if (!meta[k]) throw new Error(`${path.basename(file)}: falta "${k}"`);
  if (!DEFAULTS[meta.type]) throw new Error(`${path.basename(file)}: tipo desconhecido ${meta.type}`);
  return { ...meta, content: m[2].trim() + "\n" };
}

const cuid = () => "lgl_" + randomBytes(10).toString("hex");
const DRY = process.argv.includes("--dry-run");

async function main() {
  const db = new pg.Client({ connectionString: env("MIGRATE_DATABASE_URL"), ssl: { rejectUnauthorized: false } });
  await db.connect();

  const dir = path.join(HERE, "legal");
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "LEIA-ME.md").sort();

  for (const f of files) {
    const doc = parse(path.join(dir, f));
    const d = DEFAULTS[doc.type];
    const existe = await db.query(`SELECT id, status FROM "LegalDocument" WHERE type = $1 AND version = $2`, [doc.type, doc.version]);
    if (existe.rows.length) {
      console.log(`  =     ${doc.type} v${doc.version} já existe (${existe.rows[0].status}) — não toco`);
      continue;
    }
    const hash = createHash("sha256").update(doc.content, "utf8").digest("hex");
    if (DRY) {
      console.log(`  ~     ${doc.type} v${doc.version} — publicaria "${doc.title}" (${doc.content.length} chars, ${d.scope}, ${d.audiences.join("/") || "sem audiência"}, ${d.acceptanceKind})`);
      continue;
    }
    await db.query(
      `INSERT INTO "LegalDocument"
         (id, type, version, title, summary, content, "contentHash", status, scope, audiences, "acceptanceKind",
          "effectiveAt", "publishedAt", "changeNote", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PUBLISHED', $8, $9::"LegalAudience"[], $10, now(), now(), $11, now(), now())`,
      [cuid(), doc.type, doc.version, doc.title, doc.summary ?? null, doc.content, hash, d.scope, d.audiences, d.acceptanceKind, doc.changeNote ?? "Primeira versão."],
    );
    console.log(`  +     ${doc.type} v${doc.version} publicado — ${doc.title}`);
  }

  await db.end();
  console.log(DRY ? "\nSimulação — nada foi escrito." : "\nFeito. A partir de agora quem entrar sem aceitar vê o gate.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
