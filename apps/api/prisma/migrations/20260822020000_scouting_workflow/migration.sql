-- Scouting — trabalho, vídeo e recrutamento
--
-- O que a Fase 1 deixou por fazer: as listas de trabalho, os pedidos que dão
-- razão de ser ao departamento, o encaixe com o clube, a biblioteca de vídeo e o
-- caminho de um prospecto para atleta.
--
-- ## O vídeo é o dado mais sensível do produto
--
-- Imagem de menores que **não pertencem à academia**. Por isso não há URL nenhum
-- nesta migração: guarda-se a chave do objecto num bucket privado e cada
-- reprodução pede um link assinado de vida curta. E por isso as permissões são
-- quatro e não duas — um coordenador pode ler o dossiê sem ter direito às
-- gravações.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "RequestUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "RequestStatus"  AS ENUM ('OPEN', 'IN_PROGRESS', 'FULFILLED', 'CANCELLED');
CREATE TYPE "VideoKind"      AS ENUM ('MATCH', 'TRAINING', 'TRIAL', 'OTHER');
CREATE TYPE "VideoStatus"    AS ENUM ('UPLOADING', 'READY', 'FAILED');
CREATE TYPE "MomentKind"     AS ENUM ('HIGHLIGHT', 'CONCERN', 'NOTE');

-- ---------------------------------------------------------------------------
-- Shortlists
-- ---------------------------------------------------------------------------

CREATE TABLE "Shortlist" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "sportId"     TEXT,
  "ageGroup"    TEXT,
  "profile"     TEXT,
  "createdById" TEXT,
  "archivedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Shortlist_academyId_idx" ON "Shortlist"("academyId");

CREATE TABLE "ShortlistEntry" (
  "id"          TEXT NOT NULL,
  "shortlistId" TEXT NOT NULL,
  "prospectId"  TEXT NOT NULL,
  "note"        TEXT,
  "rank"        INTEGER NOT NULL DEFAULT 0,
  "addedById"   TEXT,
  "addedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShortlistEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ShortlistEntry_shortlistId_prospectId_key" ON "ShortlistEntry"("shortlistId", "prospectId");
CREATE INDEX "ShortlistEntry_prospectId_idx" ON "ShortlistEntry"("prospectId");

-- ---------------------------------------------------------------------------
-- Pedidos de scouting
-- ---------------------------------------------------------------------------

CREATE TABLE "ScoutingRequest" (
  "id"            TEXT NOT NULL,
  "academyId"     TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "sportId"       TEXT,
  "ageGroup"      TEXT,
  "position"      TEXT,
  "profile"       TEXT,
  "traits"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "urgency"       "RequestUrgency" NOT NULL DEFAULT 'NORMAL',
  "status"        "RequestStatus" NOT NULL DEFAULT 'OPEN',
  "dueDate"       DATE,
  "requestedById" TEXT,
  "assignedToId"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScoutingRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ScoutingRequest_academyId_status_idx" ON "ScoutingRequest"("academyId", "status");

CREATE TABLE "ScoutingRequestCandidate" (
  "id"         TEXT NOT NULL,
  "requestId"  TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "note"       TEXT,
  "addedById"  TEXT,
  "addedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScoutingRequestCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ScoutingRequestCandidate_requestId_prospectId_key"
  ON "ScoutingRequestCandidate"("requestId", "prospectId");
CREATE INDEX "ScoutingRequestCandidate_prospectId_idx" ON "ScoutingRequestCandidate"("prospectId");

-- ---------------------------------------------------------------------------
-- Fit com o clube
-- ---------------------------------------------------------------------------
--
-- `value` é uma opinião registada, não um cálculo. Não sai de nenhuma fórmula
-- sobre as observações — é alguém do clube a dizer "encaixa a 80% no nosso modelo
-- de jogo". Derivá-lo automaticamente dar-lhe-ia uma autoridade que ele não tem.

CREATE TABLE "FitDimension" (
  "id"         TEXT NOT NULL,
  "academyId"  TEXT NOT NULL,
  "sportId"    TEXT,
  "name"       TEXT NOT NULL,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "FitDimension_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FitDimension_academyId_sportId_name_key" ON "FitDimension"("academyId", "sportId", "name");
CREATE INDEX "FitDimension_academyId_idx" ON "FitDimension"("academyId");

CREATE TABLE "ProspectFit" (
  "id"          TEXT NOT NULL,
  "prospectId"  TEXT NOT NULL,
  "dimensionId" TEXT NOT NULL,
  "value"       INTEGER NOT NULL,
  CONSTRAINT "ProspectFit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProspectFit_prospectId_dimensionId_key" ON "ProspectFit"("prospectId", "dimensionId");
CREATE INDEX "ProspectFit_dimensionId_idx" ON "ProspectFit"("dimensionId");

-- ---------------------------------------------------------------------------
-- Vídeo
-- ---------------------------------------------------------------------------
--
-- `storageKey` e não `url`: o bucket é privado e nenhum endereço permanente
-- existe. Um link público, mesmo que "difícil de adivinhar", é um link que vive
-- para sempre em qualquer conversa para onde for reencaminhado.

CREATE TABLE "ProspectVideo" (
  "id"            TEXT NOT NULL,
  "academyId"     TEXT NOT NULL,
  "prospectId"    TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "kind"          "VideoKind" NOT NULL DEFAULT 'MATCH',
  "recordedOn"    DATE,
  "competition"   TEXT,
  "opponent"      TEXT,
  "durationSec"   INTEGER,
  "notes"         TEXT,
  "tags"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "storageKey"    TEXT NOT NULL,
  "mimeType"      TEXT,
  "sizeBytes"     INTEGER,
  "status"        "VideoStatus" NOT NULL DEFAULT 'UPLOADING',
  "observationId" TEXT,
  "uploadedById"  TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProspectVideo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProspectVideo_academyId_idx" ON "ProspectVideo"("academyId");
CREATE INDEX "ProspectVideo_prospectId_recordedOn_idx" ON "ProspectVideo"("prospectId", "recordedOn");

CREATE TABLE "VideoMoment" (
  "id"          TEXT NOT NULL,
  "videoId"     TEXT NOT NULL,
  "atSec"       INTEGER NOT NULL,
  "kind"        "MomentKind" NOT NULL DEFAULT 'HIGHLIGHT',
  "label"       TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VideoMoment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VideoMoment_videoId_atSec_idx" ON "VideoMoment"("videoId", "atSec");

-- ---------------------------------------------------------------------------
-- Chaves estrangeiras
-- ---------------------------------------------------------------------------

ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_shortlistId_fkey"
  FOREIGN KEY ("shortlistId") REFERENCES "Shortlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShortlistEntry" ADD CONSTRAINT "ShortlistEntry_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScoutingRequest" ADD CONSTRAINT "ScoutingRequest_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutingRequest" ADD CONSTRAINT "ScoutingRequest_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScoutingRequest" ADD CONSTRAINT "ScoutingRequest_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScoutingRequest" ADD CONSTRAINT "ScoutingRequest_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScoutingRequestCandidate" ADD CONSTRAINT "ScoutingRequestCandidate_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "ScoutingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutingRequestCandidate" ADD CONSTRAINT "ScoutingRequestCandidate_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutingRequestCandidate" ADD CONSTRAINT "ScoutingRequestCandidate_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FitDimension" ADD CONSTRAINT "FitDimension_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FitDimension" ADD CONSTRAINT "FitDimension_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProspectFit" ADD CONSTRAINT "ProspectFit_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectFit" ADD CONSTRAINT "ProspectFit_dimensionId_fkey"
  FOREIGN KEY ("dimensionId") REFERENCES "FitDimension"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProspectVideo" ADD CONSTRAINT "ProspectVideo_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectVideo" ADD CONSTRAINT "ProspectVideo_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectVideo" ADD CONSTRAINT "ProspectVideo_observationId_fkey"
  FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProspectVideo" ADD CONSTRAINT "ProspectVideo_uploadedById_fkey"
  FOREIGN KEY ("uploadedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VideoMoment" ADD CONSTRAINT "VideoMoment_videoId_fkey"
  FOREIGN KEY ("videoId") REFERENCES "ProspectVideo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoMoment" ADD CONSTRAINT "VideoMoment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento
-- ---------------------------------------------------------------------------

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Shortlist', 'ScoutingRequest', 'FitDimension', 'ProspectVideo'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("academyId" = app.current_academy_id())
        WITH CHECK ("academyId" = app.current_academy_id())
    $p$, t);
  END LOOP;
END
$$;

DO $$
DECLARE spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('ShortlistEntry',           'shortlistId', 'Shortlist'),
      ('ScoutingRequestCandidate', 'requestId',   'ScoutingRequest'),
      ('ProspectFit',              'prospectId',  'Prospect'),
      ('VideoMoment',              'videoId',     'ProspectVideo')
    ) AS s(child, fk, parent)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', spec.child);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', spec.child);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', spec.child);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (EXISTS (
          SELECT 1 FROM %I p
          WHERE p.id = %I.%I AND p."academyId" = app.current_academy_id()
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM %I p
          WHERE p.id = %I.%I AND p."academyId" = app.current_academy_id()
        ))
    $p$, spec.child, spec.parent, spec.child, spec.fk,
         spec.parent, spec.child, spec.fk);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "Shortlist", "ShortlistEntry", "ScoutingRequest", "ScoutingRequestCandidate",
  "FitDimension", "ProspectFit", "ProspectVideo", "VideoMoment"
  TO academia_app;
