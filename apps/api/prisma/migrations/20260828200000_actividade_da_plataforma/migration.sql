-- Actividade da plataforma: quantas pessoas trabalharam, e quanto trabalho fizeram.
--
-- ## Porque é que isto substitui "entradas e saídas"
--
-- O gráfico de churn responde a "quantos clubes entraram e saíram por mês". Com
-- meia dúzia de clubes e nenhuma saída, é uma barra a zero repetida doze vezes —
-- ocupa metade da página para dizer nada. É um gráfico para quando houver
-- rotação; hoje não há.
--
-- A pergunta que hoje importa é outra, e é a que decide se haverá rotação
-- amanhã: **as pessoas estão a usar isto?**
--
-- ## Porque é que não conta sessões abertas
--
-- A presença ao vivo (ver `presence.service.ts`) vive em memória e não tem
-- história: sabe quem está agora, não quem esteve em Março. E `lastSeenAt` é uma
-- data só — diz quando alguém apareceu pela última vez, não quantas vezes.
--
-- Um registo diário de presenças daria a métrica exacta, e daria-a **vazia**:
-- começaria no dia do deploy e levaria meses a ter forma. Isto conta trabalho
-- que já está registado, e por isso tem história desde o primeiro dia.
--
-- ## O que conta como uma acção
--
-- Só coisas que alguém teve mesmo de fazer, com um autor e uma data:
--
--   * fechar uma folha de presenças        (`TrainingSession.attendanceClosedAt`)
--   * escrever um comunicado               (`Announcement`)
--   * escrever uma avaliação               (`Evaluation`)
--   * escrever um relatório                (`AthleteReport`)
--   * registar uma entrada clínica         (`ClinicalEntry`)
--   * fechar uma convocatória              (`Match.callUpsClosedAt`)
--   * preencher uma ficha de jogo          (`Match.statsEnteredAt`)
--
-- Abrir a app não conta. É de propósito: a pergunta é se o produto está a fazer
-- trabalho, e um separador aberto não é trabalho. Uma família a consultar a
-- agenda também não entra — é uso legítimo, mas não é o que prende um clube.
--
-- ## Semanas, não meses
--
-- O trabalho de um clube tem ritmo semanal: treina, joga, fecha presenças. Em
-- meses, doze pontos escondem a única coisa que interessa ver — a semana em que
-- um clube parou.

CREATE OR REPLACE FUNCTION app.platform_activity(p_weeks int DEFAULT 12)
RETURNS TABLE (
  week      date,
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
    semanas.w,
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

-- Como as outras funções do painel: só o papel que serve o Platform Admin.
REVOKE ALL ON FUNCTION app.platform_activity(int) FROM PUBLIC, academia_app;
