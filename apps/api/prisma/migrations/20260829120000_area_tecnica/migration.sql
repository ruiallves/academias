-- Área técnica: planeamento de treino, biblioteca de exercícios, modelos de
-- jogo e bolas paradas.
--
-- ## O plano vive na sessão
--
-- Um treino planeado e um treino do calendário são o mesmo treino — o que abre
-- a folha de presenças, o que a app da família mostra. Por isso os campos do
-- plano entram em `TrainingSession` como colunas nulas, e não numa tabela
-- `TrainingPlan` paralela que um dia divergisse dela. Os blocos (ativação →
-- posse → jogo) são linhas próprias porque têm ordem, duração e exercício.
--
-- ## A carga não se guarda
--
-- A carga estimada é derivada (duração × intensidade dos blocos) e calcula-se
-- na leitura. Guardá-la seria a mesma coisa dita duas vezes, com a cópia a
-- mentir à primeira edição de um bloco.

-- Os campos do plano, todos nulos: um treino recém-marcado não tem plano, e é
-- essa ausência que o planner mostra como "por planear".
ALTER TABLE "TrainingSession" ADD COLUMN "objective" TEXT;
ALTER TABLE "TrainingSession" ADD COLUMN "objectives" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TrainingSession" ADD COLUMN "sessionType" TEXT;
ALTER TABLE "TrainingSession" ADD COLUMN "intensity" INTEGER;
ALTER TABLE "TrainingSession" ADD COLUMN "expectedAthletes" INTEGER;
ALTER TABLE "TrainingSession" ADD COLUMN "material" TEXT;
ALTER TABLE "TrainingSession" ADD COLUMN "planNotes" TEXT;
ALTER TABLE "TrainingSession" ADD COLUMN "postNotes" TEXT;

-- PRIVATE é do autor (rascunhos); CLUB é da academia. Sem nível "equipa" por
-- agora — quando for pedido, é um valor novo e nenhuma linha existente muda.
CREATE TYPE "LibraryVisibility" AS ENUM ('PRIVATE', 'CLUB');

CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "createdById" TEXT,
    "visibility" "LibraryVisibility" NOT NULL DEFAULT 'CLUB',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "objectives" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "phase" TEXT,
    "type" TEXT,
    "intensity" INTEGER,
    "players" TEXT,
    "durationMin" INTEGER,
    "space" TEXT,
    "material" TEXT,
    "ageMin" INTEGER,
    "ageMax" INTEGER,
    "complexity" INTEGER,
    "rules" TEXT,
    "progressions" TEXT,
    "regressions" TEXT,
    "coachingPoints" TEXT,
    "commonErrors" TEXT,
    "videoUrl" TEXT,
    "diagram" JSONB,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Exercise_academyId_visibility_idx" ON "Exercise"("academyId", "visibility");
CREATE INDEX "Exercise_createdById_idx" ON "Exercise"("createdById");

ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Quem sai do clube deixa exercícios atrás de si — são património do treino,
-- não da pessoa. Ficam sem autor, nunca desaparecem.
ALTER TABLE "Exercise" ADD CONSTRAINT "Exercise_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ExerciseFavorite" (
    "id" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExerciseFavorite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExerciseFavorite_exerciseId_membershipId_key" ON "ExerciseFavorite"("exerciseId", "membershipId");
CREATE INDEX "ExerciseFavorite_membershipId_idx" ON "ExerciseFavorite"("membershipId");

ALTER TABLE "ExerciseFavorite" ADD CONSTRAINT "ExerciseFavorite_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExerciseFavorite" ADD CONSTRAINT "ExerciseFavorite_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SessionBlock" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "category" TEXT,
    "objective" TEXT,
    "intensity" INTEGER,
    "players" TEXT,
    "space" TEXT,
    "material" TEXT,
    "notes" TEXT,
    "exerciseId" TEXT,

    CONSTRAINT "SessionBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SessionBlock_sessionId_order_idx" ON "SessionBlock"("sessionId", "order");
CREATE INDEX "SessionBlock_academyId_idx" ON "SessionBlock"("academyId");
CREATE INDEX "SessionBlock_exerciseId_idx" ON "SessionBlock"("exerciseId");

ALTER TABLE "SessionBlock" ADD CONSTRAINT "SessionBlock_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionBlock" ADD CONSTRAINT "SessionBlock_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Apagar um exercício não apaga o histórico dos treinos onde entrou: o bloco
-- guarda o próprio nome e sobrevive-lhe.
ALTER TABLE "SessionBlock" ADD CONSTRAINT "SessionBlock_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "GameModel" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "teamId" TEXT,
    "createdById" TEXT,
    "visibility" "LibraryVisibility" NOT NULL DEFAULT 'CLUB',
    "name" TEXT NOT NULL,
    "system" TEXT,
    "lineup" JSONB,
    "principles" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GameModel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameModel_academyId_idx" ON "GameModel"("academyId");
CREATE INDEX "GameModel_teamId_idx" ON "GameModel"("teamId");

ALTER TABLE "GameModel" ADD CONSTRAINT "GameModel_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Apagar uma equipa não apaga o modelo de jogo: fica "do clube" e reatribui-se.
ALTER TABLE "GameModel" ADD CONSTRAINT "GameModel_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GameModel" ADD CONSTRAINT "GameModel_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SetPiece" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "teamId" TEXT,
    "createdById" TEXT,
    "visibility" "LibraryVisibility" NOT NULL DEFAULT 'CLUB',
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "diagram" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetPiece_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SetPiece_academyId_kind_idx" ON "SetPiece"("academyId", "kind");
CREATE INDEX "SetPiece_teamId_idx" ON "SetPiece"("teamId");

ALTER TABLE "SetPiece" ADD CONSTRAINT "SetPiece_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetPiece" ADD CONSTRAINT "SetPiece_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SetPiece" ADD CONSTRAINT "SetPiece_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento
-- ---------------------------------------------------------------------------
--
-- A mesma disciplina de todas as tabelas de domínio: RLS por academia, com a
-- política a ler o tenant do contexto. `ExerciseFavorite` não tem `academyId` —
-- o isolamento chega-lhe pelo exercício, que tem, e a política atravessa a
-- relação como as de `AttendanceRecord`.

ALTER TABLE "Exercise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Exercise" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Exercise";
CREATE POLICY tenant_isolation ON "Exercise"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SessionBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionBlock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SessionBlock";
CREATE POLICY tenant_isolation ON "SessionBlock"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "GameModel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GameModel" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GameModel";
CREATE POLICY tenant_isolation ON "GameModel"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SetPiece" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SetPiece" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SetPiece";
CREATE POLICY tenant_isolation ON "SetPiece"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "ExerciseFavorite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExerciseFavorite" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ExerciseFavorite";
CREATE POLICY tenant_isolation ON "ExerciseFavorite"
  USING (EXISTS (SELECT 1 FROM "Exercise" e WHERE e."id" = "exerciseId" AND e."academyId" = app.current_academy_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "Exercise" e WHERE e."id" = "exerciseId" AND e."academyId" = app.current_academy_id()));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "Exercise", "ExerciseFavorite", "SessionBlock", "GameModel", "SetPiece"
  TO academia_app;
