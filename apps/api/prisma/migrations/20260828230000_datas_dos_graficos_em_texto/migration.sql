-- As datas dos gráficos passam a sair como **texto**.
--
-- ## O que estava a acontecer
--
-- As duas funções devolviam `date`. O driver `pg` lê uma coluna `date` como um
-- `Date` de JavaScript à **meia-noite local** — por isso a segunda-feira
-- `2026-08-10` chegava ao browser como `2026-08-09T23:00:00.000Z`, num fuso a
-- leste de Greenwich. Dois estragos por causa da mesma linha:
--
--  1. **O eixo do gráfico de actividade dizia `NaN/8`.** O cliente esperava
--     `2026-08-10` e partia a cadeia pelos hífenes; com um timestamp, o terceiro
--     pedaço era `10T23:00:00.000Z` e o dia dava `NaN`.
--
--  2. **Os meses do gráfico de crescimento estavam a um passo de mentir.**
--     `toLocaleDateString` converte de volta para hora local e acerta em Lisboa;
--     a partir de um fuso a oeste, `2026-05-31T23:00Z` lê-se como Maio quando o
--     SQL queria dizer Junho.
--
-- ## Porquê texto e não um `timestamptz`
--
-- Porque estas colunas não são instantes — são **rótulos**. "A semana de 10 de
-- Agosto" e "Junho de 2026" são a mesma coisa em Lisboa e em São Paulo, e
-- qualquer tipo com fuso convida alguém a convertê-las outra vez. Em texto não há
-- nada para converter: `'2026-08-10'` chega ao eixo exactamente como saiu.
--
-- Isto muda a forma das duas funções — ver `PlatformPrisma.resiliente`, que
-- existe precisamente para o `cached plan must not change result type` que um
-- deploy destes provoca nas ligações já abertas.

-- `CREATE OR REPLACE` não chega: o Postgres recusa-se a mudar o tipo de retorno
-- de uma função existente (42P13). Tem mesmo de sair primeiro.
DROP FUNCTION IF EXISTS app.platform_activity(int);

CREATE FUNCTION app.platform_activity(p_weeks int DEFAULT 12)
RETURNS TABLE (
  week      text,
  people    int,
  academies int,
  actions   int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH semanas AS (
    SELECT generate_series(
      date_trunc('week', now()) - make_interval(weeks => p_weeks - 1),
      date_trunc('week', now()),
      '1 week'
    )::date AS w
  ),
  eventos AS (
    SELECT "academyId" AS academia, "coachId"  AS quem, "attendanceClosedAt" AS quando
      FROM "TrainingSession" WHERE "attendanceClosedAt" IS NOT NULL
    UNION ALL
    SELECT "academyId", "authorId", "createdAt" FROM "Announcement"
    UNION ALL
    SELECT "academyId", "coachId",  "createdAt" FROM "Evaluation"
    UNION ALL
    SELECT "academyId", "authorId", "createdAt" FROM "AthleteReport"
    UNION ALL
    SELECT "academyId", "authorId", "createdAt" FROM "ClinicalEntry"
    UNION ALL
    SELECT "academyId", "coachId", "callUpsClosedAt"
      FROM "Match" WHERE "callUpsClosedAt" IS NOT NULL
    UNION ALL
    SELECT "academyId", "coachId", "statsEnteredAt"
      FROM "Match" WHERE "statsEnteredAt" IS NOT NULL
  )
  SELECT
    to_char(semanas.w, 'YYYY-MM-DD'),
    -- `quem` pode ser nulo (um treino sem treinador atribuído, uma entrada
    -- clínica importada). Conta como acção — aconteceu — mas não como pessoa.
    (SELECT count(DISTINCT e.quem)::int FROM eventos e
      WHERE e.quando >= semanas.w AND e.quando < semanas.w + 7),
    (SELECT count(DISTINCT e.academia)::int FROM eventos e
      WHERE e.quando >= semanas.w AND e.quando < semanas.w + 7),
    (SELECT count(*)::int FROM eventos e
      WHERE e.quando >= semanas.w AND e.quando < semanas.w + 7)
  FROM semanas
  ORDER BY semanas.w;
$$;

REVOKE ALL ON FUNCTION app.platform_activity(int) FROM PUBLIC, academia_app;

/* -------------------------------------------------------------------------- */

DROP FUNCTION IF EXISTS app.platform_series(int);

CREATE FUNCTION app.platform_series(p_months int DEFAULT 12)
RETURNS TABLE (month text, new_academies int, cancelled int, active_end int)
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
    to_char(months.m, 'YYYY-MM'),
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

REVOKE ALL ON FUNCTION app.platform_series(int) FROM PUBLIC, academia_app;
