-- Inscrições na FPF (Modelo 2): o clube na federação, três campos do atleta,
-- a tabela das inscrições e duas permissões. Nada do que existe muda de
-- sentido: são colunas e uma tabela novas, todas opcionais.

-- O clube na federação: código e associação. Ver `Academy.fpfClubCode`.
ALTER TABLE "Academy" ADD COLUMN "fpfClubCode" TEXT;
ALTER TABLE "Academy" ADD COLUMN "footballAssociation" TEXT;

-- O que o boletim pede e a ficha não tinha.
ALTER TABLE "Athlete" ADD COLUMN "birthCountry" TEXT;
ALTER TABLE "Athlete" ADD COLUMN "nationality" TEXT;
ALTER TABLE "Athlete" ADD COLUMN "phone" TEXT;

CREATE TABLE "PlayerRegistration" (
  "id"              TEXT NOT NULL,
  "academyId"       TEXT NOT NULL,
  "athleteId"       TEXT NOT NULL,
  "sportId"         TEXT NOT NULL,
  "seasonId"        TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "category"        TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'GENERATED',
  "generatedAt"     TIMESTAMP(3) NOT NULL,
  "generatedByName" TEXT,
  "signedAt"        TIMESTAMP(3),
  "submittedAt"     TIMESTAMP(3),
  "doneAt"          TIMESTAMP(3),
  "documentId"      TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerRegistration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerRegistration_athleteId_sportId_seasonId_key"
  ON "PlayerRegistration"("athleteId", "sportId", "seasonId");
CREATE INDEX "PlayerRegistration_academyId_seasonId_idx"
  ON "PlayerRegistration"("academyId", "seasonId");

ALTER TABLE "PlayerRegistration"
  ADD CONSTRAINT "PlayerRegistration_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerRegistration"
  ADD CONSTRAINT "PlayerRegistration_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerRegistration"
  ADD CONSTRAINT "PlayerRegistration_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerRegistration"
  ADD CONSTRAINT "PlayerRegistration_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerRegistration"
  ADD CONSTRAINT "PlayerRegistration_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "AthleteDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlayerRegistration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlayerRegistration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PlayerRegistration";
CREATE POLICY tenant_isolation ON "PlayerRegistration"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- ---------------------------------------------------------------------------
-- As permissões novas nos cargos que já existem
--
-- Os cargos guardam permissões resolvidas: sem isto, `registration:*` só
-- valia para quem não tem cargo. Ler e escrever acompanham quem trata dos
-- atletas do clube inteiro: presidência, direção e coordenação.
-- ---------------------------------------------------------------------------

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['registration:read', 'registration:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['registration:read', 'registration:write'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['registration:read', 'registration:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['registration:read', 'registration:write'];
