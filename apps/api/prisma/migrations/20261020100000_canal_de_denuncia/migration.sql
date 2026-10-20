-- O canal de denúncia e os documentos de conduta.
--
-- Um clube pediu: as famílias precisam de um sítio na app para reportar um
-- incidente (bullying, falta de ética, segurança), e o clube de um sítio na
-- consola para os ver e responder. E de poder pôr o código de ética e o manual
-- de conduta ao alcance das famílias. Três tabelas novas; nada do que existe
-- muda.
--
-- Quem vê as denúncias na consola é quem tem `conduct:read` (presidência e
-- direção, por omissão): o caso pode ser sobre um treinador, e por isso o
-- resto do staff fica de fora. Ver `src/conduct/`.

CREATE TYPE "ConductReportCategory" AS ENUM ('BULLYING', 'ETHICS', 'DISCRIMINATION', 'SAFETY', 'OTHER');
CREATE TYPE "ConductReportStatus" AS ENUM ('NEW', 'IN_REVIEW', 'RESOLVED', 'ARCHIVED');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONDUCT_REPORT_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONDUCT_REPORT_REPLIED';

CREATE TABLE "ConductReport" (
  "id"             TEXT NOT NULL,
  "academyId"      TEXT NOT NULL,
  "number"         INTEGER NOT NULL,
  "category"       "ConductReportCategory" NOT NULL,
  "status"         "ConductReportStatus" NOT NULL DEFAULT 'NEW',
  "anonymous"      BOOLEAN NOT NULL DEFAULT false,
  "reporterId"     TEXT,
  "reporterRole"   "Role",
  "athleteId"      TEXT,
  "happenedOn"     DATE,
  "place"          TEXT,
  "involved"       TEXT,
  "description"    TEXT NOT NULL,
  "assigneeId"     TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "lastMessageAt"  TIMESTAMP(3),
  "reporterSeenAt" TIMESTAMP(3),
  "staffSeenAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConductReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConductReport_academyId_number_key" ON "ConductReport"("academyId", "number");
CREATE INDEX "ConductReport_academyId_status_createdAt_idx" ON "ConductReport"("academyId", "status", "createdAt");
CREATE INDEX "ConductReport_reporterId_idx" ON "ConductReport"("reporterId");

ALTER TABLE "ConductReport"
  ADD CONSTRAINT "ConductReport_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConductReport"
  ADD CONSTRAINT "ConductReport_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConductReport"
  ADD CONSTRAINT "ConductReport_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConductReport"
  ADD CONSTRAINT "ConductReport_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ConductReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConductReport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConductReport";
CREATE POLICY tenant_isolation ON "ConductReport"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

CREATE TABLE "ConductReportMessage" (
  "id"         TEXT NOT NULL,
  "reportId"   TEXT NOT NULL,
  "authorId"   TEXT,
  "authorName" TEXT,
  "fromStaff"  BOOLEAN NOT NULL,
  "internal"   BOOLEAN NOT NULL DEFAULT false,
  "body"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConductReportMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConductReportMessage_reportId_createdAt_idx" ON "ConductReportMessage"("reportId", "createdAt");

ALTER TABLE "ConductReportMessage"
  ADD CONSTRAINT "ConductReportMessage_reportId_fkey"
  FOREIGN KEY ("reportId") REFERENCES "ConductReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConductReportMessage"
  ADD CONSTRAINT "ConductReportMessage_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- As mensagens não têm `academyId`: a isolação vem do caso a que pertencem.
ALTER TABLE "ConductReportMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConductReportMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConductReportMessage";
CREATE POLICY tenant_isolation ON "ConductReportMessage"
  USING (EXISTS (SELECT 1 FROM "ConductReport" r WHERE r."id" = "reportId" AND r."academyId" = app.current_academy_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "ConductReport" r WHERE r."id" = "reportId" AND r."academyId" = app.current_academy_id()));

CREATE TABLE "ConductDocument" (
  "id"            TEXT NOT NULL,
  "academyId"     TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "description"   TEXT,
  "files"         JSONB NOT NULL DEFAULT '[]',
  "order"         INTEGER NOT NULL DEFAULT 0,
  "createdByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConductDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConductDocument_academyId_order_idx" ON "ConductDocument"("academyId", "order");

ALTER TABLE "ConductDocument"
  ADD CONSTRAINT "ConductDocument_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConductDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConductDocument" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConductDocument";
CREATE POLICY tenant_isolation ON "ConductDocument"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- ---------------------------------------------------------------------------
-- As permissões novas nos cargos que já existem
--
-- Os cargos guardam permissões resolvidas: sem isto, `conduct:*` só valia
-- para quem não tem cargo. Só presidência e direção, de propósito: uma
-- denúncia pode ser sobre um treinador ou um coordenador.
-- ---------------------------------------------------------------------------

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['conduct:read', 'conduct:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['conduct:read', 'conduct:write'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['conduct:read', 'conduct:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['conduct:read', 'conduct:write'];
