-- Academias AI — a fundação da análise de vídeo.
--
-- ## A forma
--
--   Vídeo → Computer Vision → dados estruturados → validação humana →
--   estatística → interpretação.
--
-- O processamento não vive no NestJS: um worker Python reclama trabalhos da
-- fila (`AIJob`, com FOR UPDATE SKIP LOCKED) e devolve resultados estruturados,
-- sempre com confidence. As posições por frame dos tracks vivem no Storage
-- (`PlayerTrack.dataKey`), não aqui — meio milhão de linhas por análise não é
-- um dado relacional.
--
-- ## Isolamento
--
-- RLS por academia em todas as tabelas de tenant, como sempre. `AIModelVersion`
-- é da plataforma — regista que modelo (e que licença) produziu que números — e
-- não tem tenant nem RLS; a app só a lê e o worker regista versões por ela.

CREATE TYPE "AIAnalysisStatus" AS ENUM ('DRAFT', 'UPLOADING', 'QUEUED', 'PROCESSING', 'REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "AIJobStatus" AS ENUM ('PENDING', 'CLAIMED', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- O processamento é assíncrono de propósito — o treinador fecha a consola e é
-- esta notificação que lhe diz que pode voltar.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'AI_ANALYSIS_COMPLETED';

-- ---------------------------------------------------------------------------
-- AIAnalysis — uma análise de um jogo
-- ---------------------------------------------------------------------------

CREATE TABLE "AIAnalysis" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "matchId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'match',
    "title" TEXT NOT NULL,
    "opponent" TEXT,
    "competition" TEXT,
    "playedOn" DATE,
    "status" "AIAnalysisStatus" NOT NULL DEFAULT 'DRAFT',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "confidence" JSONB,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "failReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AIAnalysis_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AIAnalysis_academyId_createdAt_idx" ON "AIAnalysis"("academyId", "createdAt");
CREATE INDEX "AIAnalysis_teamId_idx" ON "AIAnalysis"("teamId");
CREATE INDEX "AIAnalysis_matchId_idx" ON "AIAnalysis"("matchId");

ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Apagar um jogo do calendário não apaga horas de processamento e correções.
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- AIAnalysisPlayer — o plantel confirmado ("#10 = Rui Silva")
-- ---------------------------------------------------------------------------

CREATE TABLE "AIAnalysisPlayer" (
    "id" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "jerseyNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAnalysisPlayer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIAnalysisPlayer_analysisId_athleteId_key" ON "AIAnalysisPlayer"("analysisId", "athleteId");
CREATE INDEX "AIAnalysisPlayer_athleteId_idx" ON "AIAnalysisPlayer"("athleteId");

ALTER TABLE "AIAnalysisPlayer" ADD CONSTRAINT "AIAnalysisPlayer_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIAnalysisPlayer" ADD CONSTRAINT "AIAnalysisPlayer_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- AIVideo — o vídeo, com a chave no bucket privado (nunca URLs)
-- ---------------------------------------------------------------------------

CREATE TABLE "AIVideo" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    -- BIGINT: um jogo inteiro em 1080p passa dos 2 GB com folga.
    "sizeBytes" BIGINT,
    "status" "VideoStatus" NOT NULL DEFAULT 'UPLOADING',
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "fps" DOUBLE PRECISION,
    "quality" JSONB,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIVideo_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AIVideo_academyId_idx" ON "AIVideo"("academyId");
CREATE INDEX "AIVideo_analysisId_idx" ON "AIVideo"("analysisId");

ALTER TABLE "AIVideo" ADD CONSTRAINT "AIVideo_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIVideo" ADD CONSTRAINT "AIVideo_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIVideo" ADD CONSTRAINT "AIVideo_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- AIJob — a fila de processamento
-- ---------------------------------------------------------------------------

CREATE TABLE "AIJob" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "AIJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 2,
    "params" JSONB,
    "result" JSONB,
    "error" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "modelVersions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIJob_pkey" PRIMARY KEY ("id")
);

-- O índice da fila: o claim procura PENDING por prioridade e antiguidade.
CREATE INDEX "AIJob_status_priority_createdAt_idx" ON "AIJob"("status", "priority", "createdAt");
CREATE INDEX "AIJob_analysisId_idx" ON "AIJob"("analysisId");
CREATE INDEX "AIJob_academyId_idx" ON "AIJob"("academyId");

ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIJob" ADD CONSTRAINT "AIJob_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PlayerTrack — resumo do track; as posições por frame vivem no Storage
-- ---------------------------------------------------------------------------

CREATE TABLE "PlayerTrack" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "trackNumber" INTEGER NOT NULL,
    "athleteId" TEXT,
    "side" TEXT NOT NULL DEFAULT 'unknown',
    "jerseyNumber" INTEGER,
    "identityConfidence" DOUBLE PRECISION,
    "trackConfidence" DOUBLE PRECISION,
    "firstMs" INTEGER NOT NULL,
    "lastMs" INTEGER NOT NULL,
    "frameCount" INTEGER NOT NULL DEFAULT 0,
    "dataKey" TEXT,
    "summary" JSONB,
    "status" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerTrack_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerTrack_analysisId_idx" ON "PlayerTrack"("analysisId");
CREATE INDEX "PlayerTrack_athleteId_idx" ON "PlayerTrack"("athleteId");
CREATE INDEX "PlayerTrack_academyId_idx" ON "PlayerTrack"("academyId");

ALTER TABLE "PlayerTrack" ADD CONSTRAINT "PlayerTrack_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerTrack" ADD CONSTRAINT "PlayerTrack_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Apagar um atleta anonimiza o track; apagar a análise é que o leva.
ALTER TABLE "PlayerTrack" ADD CONSTRAINT "PlayerTrack_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- DetectedEvent — eventos com confiança; o clip é uma chave, nunca um URL
-- ---------------------------------------------------------------------------

CREATE TABLE "DetectedEvent" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tsMs" INTEGER NOT NULL,
    "endTsMs" INTEGER,
    "confidence" DOUBLE PRECISION NOT NULL,
    "athleteId" TEXT,
    "payload" JSONB,
    "clipKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DetectedEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DetectedEvent_analysisId_tsMs_idx" ON "DetectedEvent"("analysisId", "tsMs");
CREATE INDEX "DetectedEvent_athleteId_idx" ON "DetectedEvent"("athleteId");
CREATE INDEX "DetectedEvent_academyId_kind_idx" ON "DetectedEvent"("academyId", "kind");

ALTER TABLE "DetectedEvent" ADD CONSTRAINT "DetectedEvent_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DetectedEvent" ADD CONSTRAINT "DetectedEvent_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DetectedEvent" ADD CONSTRAINT "DetectedEvent_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- AIInsight — interpretação derivada, auditável, nunca inventada
-- ---------------------------------------------------------------------------

CREATE TABLE "AIInsight" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "analysisId" TEXT,
    "athleteId" TEXT,
    "teamId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "data" JSONB,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIInsight_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AIInsight_academyId_createdAt_idx" ON "AIInsight"("academyId", "createdAt");
CREATE INDEX "AIInsight_athleteId_idx" ON "AIInsight"("athleteId");
CREATE INDEX "AIInsight_analysisId_idx" ON "AIInsight"("analysisId");
CREATE INDEX "AIInsight_teamId_idx" ON "AIInsight"("teamId");

ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Cascade: um insight sobre um atleta apagado não pode sobreviver-lhe.
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AIInsight" ADD CONSTRAINT "AIInsight_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- HumanCorrection — a matéria-prima do active learning
-- ---------------------------------------------------------------------------

CREATE TABLE "HumanCorrection" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "tsMs" INTEGER,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "correctedById" TEXT,
    "jobId" TEXT,
    "exportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HumanCorrection_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HumanCorrection_analysisId_idx" ON "HumanCorrection"("analysisId");
CREATE INDEX "HumanCorrection_academyId_kind_idx" ON "HumanCorrection"("academyId", "kind");

ALTER TABLE "HumanCorrection" ADD CONSTRAINT "HumanCorrection_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HumanCorrection" ADD CONSTRAINT "HumanCorrection_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HumanCorrection" ADD CONSTRAINT "HumanCorrection_correctedById_fkey"
  FOREIGN KEY ("correctedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- PlayerIdentityProfile — identidade visual sem biometria facial
-- ---------------------------------------------------------------------------

CREATE TABLE "PlayerIdentityProfile" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "jerseyNumbers" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "seenPositions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gamesAnalysed" INTEGER NOT NULL DEFAULT 0,
    "identityConfidence" DOUBLE PRECISION,
    "embeddingKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerIdentityProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerIdentityProfile_athleteId_key" ON "PlayerIdentityProfile"("athleteId");
CREATE INDEX "PlayerIdentityProfile_academyId_idx" ON "PlayerIdentityProfile"("academyId");

ALTER TABLE "PlayerIdentityProfile" ADD CONSTRAINT "PlayerIdentityProfile_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerIdentityProfile" ADD CONSTRAINT "PlayerIdentityProfile_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- AIModelVersion — plataforma: que modelo, com que licença, produziu o quê
-- ---------------------------------------------------------------------------

CREATE TABLE "AIModelVersion" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "source" TEXT,
    "weightsKey" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIModelVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AIModelVersion_task_name_version_key" ON "AIModelVersion"("task", "name", "version");

-- ---------------------------------------------------------------------------
-- Isolamento
-- ---------------------------------------------------------------------------
--
-- RLS por academia em todas as tabelas de tenant. `AIAnalysisPlayer` não tem
-- `academyId` — o isolamento chega-lhe pela análise, como `ExerciseFavorite`
-- chega pelo exercício. `AIModelVersion` fica de fora: não tem dados de tenant.

ALTER TABLE "AIAnalysis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AIAnalysis" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AIAnalysis";
CREATE POLICY tenant_isolation ON "AIAnalysis"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "AIAnalysisPlayer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AIAnalysisPlayer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AIAnalysisPlayer";
CREATE POLICY tenant_isolation ON "AIAnalysisPlayer"
  USING (EXISTS (SELECT 1 FROM "AIAnalysis" a WHERE a."id" = "analysisId" AND a."academyId" = app.current_academy_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "AIAnalysis" a WHERE a."id" = "analysisId" AND a."academyId" = app.current_academy_id()));

ALTER TABLE "AIVideo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AIVideo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AIVideo";
CREATE POLICY tenant_isolation ON "AIVideo"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "AIJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AIJob" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AIJob";
CREATE POLICY tenant_isolation ON "AIJob"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "PlayerTrack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlayerTrack" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PlayerTrack";
CREATE POLICY tenant_isolation ON "PlayerTrack"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "DetectedEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DetectedEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DetectedEvent";
CREATE POLICY tenant_isolation ON "DetectedEvent"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "AIInsight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AIInsight" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AIInsight";
CREATE POLICY tenant_isolation ON "AIInsight"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "HumanCorrection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HumanCorrection" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "HumanCorrection";
CREATE POLICY tenant_isolation ON "HumanCorrection"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "PlayerIdentityProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlayerIdentityProfile" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PlayerIdentityProfile";
CREATE POLICY tenant_isolation ON "PlayerIdentityProfile"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "AIAnalysis", "AIAnalysisPlayer", "AIVideo", "AIJob", "PlayerTrack",
     "DetectedEvent", "AIInsight", "HumanCorrection", "PlayerIdentityProfile"
  TO academia_app;

-- A app lê e regista versões de modelo; não as apaga — são histórico.
GRANT SELECT, INSERT, UPDATE ON "AIModelVersion" TO academia_app;

-- ---------------------------------------------------------------------------
-- A área chega aos cargos que já existiam
-- ---------------------------------------------------------------------------
--
-- O mesmo raciocínio de `20260829130000_area_tecnica_nos_cargos`: `ai:read` e
-- `ai:write` nasceram agora — nenhum clube pôde alguma vez decidir tirá-las, e
-- não há escolha de ninguém a atropelar. Sem isto, um "Treinador Principal"
-- criado no editor de cargos (permissões resolvidas) nunca veria a área nova,
-- enquanto um treinador sem cargo (mapa-base do código) a via.
--
-- O critério é o do mapa-base: treinador para cima. Clínico, scouting, staff
-- genérico e famílias ficam de fora — como no código.

UPDATE "AcademyRole"
   SET permissions = ARRAY(
         SELECT DISTINCT p
           FROM unnest(permissions || ARRAY['ai:read', 'ai:write']) AS p
       ),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR', 'COACH')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['ai:read'];

UPDATE "Department"
   SET permissions = ARRAY(
         SELECT DISTINCT p
           FROM unnest(permissions || ARRAY['ai:read', 'ai:write']) AS p
       ),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR', 'COACH')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['ai:read'];
