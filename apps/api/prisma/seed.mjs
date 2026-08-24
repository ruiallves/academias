#!/usr/bin/env node
/**
 * Semeia a academia de demonstração — a de verdade, na base de dados.
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
 * ## Porquê o mínimo, e não uma academia inteira
 *
 * Isto substitui `apps/console/src/data/demo.ts`, que gerava 116 atletas para as
 * capturas de ecrã ficarem cheias. Dados a fingir em quantidade escondem o que
 * está partido: com 116 atletas nunca se repara que a assiduidade está a contar
 * mal, com 9 repara-se. O que interessa é que **cada relação exista pelo menos uma
 * vez** — um atleta com encarregado, um treino com faltas registadas e outro por
 * registar, uma mensalidade paga e outra vencida — para nenhum ecrã ficar vazio
 * por falta de dados e nenhum bug se esconder atrás do volume.
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
const PASSWORD = "academia2026";

/** Hoje, à meia-noite. Todas as datas relativas partem daqui. */
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

const day = (n) => new Date(TODAY.getTime() + n * 86_400_000);
const at = (d, hh, mm) => {
  const x = new Date(d);
  x.setHours(hh, mm, 0, 0);
  return x;
};
const iso = (d) => d.toISOString();
/** Datas puras (`@db.Date`) — sem hora, para não apanharem fuso horário. */
const dateOnly = (d) => d.toISOString().slice(0, 10);

/* -------------------------------------------------------------------------- */
/* As pessoas                                                                  */
/* -------------------------------------------------------------------------- */

/** Uma conta por perfil, para se poder ver o produto pelos olhos de cada um. */
const PEOPLE = [
  // O presidente existia como papel e não como pessoa: ninguém na academia
  // semeada tinha `role:write`, e por isso o ecrã de papéis abria sem o botão de
  // criar. Um produto que tem um papel de presidente precisa de deixar alguém sê-lo.
  { key: "pres",  email: "presidente@lifeclub.pt", name: "Joaquim Vilas Boas", role: "OWNER",    title: "Presidente",          dept: "DIRECTION", phone: "919 004 112" },
  { key: "dir",   email: "direcao@lifeclub.pt",   name: "Helena Sá Pereira",  role: "DIRECTOR", title: "Diretora-geral",      dept: "DIRECTION", phone: "914 220 517" },
  { key: "coach", email: "treinador@lifeclub.pt", name: "Rui Machado",        role: "COACH",    title: "Treinador principal", dept: "TECHNICAL", phone: "912 445 108" },
  { key: "coach2",email: "adjunto@lifeclub.pt",   name: "André Peixoto",      role: "COACH",    title: "Treinador adjunto",   dept: "TECHNICAL", phone: "926 771 309" },
  { key: "med",   email: "clinico@lifeclub.pt",   name: "Inês Carvalho Dias", role: "MEDICAL",  title: "Médica desportiva",   dept: "CLINICAL",  phone: "915 772 401" },
  { key: "sec",   email: "secretaria@lifeclub.pt",name: "Cláudia Monteiro",   role: "STAFF",    title: "Secretaria",          dept: "OPERATIONS",phone: "253 210 440" },
  { key: "scout", email: "scouting@lifeclub.pt",  name: "Bruno Aleixo",       role: "SCOUT",    title: "Coordenador de scouting", dept: "SCOUTING", phone: "911 308 664" },
  // Duas famílias: uma com um filho, outra com dois. É o suficiente para a app
  // das famílias ter de escolher entre educandos, que é onde costuma partir-se.
  { key: "pai1",  email: "familia@lifeclub.pt",   name: "Sandra Bragança",    role: "GUARDIAN", title: null, dept: null, phone: "917 442 003" },
  { key: "pai2",  email: "familia2@lifeclub.pt",  name: "Nuno Teixeira",      role: "GUARDIAN", title: null, dept: null, phone: "938 115 726" },
];

/**
 * Nove atletas em dois escalões.
 *
 * Chegam para os ecrãs terem forma e para os casos que interessam existirem: um
 * com a ficha médica a expirar, um de baixa clínica, um em pausa, um sem
 * encarregado associado.
 */
const ATHLETES = [
  { id: "ath_martim",  name: "Martim Bragança",   team: "t_sub11", birth: "2015-03-14", pos: "Médio",        n: 7,  side: "RIGHT", medical: 120, height: 148, weight: 41.5 },
  { id: "ath_leonor",  name: "Leonor Bragança",   team: "t_sub13", birth: "2013-07-02", pos: "Defesa",       n: 4,  side: "LEFT",  medical: 200, height: 158, weight: 47.0 },
  { id: "ath_gustavo", name: "Gustavo Teixeira",  team: "t_sub11", birth: "2015-11-20", pos: "Avançado",     n: 9,  side: "RIGHT", medical: 45,  height: 145, weight: 39.2 },
  { id: "ath_dinis",   name: "Dinis Rocha",       team: "t_sub11", birth: "2015-01-08", pos: "Guarda-redes", n: 1,  side: "RIGHT", medical: 300, height: 152, weight: 44.0 },
  { id: "ath_matilde", name: "Matilde Faria",     team: "t_sub11", birth: "2015-06-25", pos: "Médio",        n: 8,  side: "LEFT",  medical: 18,  height: 143, weight: 37.8 },
  { id: "ath_tomas",   name: "Tomás Vilela",      team: "t_sub11", birth: "2015-09-30", pos: "Defesa",       n: 5,  side: "RIGHT", medical: 210, height: 150, weight: 42.6 },
  { id: "ath_rodrigo", name: "Rodrigo Sá",        team: "t_sub13", birth: "2013-02-17", pos: "Avançado",     n: 11, side: "RIGHT", medical: 160, height: 162, weight: 50.3 },
  { id: "ath_carolina",name: "Carolina Neves",    team: "t_sub13", birth: "2013-05-09", pos: "Médio",        n: 6,  side: "LEFT",  medical: 90,  height: 157, weight: 46.1 },
  // Em pausa: existe, conta para o plantel, não é convocável.
  { id: "ath_afonso",  name: "Afonso Cardoso",    team: "t_sub13", birth: "2013-10-11", pos: "Defesa",       n: 3,  side: "RIGHT", medical: 75,  height: 160, weight: 48.9, status: "PAUSED" },
];

/** Quem é encarregado de quem. Dois atletas ficam sem — é o caso real de fichas por completar. */
const GUARDIANS = [
  { athlete: "ath_martim",   member: "pai1", relation: "Mãe", payer: true },
  { athlete: "ath_leonor",   member: "pai1", relation: "Mãe", payer: true },
  { athlete: "ath_gustavo",  member: "pai2", relation: "Pai", payer: true },
  { athlete: "ath_carolina", member: "pai2", relation: "Tio", payer: false },
];

/* -------------------------------------------------------------------------- */

async function ensureAuthUser(email, name) {
  const create = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { name } }),
  });

  if (create.ok) return { id: (await create.json()).id, created: true };

  // Já existe: a Admin API não tem "get by email" directo, mas filtra na listagem.
  const list = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!list.ok) throw new Error(`Não consegui listar utilizadores: ${await list.text()}`);
  const found = (await list.json()).users.find((u) => u.email === email);
  if (!found) throw new Error(`Não consegui criar nem encontrar ${email}: ${await create.text()}`);
  return { id: found.id, created: false };
}

async function main() {
  const db = new pg.Client({ connectionString: ADMIN_DB, ssl: { rejectUnauthorized: false } });
  await db.connect();

  console.log("Academia…");
  await db.query(
    `INSERT INTO "Academy" (id, slug, name, "shortName", city, "signalColor", "billingDueDay", "updatedAt")
     VALUES ($1,$2,$3,$4,'Braga','#0f6b62',8,now())
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

  console.log("Equipas…");
  await db.query(
    `INSERT INTO "Team" (id,"academyId","sportId","seasonId",name,"ageGroup",schedule,"updatedAt")
     VALUES ('t_sub11',$1,'sp_fut','se_2627','Sub-11 Futebol','Sub-11',
             '[{"weekday":1,"start":"18:00","end":"19:30","venue":"Campo 1"},
               {"weekday":3,"start":"18:00","end":"19:30","venue":"Campo 2"}]'::jsonb, now()),
            ('t_sub13',$1,'sp_fut','se_2627','Sub-13 Futebol','Sub-13',
             '[{"weekday":2,"start":"19:30","end":"21:00","venue":"Campo 2"},
               {"weekday":5,"start":"18:30","end":"20:00","venue":"Campo 1"}]'::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET schedule = EXCLUDED.schedule, "updatedAt" = now()`,
    [ACADEMY.id],
  );

  /*
   * Contas.
   *
   * Os ids de `User` e `Membership` vêm do `RETURNING`, e não das chaves que este
   * script inventa. A diferença importa: se a conta já existir de uma execução
   * anterior, o `ON CONFLICT ("authId")` actualiza a linha que lá está e **mantém o
   * id antigo**. Assumir `usr_<chave>` a seguir rebentava a chave estrangeira da
   * Membership — e, pior, se rebentasse mais à frente ficaria meia academia
   * semeada com ligações a apontar para o vazio.
   */
  console.log("Contas…");
  const userId = {};
  const memId = {};

  for (const p of PEOPLE) {
    const { id, created } = await ensureAuthUser(p.email, p.name);
    console.log(`  ${p.email.padEnd(26)} ${created ? "criada" : "já existia"}`);

    const u = await db.query(
      `INSERT INTO "User" (id,"authId",email,name,phone,"updatedAt")
       VALUES ($1,$2,$3,$4,$5,now())
       ON CONFLICT ("authId") DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, phone = EXCLUDED.phone
       RETURNING id`,
      [`usr_${p.key}`, id, p.email, p.name, p.phone],
    );
    userId[p.key] = u.rows[0].id;

    const m = await db.query(
      `INSERT INTO "Membership" (id,"academyId","userId",role,title,department,"updatedAt")
       VALUES ($1,$2,$3,$4::"Role",$5,$6::"StaffDepartment",now())
       ON CONFLICT ("academyId","userId",role) DO UPDATE SET title = EXCLUDED.title, department = EXCLUDED.department
       RETURNING id`,
      [`mem_${p.key}`, ACADEMY.id, userId[p.key], p.role, p.title, p.dept],
    );
    memId[p.key] = m.rows[0].id;
  }

  // Quem treina o quê — é isto que dá âmbito de dados a um treinador.
  for (const [id, teamId, key, title] of [
    ["ts_rui_11", "t_sub11", "coach", "Treinador principal"],
    ["ts_rui_13", "t_sub13", "coach", "Treinador principal"],
    ["ts_andre_11", "t_sub11", "coach2", "Treinador adjunto"],
  ]) {
    await db.query(
      `INSERT INTO "TeamStaff" (id,"teamId","membershipId",title)
       VALUES ($1,$2,$3,$4) ON CONFLICT ("teamId","membershipId") DO NOTHING`,
      [id, teamId, memId[key], title],
    );
  }

  console.log("Atletas…");
  for (const a of ATHLETES) {
    await db.query(
      `INSERT INTO "Athlete"
         (id,"academyId",name,birthdate,"medicalValidUntil","heightCm","weightKg","dominantSide","squadNumber",status,"joinedAt","updatedAt")
       VALUES ($1,$2,$3,$4::date,$5::date,$6,$7,$8::"DominantSide",$9,$10::"AthleteStatus",$11,now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, "medicalValidUntil" = EXCLUDED."medicalValidUntil", status = EXCLUDED.status`,
      [
        a.id, ACADEMY.id, a.name, a.birth,
        dateOnly(day(a.medical)),
        a.height, a.weight, a.side, a.n,
        a.status ?? "ACTIVE",
        iso(day(-400)),
      ],
    );
    await db.query(
      `INSERT INTO "TeamMembership" (id,"teamId","athleteId",position)
       VALUES ($1,$2,$3,$4) ON CONFLICT ("teamId","athleteId") DO NOTHING`,
      [`tm_${a.id}`, a.team, a.id, a.pos],
    );
  }

  console.log("Famílias…");
  for (const g of GUARDIANS) {
    await db.query(
      `INSERT INTO "GuardianLink" (id,"athleteId","membershipId",relation,"isPayer")
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("athleteId","membershipId") DO NOTHING`,
      [`gl_${g.athlete}_${g.member}`, g.athlete, memId[g.member], g.relation, g.payer],
    );
  }

  /*
   * Treinos.
   *
   * Três estados de propósito, porque são três ecrãs diferentes: passados **com**
   * presenças fechadas, passados **sem** (que é o que alimenta "por registar" e
   * "Precisa de atenção"), e futuros. Semear só os primeiros dava um produto onde
   * a lista de pendências está sempre vazia e ninguém percebe para que serve.
   */
  console.log("Treinos e presenças…");
  const sessions = [];
  for (const [teamId, weekdays, venue] of [
    ["t_sub11", [1, 3], "Campo 1"],
    ["t_sub13", [2, 5], "Campo 2"],
  ]) {
    for (let back = 21; back >= -14; back--) {
      const d = day(-back);
      if (!weekdays.includes(d.getDay())) continue;
      const past = d < TODAY;
      sessions.push({
        id: `ses_${teamId}_${dateOnly(d)}`,
        teamId,
        start: at(d, teamId === "t_sub11" ? 18 : 19, teamId === "t_sub11" ? 0 : 30),
        end: at(d, teamId === "t_sub11" ? 19 : 21, teamId === "t_sub11" ? 30 : 0),
        venue,
        past,
        // Os dois treinos mais recentes ficam por registar — é a pendência real.
        closed: past && back > 4,
      });
    }
  }

  for (const s of sessions) {
    await db.query(
      `INSERT INTO "TrainingSession"
         (id,"academyId","teamId","startsAt","endsAt",venue,"coachId",status,"attendanceClosedAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$9,$7::"SessionStatus",$8,now())
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, "attendanceClosedAt" = EXCLUDED."attendanceClosedAt"`,
      [s.id, ACADEMY.id, s.teamId, iso(s.start), iso(s.end), s.venue, s.past ? "DONE" : "SCHEDULED", s.closed ? iso(s.end) : null, memId.coach],
    );
  }

  // Faltas: guarda-se a excepção, não a norma. Um treino fechado sem registos
  // significa "estiveram todos", que é diferente de "ninguém verificou".
  const roster = (teamId) => ATHLETES.filter((a) => a.team === teamId);
  let absences = 0;
  for (const [i, s] of sessions.filter((x) => x.closed).entries()) {
    const team = roster(s.teamId);
    if (team.length === 0) continue;
    // Um padrão fixo e não aleatório: correr o seed duas vezes tem de dar o mesmo,
    // senão os números da consola mudam sozinhos entre execuções.
    const picks = [
      { a: team[i % team.length], status: "ABSENT" },
      ...(i % 3 === 0 ? [{ a: team[(i + 1) % team.length], status: "JUSTIFIED" }] : []),
      ...(i % 4 === 0 ? [{ a: team[(i + 2) % team.length], status: "LATE" }] : []),
    ];
    for (const p of picks) {
      await db.query(
        `INSERT INTO "AttendanceRecord" (id,"sessionId","athleteId",status,"recordedAt")
         VALUES ($1,$2,$3,$4::"AttendanceStatus",$5)
         ON CONFLICT ("sessionId","athleteId") DO NOTHING`,
        [`att_${s.id}_${p.a.id}`, s.id, p.a.id, p.status, iso(s.end)],
      );
      absences++;
    }
  }

  console.log("Mensalidades…");
  await db.query(
    `INSERT INTO "SubscriptionPlan" (id,"academyId","teamId",name,"amountCents",months,"isActive")
     VALUES ('pl_fut',$1,NULL,'Mensalidade Futebol',4000,ARRAY[1,2,3,4,5,6,7,9,10,11,12],true)
     ON CONFLICT (id) DO NOTHING`,
    [ACADEMY.id],
  );

  /*
   * Duas mensalidades por atleta: o mês anterior liquidado, o corrente em aberto.
   *
   * "Vencida" não é um estado que se escreva — o enum só tem `OPEN`, `SETTLED` e
   * `VOID`. Uma mensalidade está vencida quando está `OPEN` e a data de vencimento
   * já passou, e é o produto que faz essa leitura. É a mesma disciplina do resto do
   * módulo de pagamentos: o estado deriva dos `Payment`, e nada no cliente o
   * escreve directamente. Por isso o atraso semeia-se com uma **data**, não com uma
   * etiqueta.
   */
  const period = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prevMonth = new Date(TODAY.getFullYear(), TODAY.getMonth() - 1, 1);

  for (const [idx, a] of ATHLETES.entries()) {
    await db.query(
      `INSERT INTO "Charge" (id,"academyId","athleteId",period,"amountCents","dueDate",status,"updatedAt")
       VALUES ($1,$2,$3,$4,4000,$5::date,'SETTLED',now())
       ON CONFLICT ("athleteId",period) DO UPDATE SET status = 'SETTLED'`,
      [`ch_${a.id}_prev`, ACADEMY.id, a.id, period(prevMonth), dateOnly(new Date(prevMonth.getFullYear(), prevMonth.getMonth(), 8))],
    );

    // Um terço fica por liquidar; metade desses já com o prazo ultrapassado.
    const unpaid = idx % 3 === 0;
    const late = unpaid && idx % 2 === 0;
    await db.query(
      `INSERT INTO "Charge" (id,"academyId","athleteId",period,"amountCents","dueDate",status,"updatedAt")
       VALUES ($1,$2,$3,$4,4000,$5::date,$6::"ChargeStatus",now())
       ON CONFLICT ("athleteId",period) DO UPDATE SET status = EXCLUDED.status, "dueDate" = EXCLUDED."dueDate"`,
      [`ch_${a.id}_cur`, ACADEMY.id, a.id, period(TODAY), dateOnly(day(late ? -6 : 8)), unpaid ? "OPEN" : "SETTLED"],
    );
  }

  /*
   * Jogos.
   *
   * Três estados, porque são três ecrãs: um já disputado com resultado, um a
   * seguir com convocatória por montar, e um mais adiante. Sem o do meio, a página
   * de convocatórias abria vazia e ninguém percebia para que serve.
   */
  console.log("Jogos…");
  const jogos = [
    ["mt_passado", "t_sub11", -6, "SC Vilarinho", true,  "PLAYED",    3, 1],
    ["mt_proximo", "t_sub11", 4,  "CD Fão",       false, "SCHEDULED", null, null],
    ["mt_seguinte","t_sub13", 6,  "GD Ronfe",     true,  "SCHEDULED", null, null],
  ];
  for (const [id, teamId, offset, opponent, isHome, status, ours, theirs] of jogos) {
    const d = day(offset);
    await db.query(
      `INSERT INTO "Match"
         (id,"academyId","teamId","startsAt","endsAt",venue,opponent,"isHome",status,"ourScore","theirScore","coachId","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::"MatchStatus",$10,$11,$12,now())
       ON CONFLICT (id) DO UPDATE SET "startsAt"=EXCLUDED."startsAt", "endsAt"=EXCLUDED."endsAt", status=EXCLUDED.status`,
      [id, ACADEMY.id, teamId, iso(at(d, 10, 30)), iso(at(d, 12, 0)),
       isHome ? "Campo 1" : "Complexo da Rodovia", opponent, isHome, status, ours, theirs, memId.coach],
    );
  }

  console.log("Boletim clínico…");
  // Um atleta parado: chega para a disponibilidade clínica ser visível em todo o
  // produto — ficha, plantel, convocatórias e "Precisa de atenção".
  // `clearedOn` a nulo é o que mantém a baixa aberta: a disponibilidade do atleta
  // é derivada daqui e não de um campo na ficha dele.
  await db.query(
    `INSERT INTO "ClinicalEntry"
       (id,"academyId","athleteId",kind,impact,status,title,detail,date,"expectedReturn","clearedOn","authorId","updatedAt")
     VALUES ('cl_matilde',$1,'ath_matilde','INJURY'::"ClinicalKind",'OUT'::"ClinicalImpact",'DONE'::"ClinicalStatus",
             'Entorse do tornozelo direito','Grau 1, sem rotura. Trabalho de ginásio autorizado.',
             $2::date,$3::date,NULL,$4,now())
     ON CONFLICT (id) DO NOTHING`,
    [ACADEMY.id, dateOnly(day(-9)), dateOnly(day(12)), memId.med],
  );

  const counts = await db.query(`
    SELECT (SELECT count(*) FROM "Academy")::int academias,
           (SELECT count(*) FROM "User")::int utilizadores,
           (SELECT count(*) FROM "Membership")::int memberships,
           (SELECT count(*) FROM "Team")::int equipas,
           (SELECT count(*) FROM "Athlete")::int atletas,
           (SELECT count(*) FROM "GuardianLink")::int familias,
           (SELECT count(*) FROM "TrainingSession")::int treinos,
           (SELECT count(*) FROM "AttendanceRecord")::int faltas,
           (SELECT count(*) FROM "Charge")::int mensalidades
  `);
  console.log("\n", counts.rows[0]);
  console.log(`  (${absences} registos de falta em ${sessions.filter((s) => s.closed).length} treinos fechados)`);

  console.log(`\nEntrar em: ${ACADEMY.slug}   password: ${PASSWORD}`);
  for (const p of PEOPLE) console.log(`  ${p.role.padEnd(9)} ${p.email}`);

  await db.end();
}

main().catch((error) => {
  console.error("Erro:", error.message);
  process.exit(1);
});
