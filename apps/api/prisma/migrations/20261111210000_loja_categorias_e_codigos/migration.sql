-- A loja do site ganha controlo (11/11/2026): categorias geridas, endereços
-- (slugs) dos produtos, promoções, novidades e códigos promocionais.
--
--   1. `SiteProductCategory`: as categorias da loja, com nome, endereço,
--      ordem e visibilidade. Nascem aqui das categorias de texto que os
--      produtos já tinham.
--   2. `SiteProduct`: `slug` (o endereço `/loja/<slug>`, preenchido aqui a
--      partir do nome), `categoryId`, `compareAtPriceCents` (o preço riscado),
--      `isNew`, `seoTitle`, `seoDescription`.
--   3. `SiteDiscountCode`: os códigos promocionais.
--   4. `SiteOrder.discountCents/discountCode/discountCodeId` e
--      `SiteOrderItem.discountCents`: o desconto de cada encomenda e a parte
--      de cada linha (a fatura parte as linhas por aqui).
--
-- Toda aditiva: a API de antes continua a funcionar com ela aplicada (não lê
-- as colunas novas; `category` continua preenchida). Aplicar ANTES do deploy
-- da API nova.

-- CreateEnum
CREATE TYPE "SiteDiscountKind" AS ENUM ('PERCENT', 'FIXED');

-- AlterTable
ALTER TABLE "SiteProduct" ADD COLUMN "slug" TEXT,
ADD COLUMN "categoryId" TEXT,
ADD COLUMN "compareAtPriceCents" INTEGER,
ADD COLUMN "isNew" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "seoTitle" TEXT NOT NULL DEFAULT '',
ADD COLUMN "seoDescription" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "SiteOrder" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "discountCode" TEXT,
ADD COLUMN "discountCodeId" TEXT;

-- AlterTable
ALTER TABLE "SiteOrderItem" ADD COLUMN "discountCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SiteProductCategory" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDiscountCode" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "SiteDiscountKind" NOT NULL DEFAULT 'PERCENT',
    "value" INTEGER NOT NULL,
    "freeShipping" BOOLEAN NOT NULL DEFAULT false,
    "minOrderCents" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "maxUses" INTEGER,
    "oncePerCustomer" BOOLEAN NOT NULL DEFAULT false,
    "categoryIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeOnSale" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDiscountCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteProductCategory_academyId_slug_key" ON "SiteProductCategory"("academyId", "slug");
CREATE INDEX "SiteProductCategory_academyId_position_idx" ON "SiteProductCategory"("academyId", "position");
CREATE UNIQUE INDEX "SiteDiscountCode_academyId_code_key" ON "SiteDiscountCode"("academyId", "code");
CREATE INDEX "SiteProduct_categoryId_idx" ON "SiteProduct"("categoryId");

-- AddForeignKey
ALTER TABLE "SiteProductCategory" ADD CONSTRAINT "SiteProductCategory_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteDiscountCode" ADD CONSTRAINT "SiteDiscountCode_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteProduct" ADD CONSTRAINT "SiteProduct_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "SiteProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- SET NULL: apagar um código não mexe nas encomendas; ficam com o texto (`discountCode`) e o valor.
ALTER TABLE "SiteOrder" ADD CONSTRAINT "SiteOrder_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "SiteDiscountCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: cada clube só vê as suas categorias e os seus códigos.
-- ---------------------------------------------------------------------------

ALTER TABLE "SiteProductCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteProductCategory" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteProductCategory";
CREATE POLICY tenant_isolation ON "SiteProductCategory"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SiteDiscountCode" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteDiscountCode" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteDiscountCode";
CREATE POLICY tenant_isolation ON "SiteDiscountCode"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteProductCategory", "SiteDiscountCode" TO academia_app;

-- ---------------------------------------------------------------------------
-- Os dados de agora: as categorias de texto passam a categorias, e cada
-- produto ganha um endereço a partir do nome (sem acentos, com hífenes,
-- e um sufixo curto do id quando o nome se repete no clube).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION pg_temp.slug_de(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(NULLIF(trim(BOTH '-' FROM regexp_replace(
    translate(lower(t), 'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'),
    '[^a-z0-9]+', '-', 'g')), ''), 'artigo')
$$;

INSERT INTO "SiteProductCategory" ("id", "academyId", "name", "slug", "position", "updatedAt")
SELECT 'cat_' || md5(c."academyId" || ':' || c.nome), c."academyId", c.nome,
       pg_temp.slug_de(c.nome) || CASE WHEN c.rep > 1 THEN '-' || substr(md5(c.nome), 1, 5) ELSE '' END,
       c.ordem - 1, CURRENT_TIMESTAMP
  FROM (
    SELECT x."academyId", x.nome,
           row_number() OVER (PARTITION BY x."academyId" ORDER BY x.primeira, x.nome) AS ordem,
           row_number() OVER (PARTITION BY x."academyId", pg_temp.slug_de(x.nome) ORDER BY x.nome) AS rep
      FROM (
        SELECT "academyId", trim("category") AS nome, MIN("position") AS primeira
          FROM "SiteProduct"
         WHERE trim("category") <> ''
         GROUP BY "academyId", trim("category")
      ) x
  ) c;

UPDATE "SiteProduct" p
   SET "categoryId" = 'cat_' || md5(p."academyId" || ':' || trim(p."category"))
 WHERE trim(p."category") <> '';

UPDATE "SiteProduct" p
   SET "slug" = s.base || CASE WHEN s.rep > 1 THEN '-' || substr(md5(p.id), 1, 5) ELSE '' END
  FROM (
    SELECT id, pg_temp.slug_de("name") AS base,
           row_number() OVER (PARTITION BY "academyId", pg_temp.slug_de("name") ORDER BY "position", "createdAt") AS rep
      FROM "SiteProduct"
  ) s
 WHERE s.id = p.id;

-- CreateIndex (depois de preenchido: dois nomes iguais já levaram o sufixo)
CREATE UNIQUE INDEX "SiteProduct_academyId_slug_key" ON "SiteProduct"("academyId", "slug");
