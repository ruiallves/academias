-- O preço individual passa a ser por modalidade.
--
-- Um atleta que pratica futebol e futsal paga a soma das duas mensalidades, e o
-- ajuste individual deixa de ser um valor para o atleta inteiro: passa a ser
-- "no futsal paga 15 €", sem mexer no futebol. Ver `lerPrecosDosAtletas`.

ALTER TABLE "SubscriptionPlan" ADD COLUMN "sportId" TEXT;

ALTER TABLE "SubscriptionPlan"
  ADD CONSTRAINT "SubscriptionPlan_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SubscriptionPlan_sportId_idx" ON "SubscriptionPlan"("sportId");

-- Os ajustes que já existem passam para a modalidade do atleta.
--
-- Só quando não há dúvida: um plano individual com uma inscrição viva, de um
-- atleta que está em equipas de **uma** modalidade. Quem não tem equipa fica
-- como estava, com o valor único (nulo), que é o que continua a valer para ele.
-- Hoje nenhum atleta está em duas modalidades, por isso isto apanha todos os
-- que têm equipa.
UPDATE "SubscriptionPlan" p
SET "sportId" = x."sportId"
FROM (
  SELECT e."planId", MIN(t."sportId") AS "sportId"
  FROM "Enrollment" e
  JOIN "TeamMembership" tm ON tm."athleteId" = e."athleteId" AND tm."leftAt" IS NULL
  JOIN "Team" t ON t.id = tm."teamId"
  WHERE e."endsOn" IS NULL OR e."endsOn" >= CURRENT_DATE
  GROUP BY e."planId"
  HAVING COUNT(DISTINCT t."sportId") = 1
) x
WHERE p.id = x."planId"
  AND p."teamId" IS NULL;
