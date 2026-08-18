#!/usr/bin/env node
/**
 * As leituras da consola, contra o servidor a correr.
 *
 * O que interessa aqui não é "o endpoint devolve dados" — é **quem vê o quê**. Um
 * treinador tem de receber só as equipas dele; um encarregado não pode chegar a
 * nenhuma destas rotas; e o departamento clínico vê a academia toda mas não vê
 * mensalidades. É a fronteira de dados que estes testes defendem, porque é onde um
 * erro não dá exceção nenhuma — dá dados a mais para a pessoa errada, em silêncio.
 *
 * Pressupõe `node dist/main.js` a correr em :3000 e `npm run seed` aplicado.
 *
 * Uso: node scripts/test-academy.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function env(key) {
  const line = readFileSync(path.join(HERE, "..", ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`));
  if (!line) throw new Error(`${key} não está em .env`);
  return line.slice(key.length + 1).trim().replace(/^"|"$/g, "");
}

const API = "http://localhost:3000";
const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const ANON = env("SUPABASE_ANON_KEY");
const SLUG = "life-club";
const PASSWORD = "academia2026";

let passed = 0;
let failed = 0;

function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  OK    ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function signIn(email) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login falhou para ${email}: ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).access_token;
}

async function get(token, pathname) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { Authorization: `Bearer ${token}`, "x-academy-slug": SLUG },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function main() {
  const director = await signIn("direcao@lifeclub.pt");
  const coach = await signIn("treinador@lifeclub.pt");
  const adjunto = await signIn("adjunto@lifeclub.pt");
  const medical = await signIn("clinico@lifeclub.pt");
  const parent = await signIn("familia@lifeclub.pt");

  console.log("=== Arranque ===");
  const boot = await get(director, "/api/bootstrap");
  check("a direção arranca", boot.status === 200, JSON.stringify(boot.body).slice(0, 120));
  check("traz a academia", boot.body?.academy?.slug === SLUG);
  check("traz a época corrente", boot.body?.season?.label === "2026/27", `veio ${boot.body?.season?.label}`);
  check("traz as modalidades", (boot.body?.sports ?? []).length >= 2);
  check("e diz quem sou", boot.body?.me?.role === "DIRECTOR" && Boolean(boot.body?.me?.name));

  console.log("\n=== Sem sessão ===");
  const anon = await fetch(`${API}/api/teams`, { headers: { "x-academy-slug": SLUG } });
  check("as leituras estão fechadas", anon.status === 401, `deu ${anon.status}`);

  console.log("\n=== Equipas ===");
  const dirTeams = await get(director, "/api/teams");
  check("a direção vê as equipas", dirTeams.status === 200 && dirTeams.body.length === 2, `${dirTeams.body?.length}`);
  check("com plantel contado", dirTeams.body.every((t) => typeof t.athleteCount === "number"));
  check("e treinadores atribuídos", dirTeams.body.every((t) => t.coaches.length > 0));

  const adjTeams = await get(adjunto, "/api/teams");
  // O André só está atribuído aos Sub-11 — é o caso que prova o âmbito.
  check("o adjunto vê só a equipa dele", adjTeams.body.length === 1, `viu ${adjTeams.body.length}`);
  check("e é a certa", adjTeams.body[0]?.name.includes("Sub-11"), adjTeams.body[0]?.name);

  console.log("\n=== Atletas ===");
  const dirAthletes = await get(director, "/api/athletes");
  check("a direção vê todos", dirAthletes.body.length === 9, `viu ${dirAthletes.body.length}`);

  const adjAthletes = await get(adjunto, "/api/athletes");
  const sub11 = dirTeams.body.find((t) => t.name.includes("Sub-11"));
  check("o adjunto vê só os da sua equipa", adjAthletes.body.length === sub11.athleteCount,
    `viu ${adjAthletes.body.length}, a equipa tem ${sub11.athleteCount}`);
  check("e nenhum de fora do âmbito", adjAthletes.body.every((a) => a.teamId === sub11.id));

  console.log("\n=== Disponibilidade clínica derivada ===");
  const matilde = dirAthletes.body.find((a) => a.name.startsWith("Matilde"));
  check("quem tem baixa aberta aparece parado", matilde?.availability === "out", `veio ${matilde?.availability}`);
  check("com a lesão e o regresso previsto", Boolean(matilde?.restriction?.title && matilde?.restriction?.expectedReturn));
  const saudavel = dirAthletes.body.find((a) => a.name.startsWith("Martim"));
  check("quem não tem boletim está disponível", saudavel?.availability === "available");

  console.log("\n=== Encarregados ligados ===");
  const comFamilia = dirAthletes.body.filter((a) => a.guardians.length > 0);
  check("há atletas com encarregado", comFamilia.length === 4, `${comFamilia.length}`);
  check("com contacto", comFamilia[0]?.guardians[0]?.email?.includes("@"));

  console.log("\n=== Staff ===");
  const staff = await get(director, "/api/staff");
  check("a direção vê o quadro", staff.status === 200 && staff.body.length >= 5, `${staff.body?.length}`);

  /*
   * Verifica-se **quem** está lá, não quantos.
   *
   * O total cresce com quem for convidado a testar o produto — e um teste que
   * fixa o total passa a falhar por uma razão que não é um defeito. O que tem de
   * ser verdade é que toda a gente da seed aparece com o papel certo.
   */
  const esperados = [
    ["Helena Sá Pereira", "DIRECTOR"],
    ["Rui Machado", "COACH"],
    ["André Peixoto", "COACH"],
    ["Inês Carvalho Dias", "MEDICAL"],
    ["Cláudia Monteiro", "STAFF"],
  ];
  for (const [name, role] of esperados) {
    const m = staff.body.find((s) => s.name === name && s.role === role);
    check(`${name.padEnd(20)} aparece como ${role}`, Boolean(m));
  }
  check("sem encarregados à mistura", staff.body.every((s) => s.role !== "GUARDIAN"));
  const rui = staff.body.find((s) => s.name === "Rui Machado");
  check("o treinador traz as equipas dele", rui?.teamIds.length === 2, `${rui?.teamIds.length}`);

  console.log("\n=== Treinos ===");
  const dirSessions = await get(director, "/api/sessions");
  check("a direção vê treinos", dirSessions.body.length > 0, `${dirSessions.body?.length}`);
  check("uns registados e outros não",
    dirSessions.body.some((s) => s.recorded) && dirSessions.body.some((s) => !s.recorded));
  const comFaltas = dirSessions.body.find((s) => s.absences.length > 0);
  check("as faltas vêm em lista, não os presentes", Boolean(comFaltas));

  const adjSessions = await get(adjunto, "/api/sessions");
  check("o adjunto vê só os treinos da sua equipa",
    adjSessions.body.every((s) => s.teamId === sub11.id), `${adjSessions.body.length} treinos`);

  console.log("\n=== Mensalidades ===");
  const fees = await get(director, "/api/charges");
  check("a direção vê mensalidades", fees.status === 200 && fees.body.length === 18, `${fees.body?.length}`);
  check("com vencidas assinaladas", fees.body.some((c) => c.overdue));
  check("e vencida implica em aberto", fees.body.filter((c) => c.overdue).every((c) => c.status === "OPEN"));

  // A regra do produto: financeiro só com permissão explícita.
  const coachFees = await get(coach, "/api/charges");
  check("o treinador não vê mensalidades", coachFees.status === 403, `deu ${coachFees.status}`);

  console.log("\n=== Departamento clínico ===");
  const medAthletes = await get(medical, "/api/athletes");
  check("vê a academia toda", medAthletes.body.length === 9, `viu ${medAthletes.body.length}`);
  const medFees = await get(medical, "/api/charges");
  check("mas não vê mensalidades", medFees.status === 403, `deu ${medFees.status}`);

  console.log("\n=== Encarregado de educação ===");
  // A consola não é para famílias — elas têm a PWA, com o seu próprio âmbito.
  const parentStaff = await get(parent, "/api/staff");
  check("não chega ao quadro de staff", parentStaff.status === 403, `deu ${parentStaff.status}`);
  const parentTeams = await get(parent, "/api/teams");
  check("nem às equipas", parentTeams.status === 403, `deu ${parentTeams.status}`);

  console.log("\n=== Academia errada ===");
  const wrong = await fetch(`${API}/api/teams`, {
    headers: { Authorization: `Bearer ${director}`, "x-academy-slug": "clube-que-nao-existe" },
  });
  check("um slug desconhecido é recusado", wrong.status === 404 || wrong.status === 403, `deu ${wrong.status}`);

  console.log(`\n${passed} passaram, ${failed} falharam`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\nErro:", error.message);
  console.error("O servidor está a correr?  cd apps/api && node dist/main.js\n");
  process.exit(1);
});
