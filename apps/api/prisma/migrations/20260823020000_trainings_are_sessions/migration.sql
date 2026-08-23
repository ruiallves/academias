-- Um treino é uma sessão, não um evento genérico
--
-- ## O que estava partido
--
-- "Novo evento" com tipo *Treino* escrevia `CalendarEvent`. Mas quem lê treinos
-- lê `TrainingSession`: o ecrã de Presenças, para abrir a folha de faltas, e a
-- **app da família**, que nem sequer pede `/api/events`. O resultado era um treino
-- que o treinador via no calendário, que não abria folha de presenças nenhuma, e
-- que nenhum pai chegava a ver — os treinos que as famílias viam eram só os que
-- vinham do horário da equipa.
--
-- É o mesmo sintoma que os jogos já tinham tido, e a correcção é a mesma: escrever
-- na tabela rica. O serviço passou a fazê-lo; esta migração trata dos que já lá
-- estavam.
--
-- ## O que não se converte
--
-- Treinos sem equipa. `TrainingSession.teamId` é obrigatório — um treino sem
-- plantel não tem quem faltar — e inventar-lhe uma equipa seria pior do que
-- deixá-lo onde está. Ficam como evento genérico e continuam a aparecer no
-- calendário; são raros e são, quase sempre, outra coisa mal classificada.
--
-- Também não se converte o que colidiria com um treino já existente à mesma hora
-- para a mesma equipa: seria trocar uma linha invisível por um erro de horário.

INSERT INTO "TrainingSession" ("id", "academyId", "teamId", "startsAt", "endsAt", "venue", "dressingRoom", "status", "createdAt", "updatedAt")
SELECT
  e."id",
  e."academyId",
  e."teamId",
  e."startsAt",
  e."endsAt",
  e."venue",
  e."dressingRoom",
  -- Um evento cancelado continua cancelado. `SessionStatus` não tem equivalente
  -- para "já aconteceu": isso deriva das presenças, e estes nunca as tiveram.
  (CASE WHEN e."cancelled" THEN 'CANCELLED' ELSE 'SCHEDULED' END)::"SessionStatus",
  e."createdAt",
  e."updatedAt"
FROM "CalendarEvent" e
WHERE e."kind" = 'TRAINING'
  AND e."teamId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "TrainingSession" t
    WHERE t."teamId" = e."teamId" AND t."startsAt" = e."startsAt"
  );

-- Só se apaga o que foi mesmo copiado. O `id` é reaproveitado de propósito: um
-- link guardado para o evento continua a abrir a mesma coisa.
DELETE FROM "CalendarEvent" e
WHERE e."kind" = 'TRAINING'
  AND EXISTS (SELECT 1 FROM "TrainingSession" t WHERE t."id" = e."id");
