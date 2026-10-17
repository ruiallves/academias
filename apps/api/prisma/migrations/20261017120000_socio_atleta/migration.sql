-- Sócio-atleta: uma ficha de sócio pode ser de um atleta do clube.
--
-- Numa categoria de menores (idade máxima até 18), as quotas dessa ficha são
-- pagas pelos encarregados do atleta, na área da família, e a ficha nunca se
-- liga a uma conta. Ver `Member.athleteId` no schema e `members/socio-menor.ts`.
--
-- Só acrescenta: uma coluna anulável, a chave estrangeira e o índice único
-- (um atleta é sócio uma vez). A política RLS de "Member" já cobre a coluna.

ALTER TABLE "Member" ADD COLUMN "athleteId" TEXT;

ALTER TABLE "Member"
  ADD CONSTRAINT "Member_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Member_academyId_athleteId_key" ON "Member"("academyId", "athleteId");
