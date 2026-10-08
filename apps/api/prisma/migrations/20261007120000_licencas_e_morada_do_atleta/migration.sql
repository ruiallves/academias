-- A morada e o Cartão de Cidadão do atleta, e as licenças federativas.
--
-- Os campos novos do atleta são todos opcionais: nenhum atleta que já existe
-- fica inválido. As licenças são uma tabela à parte, uma linha por atleta,
-- modalidade e época (ver `AthleteLicense` no schema).

ALTER TABLE "Athlete"
  ADD COLUMN "address"           TEXT,
  ADD COLUMN "postalCode"        TEXT,
  ADD COLUMN "city"              TEXT,
  ADD COLUMN "citizenCardNumber" TEXT;

CREATE TABLE "AthleteLicense" (
  "id"        TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "sportId"   TEXT NOT NULL,
  "seasonId"  TEXT NOT NULL,
  "number"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AthleteLicense_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AthleteLicense_number_check" CHECK (length(btrim("number")) > 0)
);

CREATE UNIQUE INDEX "AthleteLicense_athleteId_sportId_seasonId_key"
  ON "AthleteLicense"("athleteId", "sportId", "seasonId");
CREATE INDEX "AthleteLicense_academyId_seasonId_idx"
  ON "AthleteLicense"("academyId", "seasonId");

ALTER TABLE "AthleteLicense"
  ADD CONSTRAINT "AthleteLicense_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AthleteLicense"
  ADD CONSTRAINT "AthleteLicense_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AthleteLicense"
  ADD CONSTRAINT "AthleteLicense_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AthleteLicense"
  ADD CONSTRAINT "AthleteLicense_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AthleteLicense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AthleteLicense" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AthleteLicense";
CREATE POLICY tenant_isolation ON "AthleteLicense"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());
