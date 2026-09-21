-- O preço acordado com um clube
--
-- ## O que muda
--
-- `Subscription` ganha `priceCents`: a mensalidade que **este** clube paga,
-- quando não é a de tabela. Nulo é o caso normal — vale o plano.
--
-- ## Porque é que não fica só no contrato
--
-- A ordem de adesão já guardava o valor (`SubscriptionOrder.listMonthlyCents`),
-- e era tentador deixá-lo só lá: o papel que o clube assina diz o que o clube
-- paga. Mas o painel calcula o MRR a partir do **plano**, e um clube com preço
-- negociado passava a contar pelo preço de tabela — o número que se olha todos
-- os dias ficava a dizer uma receita que não entra no banco.
--
-- Por isso o preço vive na subscrição, que é o que representa a relação
-- comercial viva, e as duas funções do painel passam a preferi-lo. O contrato
-- continua a guardar o seu instantâneo: reemitir repete o papel que esteve em
-- cima da mesa, mesmo que o acordo tenha mudado depois.
--
-- ## O preço acordado substitui a fórmula inteira
--
-- Incluindo a parte por atleta. Quem escreve um valor à mão está a dizer "este
-- clube paga isto", e somar-lhe extras por atleta era devolver pela janela a
-- negociação que acabou de se fazer pela porta.
--
-- ## O REVOKE não é decorativo
--
-- Um `DROP FUNCTION` leva as permissões atrás, e sem a linha do fim a função
-- renascia aberta a `academia_app` — a ligação com que qualquer pedido de uma
-- academia corre. Ela não pode chamar isto: é o painel, com a ligação dele, que
-- vê todas as academias. É a mesma nota das migrações anteriores, repetida aqui
-- de propósito.

ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "priceCents" INTEGER;

-- ---------------------------------------------------------------------------
-- O total do painel
-- ---------------------------------------------------------------------------

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
    -- O preço acordado com o clube manda; sem ele, a tabela do plano.
    COALESCE((
      SELECT sum(COALESCE(
        s."priceCents",
        p."amountCents" + p."perAthleteCents" * GREATEST(0, ath.n - p."includedAthletes")
      ))
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

-- ---------------------------------------------------------------------------
-- A lista de clubes
-- ---------------------------------------------------------------------------
--
-- Ganha `price_cents` para o painel poder abrir o diálogo do plano já com o que
-- está acordado — sem isso, reabrir a janela propunha outra vez o preço de
-- tabela e a segunda gravação desfazia a primeira sem ninguém pedir.

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
  price_cents     int,
  athletes        int,
  staff           int,
  guardians       int,
  teams           int,
  onboarding_done int,
  last_activity   timestamp(3),
  logo_url        text,
  signal_color    text
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    a.id, a.slug, a.name, a.status, a."createdAt", a."trialEndsAt",
    s."planId",
    p.name,
    s.status,
    COALESCE(
      s."priceCents",
      p."amountCents" + p."perAthleteCents" * GREATEST(0, cnt.athletes - p."includedAthletes"),
      0
    ),
    s."priceCents",
    cnt.athletes, cnt.staff, cnt.guardians, cnt.teams,
    (
      (a.name <> '' AND a."signalColor" IS NOT NULL)::int          -- 2. dados e branding
      + (cnt.sports  > 0)::int                                      -- 3. modalidades
      + (cnt.teams   > 0)::int                                      -- 4. equipas
      + (cnt.coaches > 0)::int                                      -- 5. staff
      + (cnt.athletes > 0)::int                                     -- 7. atletas
      + 1                                                           -- 1. conta criada
    ),
    cnt.last_session,
    a."logoUrl",
    a."signalColor"
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

REVOKE ALL ON FUNCTION app.platform_academies() FROM PUBLIC, academia_app;
