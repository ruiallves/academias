-- Certificação FPF: a candidatura de cada época e o que o clube respondeu à mão.
-- Duas tabelas novas e duas permissões; nada do que existe muda.
--
-- O manual não está aqui: vive em código (`src/certification/catalogo-*.ts`) e
-- `catalogKey` diz por qual se avalia. O nível e os pontos também não: são
-- calculados a cada leitura.

CREATE TABLE "CertificationProcess" (
  "id"         TEXT NOT NULL,
  "academyId"  TEXT NOT NULL,
  "seasonId"   TEXT NOT NULL,
  "catalogKey" TEXT NOT NULL,
  "profile"    JSONB NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CertificationProcess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CertificationProcess_academyId_seasonId_catalogKey_key"
  ON "CertificationProcess"("academyId", "seasonId", "catalogKey");
CREATE INDEX "CertificationProcess_academyId_idx" ON "CertificationProcess"("academyId");

ALTER TABLE "CertificationProcess"
  ADD CONSTRAINT "CertificationProcess_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CertificationProcess"
  ADD CONSTRAINT "CertificationProcess_seasonId_fkey"
  FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "CertificationAnswer" (
  "id"             TEXT NOT NULL,
  "academyId"      TEXT NOT NULL,
  "processId"      TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "value"          INTEGER NOT NULL,
  "note"           TEXT,
  "answeredById"   TEXT,
  "answeredByName" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CertificationAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CertificationAnswer_processId_code_key"
  ON "CertificationAnswer"("processId", "code");
CREATE INDEX "CertificationAnswer_academyId_idx" ON "CertificationAnswer"("academyId");

ALTER TABLE "CertificationAnswer"
  ADD CONSTRAINT "CertificationAnswer_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CertificationAnswer"
  ADD CONSTRAINT "CertificationAnswer_processId_fkey"
  FOREIGN KEY ("processId") REFERENCES "CertificationProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CertificationProcess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CertificationProcess" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CertificationProcess";
CREATE POLICY tenant_isolation ON "CertificationProcess"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "CertificationAnswer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CertificationAnswer" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CertificationAnswer";
CREATE POLICY tenant_isolation ON "CertificationAnswer"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- ---------------------------------------------------------------------------
-- As permissões novas nos cargos que já existem
--
-- Os cargos guardam permissões resolvidas: sem isto, `certification:*` só
-- valeria para quem não tem cargo, e o menu não aparecia a nenhum clube a
-- sério. É a armadilha que `scripts/check-permissions.mjs` vigia.
--
-- Ler acompanha quem já vê a operação: presidência, direção e coordenação (o
-- coordenador técnico é uma das pessoas que a FPF chama pelo nome). Escrever
-- fica na presidência e na direção, que assinam as declarações de compromisso.
-- ---------------------------------------------------------------------------

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['certification:read']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['certification:read'];

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['certification:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['certification:write'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['certification:read']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['certification:read'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['certification:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['certification:write'];
