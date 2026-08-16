#!/usr/bin/env node
/**
 * Semeia a academia de demonstração e cria as contas de acesso.
 *
 * Duas metades que têm de andar juntas:
 *
 *   1. **Supabase Auth** — as contas propriamente ditas, criadas pela Admin API
 *      com a service-role key. É o Supabase que guarda as passwords; nós nunca
 *      lhes tocamos.
 *   2. **A nossa base** — `User` (espelho do `auth.users`), `Membership` (papel e
 *      academia) e o resto do domínio.
 *
 * O elo é `User.authId = auth.users.id`. Sem ele o login funciona e a pessoa não
 * é ninguém dentro do produto.
 *
 * Idempotente: correr duas vezes não duplica nada.
 *
 * Uso: node prisma/seed.mjs
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

const SUPABASE_URL = env("SUPABASE_URL").replace(/\/$/, "");
const SERVICE_KEY = env("SUPABASE_SERVICE_ROLE_KEY");
const ADMIN_DB = env("MIGRATE_DATABASE_URL");

const ACADEMY = { id: "acd_lifeclub", slug: "life-club", name: "Academia Life Club", short: "Life Club" };

/**
 * As contas de demonstração — uma por perfil, para se poder entrar e ver o
 * produto pelos olhos de cada um.
 */
const PEOPLE = [
  { key: "dir",   email: "direcao@lifeclub.pt",  name: "Helena Sá Pereira",  role: "DIRECTOR", title: "Diretora-geral",   dept: "DIRECTION" },
  { key: "coach", email: "treinador@lifeclub.pt", name: "Rui Machado",       role: "COACH",    title: "Treinador principal", dept: "TECHNICAL" },
  { key: "med",   email: "clinico@lifeclub.pt",  name: "Inês Carvalho Dias", role: "MEDICAL",  title: "Médica desportiva", dept: "CLINICAL" },
  { key: "pai",   email: "familia@lifeclub.pt",  name: "Sandra Bragança",    role: "GUARDIAN", title: null,               dept: null },
];

const PASSWORD = "academia2026";

/** Cria a conta no Supabase, ou devolve a existente. Nunca falha por já existir. */
async function ensureAuthUser(email, name) {
  const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name },
    }),
  });

  if (create.ok) {
    const user = await create.json();
    return { id: user.id, created: true };
  }

  // Já existe: procura-o. A Admin API não tem "get by email" directo, mas
  // filtra na listagem.
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!list.ok) throw new Error(`Não consegui listar utilizadores: ${await list.text()}`);
  const { users } = await list.json();
  const found = users.find((u) => u.email === email);
  if (!found) throw new Error(`Não consegui criar nem encontrar ${email}: ${await create.text()}`);
  return { id: found.id, created: false };
}

async function main() {
  const db = new pg.Client({ connectionString: ADMIN_DB, ssl: { rejectUnauthorized: false } });
  await db.connect();

  console.log("Academia…");
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", city, "updatedAt")
     VALUES ($1,$2,$3,$4,'Braga',now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, "updatedAt" = now()`,
    [ACADEMY.id, ACADEMY.slug, ACADEMY.name, ACADEMY.short],
  );

  console.log("Modalidades e época…");
  await db.query(
    `INSERT INTO "Sport" (id,"academyId",name,positions,skills,"dominantSideLabel","matchMinutes")
     VALUES ('sp_fut',$1,'Futebol',ARRAY['Guarda-redes','Defesa','Médio','Avançado'],
             ARRAY['Técnica','Táctica','Físico','Atitude','Assiduidade'],'Pé dominante',70),
            ('sp_nat',$1,'Natação',ARRAY[]::text[],ARRAY['Técnica','Resistência','Atitude'],NULL,NULL)
     ON CONFLICT (id) DO NOTHING`,
    [ACADEMY.id],
  );
  await db.query(
    `INSERT INTO "Season" (id,"academyId",label,"startsOn","endsOn","isCurrent")
     VALUES ('se_2627',$1,'2026/27','2026-09-01','2027-06-30',true)
     ON CONFLICT (id) DO NOTHING`,
    [ACADEMY.id],
  );
  await db.query(
    `INSERT INTO "Team" (id,"academyId","sportId","seasonId",name,"ageGroup",schedule,"updatedAt")
     VALUES ('t_sub11',$1,'sp_fut','se_2627','Sub-11 Futebol','Sub-11',
             '[{"weekday":1,"start":"18:00","end":"19:30","venue":"Campo 1"}]'::jsonb, now())
     ON CONFLICT (id) DO NOTHING`,
    [ACADEMY.id],
  );

  console.log("Contas…");
  const ids = {};
  for (const p of PEOPLE) {
    const { id, created } = await ensureAuthUser(p.email, p.name);
    ids[p.key] = id;
    console.log(`  ${p.email.padEnd(24)} ${created ? "criada" : "já existia"}`);

    await db.query(
      `INSERT INTO "User" (id,"authId",email,name,"updatedAt")
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT ("authId") DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name`,
      [`usr_${p.key}`, id, p.email, p.name],
    );
    await db.query(
      `INSERT INTO "Membership" (id,"academyId","userId",role,title,department,"updatedAt")
       VALUES ($1,$2,$3,$4::"Role",$5,$6::"StaffDepartment",now())
       ON CONFLICT ("academyId","userId",role) DO UPDATE SET title = EXCLUDED.title`,
      [`mem_${p.key}`, ACADEMY.id, `usr_${p.key}`, p.role, p.title, p.dept],
    );
  }

  console.log("Atleta e ligações…");
  await db.query(
    `INSERT INTO "Athlete" (id,"academyId",name,birthdate,"medicalValidUntil","heightCm","weightKg","dominantSide","squadNumber","updatedAt")
     VALUES ('ath_martim',$1,'Martim Bragança','2015-03-14','2027-01-20',148,41.5,'RIGHT',7,now())
     ON CONFLICT (id) DO NOTHING`,
    [ACADEMY.id],
  );
  await db.query(
    `INSERT INTO "TeamMembership" (id,"teamId","athleteId",position)
     VALUES ('tm_martim','t_sub11','ath_martim','Médio')
     ON CONFLICT ("teamId","athleteId") DO NOTHING`,
  );
  // O treinador fica atribuído à equipa: é isto que lhe dá o âmbito.
  await db.query(
    `INSERT INTO "TeamStaff" (id,"teamId","membershipId",title)
     VALUES ('ts_rui','t_sub11','mem_coach','Treinador principal')
     ON CONFLICT ("teamId","membershipId") DO NOTHING`,
  );
  // E o pai fica ligado ao filho: é isto que lhe dá o dele.
  await db.query(
    `INSERT INTO "GuardianLink" (id,"athleteId","membershipId",relation,"isPayer")
     VALUES ('gl_sandra','ath_martim','mem_pai','Mãe',true)
     ON CONFLICT ("athleteId","membershipId") DO NOTHING`,
  );

  console.log("Mensalidade em aberto…");
  await db.query(
    `INSERT INTO "Charge" (id,"academyId","athleteId",period,"amountCents","dueDate",status,"updatedAt")
     VALUES ('ch_ago',$1,'ath_martim','2026-08',4000,'2026-08-08','OPEN',now())
     ON CONFLICT ("athleteId",period) DO NOTHING`,
    [ACADEMY.id],
  );

  const counts = await db.query(`
    SELECT (SELECT count(*) FROM "Academy")::int academias,
           (SELECT count(*) FROM "User")::int utilizadores,
           (SELECT count(*) FROM "Membership")::int memberships,
           (SELECT count(*) FROM "Athlete")::int atletas
  `);
  console.log("\n", counts.rows[0]);
  console.log(`\nEntrar em: ${ACADEMY.slug}   password: ${PASSWORD}`);
  for (const p of PEOPLE) console.log(`  ${p.role.padEnd(9)} ${p.email}`);

  await db.end();
}

main().catch((error) => {
  console.error("Erro:", error.message);
  process.exit(1);
});
