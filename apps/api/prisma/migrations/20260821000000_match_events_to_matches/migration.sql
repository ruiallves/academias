-- Jogos marcados no calendário que ficaram na tabela errada.
--
-- Durante um período, "Novo evento" com o tipo **Jogo** gravava um
-- `CalendarEvent` de `kind = 'MATCH'`. Mas o ecrã de Convocatórias lê `Match` — a
-- tabela que guarda adversário, convocatória e resultado —, por isso esses jogos
-- existiam no calendário e eram invisíveis para convocar. O código já grava em
-- `Match`; esta migração trata dos que ficaram para trás.
--
-- O adversário não existia como campo: extrai-se do título, que a aplicação
-- compunha como "Jogo vs SCP" ou "@ CD Fão". Quando não há padrão reconhecível
-- fica o título inteiro — é melhor um adversário com nome estranho, visível e
-- corrigível, do que um jogo perdido.
--
-- Jogos sem equipa (`teamId` nulo) ficam de fora: `Match.teamId` é obrigatório e
-- inventar uma equipa era pior do que deixar o evento como está. O código novo já
-- impede criar um jogo sem equipa.

INSERT INTO "Match" (
  id, "academyId", "teamId", "startsAt", "endsAt", venue, opponent, "isHome",
  status, "createdAt", "updatedAt"
)
SELECT
  e.id,
  e."academyId",
  e."teamId",
  e."startsAt",
  e."endsAt",
  e.venue,
  -- "Jogo vs SCP" → "SCP"; "@ CD Fão" → "CD Fão". `regexp_replace` devolve o
  -- título intacto quando não encontra o padrão, e o COALESCE cobre o caso raro
  -- de a limpeza deixar a string vazia — `opponent` é NOT NULL.
  COALESCE(
    NULLIF(trim(regexp_replace(e.title, '^.*?(vs\.?|@)\s*', '', 'i')), ''),
    e.title
  ),
  -- Fora só quando o título o diz explicitamente; em casa é o caso comum.
  CASE WHEN e.title ~* '(^|\s)@' THEN false ELSE true END,
  CASE WHEN e.cancelled THEN 'CANCELLED'::"MatchStatus" ELSE 'SCHEDULED'::"MatchStatus" END,
  e."createdAt",
  now()
FROM "CalendarEvent" e
WHERE e.kind = 'MATCH'
  AND e."teamId" IS NOT NULL
  -- A mesma equipa não joga duas vezes à mesma hora (`@@unique`). Se já existir
  -- um jogo a sério nesse horário, o do calendário era duplicado — não se insere.
  AND NOT EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."teamId" = e."teamId" AND m."startsAt" = e."startsAt"
  );

-- Já vivem em `Match`: manter a cópia em `CalendarEvent` faria o calendário
-- mostrar o mesmo jogo duas vezes, uma delas sem convocatória.
DELETE FROM "CalendarEvent"
WHERE kind = 'MATCH'
  AND "teamId" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."teamId" = "CalendarEvent"."teamId" AND m."startsAt" = "CalendarEvent"."startsAt"
  );
