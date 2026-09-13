-- ---------------------------------------------------------------------------
-- A área de atleta na app do clube
-- ---------------------------------------------------------------------------
--
-- ## O que faltava
--
-- O papel `ATHLETE` existia desde o primeiro dia — nas permissões, no âmbito,
-- nos termos — mas nenhuma conta o vestia: não havia ligação entre uma conta e
-- uma ficha de atleta, nem caminho para a criar. Esta migração dá as duas coisas
-- e o que a área precisa para valer a pena: o plano de treino que o treinador
-- decide partilhar, o relatório e a avaliação que o atleta pode ler, e um plano
-- de nutrição.
--
-- ## A ligação é a `Membership`, não um `userId`
--
-- O sócio liga-se por `Member.userId` porque não passa pelo guard. O atleta
-- passa — o âmbito, as permissões e o gate legal resolvem-se pela `Membership`,
-- como na família. Por isso a ficha aponta para a membership de papel `ATHLETE`:
-- `scopeFor` lê `Athlete.accountMembershipId` e o resto do produto não muda.
--
-- ## O convite é o dos sócios
--
-- Email na ficha, 32 bytes de token de que só fica o hash, um convite de cada
-- vez, e o link morre ao ser usado. `app.resolve_athlete_invite` é a escotilha
-- que resolve o token sem sessão — a mesma forma de `resolve_member_invite`.
--
-- `TIMESTAMP(3)` em tudo, que é o que o Prisma mapeia para `DateTime`.
-- ---------------------------------------------------------------------------

-- A ficha do atleta: email, conta, convite.
ALTER TABLE "Athlete"
  ADD COLUMN "email"               TEXT,
  ADD COLUMN "accountMembershipId" TEXT,
  ADD COLUMN "inviteTokenHash"     TEXT,
  ADD COLUMN "inviteSentAt"        TIMESTAMP(3);

CREATE UNIQUE INDEX "Athlete_accountMembershipId_key" ON "Athlete"("accountMembershipId");
CREATE UNIQUE INDEX "Athlete_inviteTokenHash_key" ON "Athlete"("inviteTokenHash");

-- Apagar a membership não apaga o atleta: a ficha fica, sem conta.
ALTER TABLE "Athlete"
  ADD CONSTRAINT "Athlete_accountMembershipId_fkey"
  FOREIGN KEY ("accountMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O plano de treino, partilhado com os atletas quando o treinador quiser.
ALTER TABLE "TrainingSession" ADD COLUMN "planSharedAt" TIMESTAMP(3);

-- O que o próprio atleta pode ler.
ALTER TABLE "AthleteReport" ADD COLUMN "athleteVisible" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Evaluation"    ADD COLUMN "athleteVisible" BOOLEAN NOT NULL DEFAULT true;

-- Aditivo. `ADD VALUE` numa transação é aceite desde o Postgres 12 desde que o
-- valor novo não seja usado na mesma transação — e não é.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'TRAINING_PLAN_SHARED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'NUTRITION_PLAN_SHARED';

-- ---------------------------------------------------------------------------
-- Planos de nutrição
-- ---------------------------------------------------------------------------

CREATE TABLE "NutritionPlan" (
  "id"             TEXT NOT NULL,
  "academyId"      TEXT NOT NULL,
  "athleteId"      TEXT NOT NULL,
  "authorId"       TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "body"           TEXT NOT NULL,
  "familyVisible"  BOOLEAN NOT NULL DEFAULT true,
  "athleteVisible" BOOLEAN NOT NULL DEFAULT true,
  "publishedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NutritionPlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NutritionPlan_academyId_athleteId_createdAt_idx" ON "NutritionPlan"("academyId", "athleteId", "createdAt");

ALTER TABLE "NutritionPlan"
  ADD CONSTRAINT "NutritionPlan_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "NutritionPlan"
  ADD CONSTRAINT "NutritionPlan_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `RESTRICT`, como na `Evaluation` e no `AthleteReport`: um plano sem autor é um
-- texto que ninguém assume, e é sobre a alimentação de uma criança.
ALTER TABLE "NutritionPlan"
  ADD CONSTRAINT "NutritionPlan_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Isolamento: tem `academyId` próprio, como `Evaluation` — e por isso entra em
-- `TENANT_SCOPED` no `prisma.service.ts`.
ALTER TABLE "NutritionPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NutritionPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "NutritionPlan";
CREATE POLICY tenant_isolation ON "NutritionPlan"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "NutritionPlan" TO academia_app;

-- ---------------------------------------------------------------------------
-- A escotilha do convite de atleta
-- ---------------------------------------------------------------------------
--
-- Do hash do token para (atleta, academia), antes de haver sessão — a RLS de
-- `Athlete` não deixa a aplicação procurar por token sem contexto de clube, e é
-- precisamente o clube que se quer descobrir. `SECURITY DEFINER`, devolve dois
-- ids e mais nada; a mesma forma de `app.resolve_member_invite`.

CREATE OR REPLACE FUNCTION app.resolve_athlete_invite(p_token_hash text)
RETURNS TABLE(athlete_id text, academy_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, "academyId" FROM "Athlete" WHERE "inviteTokenHash" = p_token_hash LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_athlete_invite(text) TO academia_app;
