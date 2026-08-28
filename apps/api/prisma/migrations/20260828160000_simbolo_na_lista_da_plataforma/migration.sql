-- O símbolo do clube na lista da plataforma
--
-- ## O que muda
--
-- `app.platform_academies()` passa a devolver `logo_url` e `signal_color`. Nada
-- mais: as mesmas linhas, as mesmas contagens, a mesma ordem.
--
-- ## Porque é que isto não abre nada
--
-- São dois campos de **marca**, não de domínio — a cor e o endereço do emblema,
-- que vivem num bucket público e já vão no `manifest.webmanifest` que qualquer
-- pai descarrega. O painel continua a não ver uma única linha de pessoas: nem
-- nomes de atletas, nem contactos, nem boletins clínicos. A disciplina de
-- `docs/04-plataforma.md` mantém-se.
--
-- ## O REVOKE não é decorativo
--
-- Um `DROP FUNCTION` leva as permissões atrás, e sem a linha do fim a função
-- renascia aberta a `academia_app` — a ligação com que qualquer pedido de uma
-- academia corre. Ela não pode chamar isto: é o painel, com a ligação dele, que
-- vê todas as academias. É a mesma nota da migração que criou esta função, e
-- está repetida aqui de propósito.

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
