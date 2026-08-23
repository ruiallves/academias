-- Catálogos da academia
--
-- Locais, balneários, escalões, cargos e tipos de evento viviam em memória no
-- browser. Um diretor acrescentava "Campo 3" nas Definições, marcava um treino lá,
-- e ao recarregar a página o campo tinha desaparecido — e nenhum outro utilizador
-- da academia chegou sequer a vê-lo. Configuração que não sai do separador não é
-- configuração.
--
-- Um `kind` em texto e não uma tabela por tipo: são todos a mesma coisa — uma
-- lista ordenada de rótulos com uma nota. Cinco tabelas idênticas dariam cinco
-- endpoints idênticos, e o sexto catálogo exigia uma migração.

CREATE TABLE "CatalogItem" (
  "id"         TEXT NOT NULL,
  "academyId"  TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "label"      TEXT NOT NULL,
  "note"       TEXT,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "isSystem"   BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- Duplicados são o problema que um catálogo existe para resolver: é isto que
-- impede "Pavilhão", "pavilhao" e "Pav. Municipal" de coexistirem.
CREATE UNIQUE INDEX "CatalogItem_academyId_kind_label_key" ON "CatalogItem"("academyId", "kind", "label");
CREATE INDEX "CatalogItem_academyId_kind_idx" ON "CatalogItem"("academyId", "kind");

ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CatalogItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CatalogItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CatalogItem";
CREATE POLICY tenant_isolation ON "CatalogItem"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "CatalogItem" TO academia_app;
