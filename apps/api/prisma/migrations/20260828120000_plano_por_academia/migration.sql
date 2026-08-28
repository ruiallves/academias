-- A lista de academias passa a dizer **qual** é o plano, não só o nome dele.
--
-- ## Porquê
--
-- O painel passou a poder mudar o plano de um clube (ver `setAcademyPlan`), e um
-- selector que não sabe o que está escolhido é um selector que faz escolher às
-- cegas. O nome não serve de identificador: dois planos podem chamar-se o mesmo
-- em anos diferentes, e um nome editado passava a apontar para o plano errado —
-- num ecrã onde a escolha errada muda o que um cliente paga.
--
-- ## Porquê DROP e não CREATE OR REPLACE
--
-- Porque muda o **tipo de retorno** (mais uma coluna), e o Postgres recusa
-- substituir uma função quando isso acontece. O corpo é o mesmo de
-- `20260816000600_platform`, com `s."planId"` acrescentado a seguir ao nome.

DROP FUNCTION IF EXISTS app.platform_academies();

CREATE FUNCTION app.platform_academies()
RETURNS TABLE (
  id              text,
  slug            text,
  name            text,
  status          "AcademyStatus",
  created_at      timestamp(3),
  trial_ends_at   timestamp(3),
  plan_id         text,
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
    s."planId",
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

-- As mesmas permissões que a função tinha antes do DROP — e a mais importante é
-- uma revogação, não um grant: a ligação da aplicação (`academia_app`) **não**
-- pode chamar isto. Quem o faz é o painel, com a ligação dele. Um DROP leva as
-- permissões atrás, e sem esta linha a função renascia aberta a quem não deve.
REVOKE ALL ON FUNCTION app.platform_academies() FROM PUBLIC, academia_app;
