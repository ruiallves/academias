#!/usr/bin/env node
/**
 * Gera um convite a sério, a partir da linha de comandos.
 *
 * Existe porque a consola ainda corre com dados de demonstração: o link que ela
 * mostra é gerado no browser e nunca chega à base de dados, por isso não abre.
 * Este script fala com a API verdadeira — autentica-se como a direção, cria o
 * convite, e imprime o link que funciona mesmo.
 *
 * Precisa do servidor a correr:  node dist/main.js
 *
 * Uso:
 *   node scripts/invite.mjs                                  (treinador, Sub-11)
 *   node scripts/invite.mjs "Ana Lopes" ana@exemplo.pt
 *   node scripts/invite.mjs "Ana Lopes" ana@exemplo.pt MEDICAL
 *
 * Para ver as equipas disponíveis:  node scripts/invite.mjs --equipas
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function env(key) {
  const line = readFileSync(path.join(HERE, "..", ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} não está em .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

const API = process.env.API_URL ?? "http://localhost:3000";
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SLUG = "life-club";

const [, , ...args] = process.argv;

async function teams() {
  const db = new pg.Client({
    connectionString: env("MIGRATE_DATABASE_URL"),
    ssl: { rejectUnauthorized: false },
  });
  await db.connect();
  const rows = await db.query(
    `SELECT id, name, "maxAge" FROM "Team" WHERE "academyId" = 'acd_lifeclub' ORDER BY name`,
  );
  await db.end();
  return rows.rows;
}

async function main() {
  if (args[0] === "--equipas") {
    console.table(await teams());
    return;
  }

  const name = args[0] ?? "Treinador de Teste";
  const email = args[1] ?? `convite-${Date.now()}@exemplo.pt`;
  const role = args[2] ?? "COACH";

  // Só quem trabalha com equipas leva âmbito. Um médico vê a academia toda.
  const teamIds = role === "COACH" || role === "STAFF" ? (await teams()).slice(0, 1).map((t) => t.id) : [];

  const auth = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "direcao@lifeclub.pt", password: "academia2026" }),
  });
  if (!auth.ok) throw new Error(`não consegui entrar como direção: ${(await auth.text()).slice(0, 140)}`);
  const { access_token } = await auth.json();

  const res = await fetch(`${API}/api/invites`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access_token}`,
      // Em produção a academia vem do subdomínio; em localhost, deste cabeçalho.
      "x-academy-slug": SLUG,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, email, role, title: "Treinador adjunto", department: "TECHNICAL", teamIds }),
  });

  const body = await res.json();
  if (!res.ok) {
    console.error("Não foi possível criar o convite:", body.message ?? body);
    process.exit(1);
  }

  console.log(`\n  ${name}  ·  ${email}  ·  ${role}`);
  console.log(`  equipas: ${teamIds.length || "nenhuma"}`);
  console.log(`  válido até: ${new Date(body.expiresAt).toLocaleString("pt-PT")}\n`);
  console.log(`  ${body.link}\n`);
  console.log(`  Abre no browser. Password nova (mín. 8 caracteres) e a conta fica criada.\n`);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  console.error("O servidor está a correr?  cd apps/api && node dist/main.js\n");
  process.exit(1);
});
