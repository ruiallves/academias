-- Platform Admin
--
-- O painel de quem é dono do SaaS. Ver `docs/04-plataforma.md`.
--
-- ## A decisão que esta migração fixa
--
-- Um administrador da plataforma **não é um papel dentro de uma academia**. É uma
-- tabela à parte, sem `academyId`, fora da RLS por tenant e lida por outro guard.
--
-- A alternativa — acrescentar `PLATFORM_ADMIN` ao enum `Role` — parecia mais
-- simples e era um erro. `Role` vive em `Membership`, que é a ligação de uma pessoa
-- a **uma** academia; a RLS, o `contextFor` e todos os filtros de âmbito partem
-- desse princípio. Um papel que significasse "todas as academias" seria um caso
-- especial espalhado por todas essas peças, e bastava uma esquecer-se para o
-- isolamento entre clientes desaparecer — em silêncio, e do lado errado.
--
-- ## Como o painel lê dados sem quebrar a RLS
--
-- Não lê. Chama funções `SECURITY DEFINER` estreitas que devolvem **agregados e
-- metadados de academia** — nunca linhas de domínio. O Platform Admin vê o
-- negócio; não vê os atletas, as famílias nem os boletins clínicos lá dentro.
--
-- É o mesmo padrão de `app.resolve_academy_by_slug` e `app.resolve_invite`, e
-- existe pela mesma razão: a alternativa era dar ao servidor uma ligação com
-- BYPASSRLS, e essa ligação acabaria — como sempre acabam — a ser usada para tudo.

-- ---------------------------------------------------------------------------
-- Estado comercial da academia
-- ---------------------------------------------------------------------------

CREATE TYPE "AcademyStatus" AS ENUM ('SETUP', 'TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED');
CREATE TYPE "PlatformRole" AS ENUM ('OWNER', 'ADMIN', 'SUPPORT');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED');

ALTER TABLE "Academy"
  ADD COLUMN "status" "AcademyStatus" NOT NULL DEFAULT 'SETUP',
  ADD COLUMN "trialEndsAt" TIMESTAMP(3);

-- As academias que já existem estão a ser usadas — não estão em setup.
UPDATE "Academy" SET "status" = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- Tabelas da plataforma
-- ---------------------------------------------------------------------------

CREATE TABLE "PlatformAdmin" (
  "id"            TEXT NOT NULL,
  "authId"        TEXT NOT NULL,
  "email"         TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "role"          "PlatformRole" NOT NULL DEFAULT 'ADMIN',
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "mfaEnrolledAt" TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAdmin_authId_key" ON "PlatformAdmin"("authId");
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

CREATE TABLE "Plan" (
  "id"               TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "amountCents"      INTEGER NOT NULL,
  "perAthleteCents"  INTEGER NOT NULL DEFAULT 0,
  "includedAthletes" INTEGER NOT NULL DEFAULT 0,
  "trialDays"        INTEGER NOT NULL DEFAULT 30,
  "isActive"         BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Subscription" (
  "id"               TEXT NOT NULL,
  "academyId"        TEXT NOT NULL,
  "planId"           TEXT NOT NULL,
  "status"           "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "currentPeriodEnd" TIMESTAMP(3),
  "cancelledAt"      TIMESTAMP(3),
  "lastFailureAt"    TIMESTAMP(3),
  "lastFailureNote"  TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Subscription_academyId_key" ON "Subscription"("academyId");
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

ALTER TABLE "Subscription"
  ADD CONSTRAINT "Subscription_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AuditLog" (
  "id"         TEXT NOT NULL,
  "adminId"    TEXT,
  "action"     TEXT NOT NULL,
  "targetType" TEXT,
  "targetId"   TEXT,
  "detail"     JSONB,
  "ip"         TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_adminId_createdAt_idx" ON "AuditLog"("adminId", "createdAt");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- `SET NULL` e não `CASCADE`: apagar um administrador não pode apagar o rasto do
-- que ele fez. É o ponto de existir um registo.
ALTER TABLE "AuditLog"
  ADD CONSTRAINT "AuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SupportSession" (
  "id"        TEXT NOT NULL,
  "adminId"   TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "reason"    TEXT NOT NULL,
  "ticketId"  TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "endedAt"   TIMESTAMP(3),
  CONSTRAINT "SupportSession_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SupportSession_academyId_startedAt_idx" ON "SupportSession"("academyId", "startedAt");
CREATE INDEX "SupportSession_adminId_startedAt_idx" ON "SupportSession"("adminId", "startedAt");

ALTER TABLE "SupportSession"
  ADD CONSTRAINT "SupportSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Fora do alcance do papel das academias
-- ---------------------------------------------------------------------------
--
-- `academia_app` é o papel com que o servidor serve os pedidos das academias.
-- Não recebe nada nestas tabelas: mesmo que um serviço se enganasse e tentasse
-- lê-las no contexto de um pedido de academia, o Postgres recusa. A migração de
-- RLS deu-lhe SELECT/INSERT/UPDATE/DELETE em *todas* as tabelas do schema, por
-- isso é preciso retirar explicitamente.

REVOKE ALL ON "PlatformAdmin"  FROM academia_app;
REVOKE ALL ON "Plan"           FROM academia_app;
REVOKE ALL ON "Subscription"   FROM academia_app;
REVOKE ALL ON "AuditLog"       FROM academia_app;
REVOKE ALL ON "SupportSession" FROM academia_app;

-- ---------------------------------------------------------------------------
-- Leitura global, por escotilhas estreitas
-- ---------------------------------------------------------------------------

/*
 * O retrato do negócio, numa linha.
 *
 * Só contagens e somatórios. Não devolve o nome de uma academia sequer — para isso
 * há `app.platform_academies()`. A separação é deliberada: esta função é a que a
 * página de entrada chama, e a página de entrada não precisa de saber de ninguém.
 */
CREATE OR REPLACE FUNCTION app.platform_overview()
RETURNS TABLE (
  academies       int,
  setup           int,
  trial           int,
  active          int,
  past_due        int,
  cancelled       int,
  athletes        int,
  guardians       int,
  staff           int,
  mrr_cents       bigint,
  new_this_month  int,
  churn_this_month int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM "Academy")::int,
    (SELECT count(*) FROM "Academy" WHERE status = 'SETUP')::int,
    (SELECT count(*) FROM "Academy" WHERE status = 'TRIAL')::int,
    (SELECT count(*) FROM "Academy" WHERE status = 'ACTIVE')::int,
    (SELECT count(*) FROM "Academy" WHERE status = 'PAST_DUE')::int,
    (SELECT count(*) FROM "Academy" WHERE status = 'CANCELLED')::int,
    (SELECT count(*) FROM "Athlete" WHERE status <> 'LEFT')::int,
    (SELECT count(DISTINCT m.id) FROM "Membership" m WHERE m.role = 'GUARDIAN' AND m."isActive")::int,
    (SELECT count(*) FROM "Membership" WHERE role NOT IN ('GUARDIAN','ATHLETE') AND "isActive")::int,
    -- MRR: só o que está mesmo a pagar. Trials e cancelados não contam — um MRR
    -- que inclui trials é um número que se acredita e depois não aparece no banco.
    COALESCE((
      SELECT sum(p."amountCents" + p."perAthleteCents" * GREATEST(0, ath.n - p."includedAthletes"))
      FROM "Subscription" s
      JOIN "Plan" p ON p.id = s."planId"
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n FROM "Athlete" a WHERE a."academyId" = s."academyId" AND a.status <> 'LEFT'
      ) ath ON true
      WHERE s.status = 'ACTIVE'
    ), 0)::bigint,
    (SELECT count(*) FROM "Academy" WHERE "createdAt" >= date_trunc('month', now()))::int,
    (SELECT count(*) FROM "Subscription" WHERE "cancelledAt" >= date_trunc('month', now()))::int;
$$;

/*
 * Uma linha por academia — metadados e contagens, nada de dentro.
 *
 * `onboarding_done` são os passos concluídos dos oito de `docs/04-plataforma.md`,
 * contados a partir dos dados reais. Derivado a cada leitura e nunca guardado: um
 * número guardado à parte diverge no dia em que alguém apagar uma equipa, e passa
 * a mentir sem ninguém dar por isso.
 */
CREATE OR REPLACE FUNCTION app.platform_academies()
RETURNS TABLE (
  id              text,
  slug            text,
  name            text,
  status          "AcademyStatus",
  created_at      timestamp(3),
  trial_ends_at   timestamp(3),
  plan_name       text,
  sub_status      "SubscriptionStatus",
  mrr_cents       int,
  athletes        int,
  staff           int,
  guardians       int,
  teams           int,
  onboarding_done int,
  last_activity   timestamp(3)
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id, a.slug, a.name, a.status, a."createdAt", a."trialEndsAt",
    p.name,
    s.status,
    COALESCE(p."amountCents" + p."perAthleteCents" * GREATEST(0, cnt.athletes - p."includedAthletes"), 0),
    cnt.athletes, cnt.staff, cnt.guardians, cnt.teams,
    (
      (a.name <> '' AND a."signalColor" IS NOT NULL)::int          -- 2. dados e branding
      + (cnt.sports  > 0)::int                                      -- 3. modalidades
      + (cnt.teams   > 0)::int                                      -- 4. equipas
      + (cnt.coaches > 0)::int                                      -- 5. staff
      + (cnt.athletes > 0)::int                                     -- 7. atletas
      + 1                                                           -- 1. conta criada
    ),
    cnt.last_session
  FROM "Academy" a
  LEFT JOIN "Subscription" s ON s."academyId" = a.id
  LEFT JOIN "Plan" p ON p.id = s."planId"
  LEFT JOIN LATERAL (
    SELECT
      (SELECT count(*) FROM "Athlete" x WHERE x."academyId" = a.id AND x.status <> 'LEFT')::int AS athletes,
      (SELECT count(*) FROM "Membership" x WHERE x."academyId" = a.id AND x.role NOT IN ('GUARDIAN','ATHLETE') AND x."isActive")::int AS staff,
      (SELECT count(*) FROM "Membership" x WHERE x."academyId" = a.id AND x.role = 'GUARDIAN' AND x."isActive")::int AS guardians,
      (SELECT count(*) FROM "Membership" x WHERE x."academyId" = a.id AND x.role = 'COACH' AND x."isActive")::int AS coaches,
      (SELECT count(*) FROM "Team" x WHERE x."academyId" = a.id)::int AS teams,
      (SELECT count(*) FROM "Sport" x WHERE x."academyId" = a.id)::int AS sports,
      -- Sinal de vida: o último treino com presenças fechadas. É o melhor preditor
      -- de renovação neste produto — quem deixa de registar, deixa de renovar.
      (SELECT max(x."attendanceClosedAt") FROM "TrainingSession" x WHERE x."academyId" = a.id) AS last_session
  ) cnt ON true
  ORDER BY a."createdAt" DESC;
$$;

/*
 * Séries mensais para os gráficos: academias novas, canceladas e MRR no fim de
 * cada mês. Um ponto por mês, e nada mais.
 */
CREATE OR REPLACE FUNCTION app.platform_series(p_months int DEFAULT 12)
RETURNS TABLE (month date, new_academies int, cancelled int, active_end int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH months AS (
    SELECT generate_series(
      date_trunc('month', now()) - make_interval(months => p_months - 1),
      date_trunc('month', now()),
      '1 month'
    )::date AS m
  )
  SELECT
    months.m,
    (SELECT count(*) FROM "Academy" a
      WHERE date_trunc('month', a."createdAt")::date = months.m)::int,
    (SELECT count(*) FROM "Subscription" s
      WHERE date_trunc('month', s."cancelledAt")::date = months.m)::int,
    (SELECT count(*) FROM "Academy" a
      WHERE a."createdAt" < (months.m + interval '1 month')
        AND a.status <> 'CANCELLED')::int
  FROM months
  ORDER BY months.m;
$$;

-- Estas funções são para o papel que serve o Platform Admin. `academia_app` — o
-- papel dos pedidos de academia — não as pode executar, e é esse o ponto.
REVOKE ALL ON FUNCTION app.platform_overview()      FROM PUBLIC, academia_app;
REVOKE ALL ON FUNCTION app.platform_academies()     FROM PUBLIC, academia_app;
REVOKE ALL ON FUNCTION app.platform_series(int)     FROM PUBLIC, academia_app;
