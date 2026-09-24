-- A cor de um item de catálogo. Hoje só os tipos de consulta a usam: é a cor
-- com que aparecem no calendário das Consultas, escolhida nas Definições.
ALTER TABLE "CatalogItem" ADD COLUMN "color" TEXT;

ALTER TABLE "CatalogItem" ADD CONSTRAINT "CatalogItem_color_hex"
  CHECK ("color" IS NULL OR "color" ~ '^#[0-9a-f]{6}$');
