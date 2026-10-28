-- Quem abriu os documentos de conduta.
--
-- O clube publica o código de ética e o manual de conduta nas Definições, e as
-- famílias leem-nos na app. Faltava saber quem os abriu de facto: o clube quer
-- poder dizer "estes pais já viram, estes ainda não", e procurar uma família
-- pelo nome ou pelo escalão.
--
-- Uma linha por pessoa e documento (primeira vez, última vez, quantas vezes),
-- gravada quando a pessoa abre um ficheiro do documento na app. Apagar o
-- documento apaga as leituras.
--
-- Só cria uma tabela. O servidor antigo não a usa; o novo precisa dela para
-- gravar as aberturas e para a lista "Quem abriu".

CREATE TABLE IF NOT EXISTS "ConductDocumentView" (
  "id"            TEXT NOT NULL,
  "academyId"     TEXT NOT NULL,
  "documentId"    TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "firstViewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastViewedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "count"         INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "ConductDocumentView_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConductDocumentView_documentId_userId_key"
  ON "ConductDocumentView"("documentId", "userId");
CREATE INDEX IF NOT EXISTS "ConductDocumentView_academyId_documentId_idx"
  ON "ConductDocumentView"("academyId", "documentId");

ALTER TABLE "ConductDocumentView"
  ADD CONSTRAINT "ConductDocumentView_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConductDocumentView"
  ADD CONSTRAINT "ConductDocumentView_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "ConductDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConductDocumentView" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConductDocumentView" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ConductDocumentView";
CREATE POLICY tenant_isolation ON "ConductDocumentView"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "ConductDocumentView" TO academia_app;
