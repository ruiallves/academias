-- A periodização: mesociclos e microciclos por cima do calendário.
--
-- Um ciclo é um intervalo de dias de uma equipa, com intenção (fase, foco,
-- objetivo, notas). Não contém treinos: um treino, um jogo ou um evento
-- pertence ao ciclo que contém o seu dia, em hora de Lisboa. Por isso nada
-- muda em `TrainingSession`, `Match` ou `CalendarEvent`, e mover, apagar ou
-- criar treinos nunca deixa ligações por acertar.
--
-- O macrociclo é a época (`Season`), a que a equipa já pertence. Não há tabela
-- para ele.

CREATE TYPE "CycleLevel" AS ENUM ('MESO', 'MICRO');

CREATE TABLE "TrainingCycle" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "teamId"      TEXT NOT NULL,
  "level"       "CycleLevel" NOT NULL,
  "startsOn"    DATE NOT NULL,
  "endsOn"      DATE NOT NULL,
  "name"        TEXT,
  "phase"       TEXT,
  "focus"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "objective"   TEXT,
  "notes"       TEXT,
  "color"       TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TrainingCycle_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrainingCycle_datas" CHECK ("endsOn" >= "startsOn")
);

CREATE INDEX "TrainingCycle_teamId_level_startsOn_idx" ON "TrainingCycle"("teamId", "level", "startsOn");
CREATE INDEX "TrainingCycle_academyId_idx" ON "TrainingCycle"("academyId");

ALTER TABLE "TrainingCycle"
  ADD CONSTRAINT "TrainingCycle_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingCycle"
  ADD CONSTRAINT "TrainingCycle_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrainingCycle"
  ADD CONSTRAINT "TrainingCycle_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sem sobreposição dentro do mesmo nível e da mesma equipa: dois microciclos
-- no mesmo dia davam a um treino dois contextos. Mesos e micros sobrepõem-se
-- à vontade. Na base e não só no serviço, que é o que protege de dois pedidos
-- ao mesmo tempo. Uma restrição por nível porque o operador de igualdade do
-- `btree_gist` sobre enums não é garantido em todas as versões.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

ALTER TABLE "TrainingCycle"
  ADD CONSTRAINT "TrainingCycle_meso_sem_sobreposicao"
  EXCLUDE USING gist ("teamId" WITH =, daterange("startsOn", "endsOn", '[]') WITH &&)
  WHERE ("level" = 'MESO');
ALTER TABLE "TrainingCycle"
  ADD CONSTRAINT "TrainingCycle_micro_sem_sobreposicao"
  EXCLUDE USING gist ("teamId" WITH =, daterange("startsOn", "endsOn", '[]') WITH &&)
  WHERE ("level" = 'MICRO');

-- Isolamento: tem `academyId` próprio, e por isso entra em `TENANT_SCOPED`.
ALTER TABLE "TrainingCycle" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TrainingCycle" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TrainingCycle";
CREATE POLICY tenant_isolation ON "TrainingCycle"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "TrainingCycle" TO academia_app;
