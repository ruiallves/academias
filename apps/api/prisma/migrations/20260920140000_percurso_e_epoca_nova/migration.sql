-- O percurso de quem passa pelas equipas, e a viragem de época.
--
-- ## O que estava partido
--
-- Mudar um atleta de escalão **reescrevia** a ligação à equipa (ver
-- `AthletesService.update`): o Sub-11 do ano passado desaparecia. Com as épocas
-- a virar, a primeira viragem apagava o passado de toda a gente — e "por onde
-- este miúdo já passou" é das perguntas que um clube faz todos os dias.
--
-- O modelo já tinha `joinedAt`/`leftAt` em `TeamMembership`, e nunca ninguém os
-- usou porque o índice único `(teamId, athleteId)` não deixava haver duas
-- passagens pela mesma equipa. O `joinedAt` entra na chave: a mesma pessoa pode
-- voltar à mesma equipa noutra época, e continua a não poder ser inscrita duas
-- vezes no mesmo instante.
--
-- **Um plantel de cada vez continua a ser regra**, e é o código que a garante
-- (fecha a passagem anterior antes de abrir outra): um atleta em dois plantéis
-- ao mesmo tempo é como um miúdo aparece convocado por duas equipas no mesmo
-- sábado. Aqui só se deixa de proibir o que é histórico.
--
-- `TeamStaff` não tinha datas nenhumas: quem treinou o quê, em que ano, não
-- ficava em lado nenhum. Passa a ter as mesmas duas colunas.
--
-- `Team.previousTeamId` é a linhagem: a equipa nova de cada época sabe de onde
-- veio (este Sub-13 é o Sub-11 do ano passado que subiu), e é o que deixa
-- seguir um grupo de ano para ano sem adivinhar pelo nome.

/* ------------------------------------------------- atletas: as passagens --- */

DROP INDEX IF EXISTS "TeamMembership_teamId_athleteId_key";
CREATE UNIQUE INDEX "TeamMembership_teamId_athleteId_joinedAt_key"
  ON "TeamMembership" ("teamId", "athleteId", "joinedAt");
CREATE INDEX "TeamMembership_athleteId_leftAt_idx" ON "TeamMembership" ("athleteId", "leftAt");

/* --------------------------------------------- treinadores: as passagens --- */

ALTER TABLE "TeamStaff" ADD COLUMN "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "TeamStaff" ADD COLUMN "leftAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "TeamStaff_teamId_membershipId_key";
CREATE UNIQUE INDEX "TeamStaff_teamId_membershipId_joinedAt_key"
  ON "TeamStaff" ("teamId", "membershipId", "joinedAt");
CREATE INDEX "TeamStaff_teamId_leftAt_idx" ON "TeamStaff" ("teamId", "leftAt");

/* ------------------------------------------------------ equipas: de onde --- */

ALTER TABLE "Team" ADD COLUMN "previousTeamId" TEXT;
ALTER TABLE "Team" ADD CONSTRAINT "Team_previousTeamId_fkey"
  FOREIGN KEY ("previousTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Team_previousTeamId_idx" ON "Team" ("previousTeamId");
