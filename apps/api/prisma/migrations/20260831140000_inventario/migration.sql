-- Inventário: o armazém do clube, que até aqui vivia em folhas de Excel e
-- palitos numa folha A4.
--
-- ## O stock vive na variante, nunca no artigo
--
-- "T-shirt de aquecimento" é um artigo com seis tamanhos. O stock está em cada
-- tamanho, porque é aí que ele existe — um M esgotado não se resolve com um XXL
-- a mais. Um artigo sem tamanhos tem uma variante só, chamada "Único": a regra
-- passa a ser uma, e nenhum caminho de escrita precisa de a duplicar.
--
-- ## O disponível não é uma coluna
--
-- Guardam-se as unidades vivas e as que estão com atletas; o disponível é a
-- subtracção, feita na leitura. Uma terceira coluna seria a mesma verdade
-- escrita duas vezes, e a cópia diverge à primeira operação que falhe a meio.
-- É a regra que a carga de treino e a disponibilidade clínica já seguem.
--
-- ## As categorias e as localizações não são tabelas novas
--
-- São `CatalogItem`, como os locais, os balneários e as competições — com
-- ordenação, arquivo e o ecrã de definições já feitos. Uma tabela
-- `InventoryCategory` seria a quinta cópia da mesma coisa.

CREATE TYPE "InventoryMovementType" AS ENUM ('ENTRY', 'EXIT', 'ADJUSTMENT', 'ASSIGNMENT', 'RETURN', 'DAMAGE', 'LOSS');
CREATE TYPE "InventoryAssignmentStatus" AS ENUM ('ACTIVE', 'RETURNED', 'DAMAGED', 'LOST');

CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "categoryId" TEXT,
    "locationId" TEXT,
    "sku" TEXT,
    "brand" TEXT,
    "minimumStock" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryVariant" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sku" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "minimumStock" INTEGER,
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "assignedQuantity" INTEGER NOT NULL DEFAULT 0,
    "damagedQuantity" INTEGER NOT NULL DEFAULT 0,
    "lostQuantity" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryVariant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryAssignment" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "athleteId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "status" "InventoryAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "seasonId" TEXT,
    "notes" TEXT,
    "assignedById" TEXT,
    "returnedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InventoryAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "athleteId" TEXT,
    "assignmentId" TEXT,
    "locationId" TEXT,
    "reason" TEXT,
    "performedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryItem_academyId_archivedAt_idx" ON "InventoryItem"("academyId", "archivedAt");
CREATE INDEX "InventoryItem_academyId_categoryId_idx" ON "InventoryItem"("academyId", "categoryId");
CREATE INDEX "InventoryVariant_academyId_idx" ON "InventoryVariant"("academyId");
CREATE INDEX "InventoryVariant_itemId_order_idx" ON "InventoryVariant"("itemId", "order");
CREATE INDEX "InventoryAssignment_academyId_status_idx" ON "InventoryAssignment"("academyId", "status");
CREATE INDEX "InventoryAssignment_athleteId_status_idx" ON "InventoryAssignment"("athleteId", "status");
CREATE INDEX "InventoryAssignment_variantId_status_idx" ON "InventoryAssignment"("variantId", "status");
CREATE INDEX "InventoryMovement_academyId_createdAt_idx" ON "InventoryMovement"("academyId", "createdAt");
CREATE INDEX "InventoryMovement_variantId_createdAt_idx" ON "InventoryMovement"("variantId", "createdAt");

ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryVariant" ADD CONSTRAINT "InventoryVariant_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryVariant" ADD CONSTRAINT "InventoryVariant_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "InventoryVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryAssignment" ADD CONSTRAINT "InventoryAssignment_returnedById_fkey" FOREIGN KEY ("returnedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "InventoryVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "InventoryAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento por academia.
--
-- A mesma política de sempre, na coluna e não na aplicação: um pedido que perca
-- o contexto do clube não devolve o inventário de outro — não devolve nada. As
-- quatro tabelas têm `academyId` próprio, incluindo a variante, precisamente
-- para nenhuma delas depender de uma junção para ser protegida.
-- ---------------------------------------------------------------------------

ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InventoryItem";
CREATE POLICY tenant_isolation ON "InventoryItem"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "InventoryVariant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryVariant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InventoryVariant";
CREATE POLICY tenant_isolation ON "InventoryVariant"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "InventoryAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryAssignment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InventoryAssignment";
CREATE POLICY tenant_isolation ON "InventoryAssignment"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "InventoryMovement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InventoryMovement" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InventoryMovement";
CREATE POLICY tenant_isolation ON "InventoryMovement"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE
   ON "InventoryItem", "InventoryVariant", "InventoryAssignment", "InventoryMovement"
   TO academia_app;

-- ---------------------------------------------------------------------------
-- As permissões novas chegam aos cargos que já existem.
--
-- Sem isto, `inventory:read` e `inventory:write` só valeriam para quem não tem
-- cargo — ou seja, para a academia de demonstração e mais ninguém. É a armadilha
-- que apanhou `training:*` e `team:delete`, e que o guarda
-- `scripts/check-permissions.mjs` passou a vigiar.
--
-- **Ler** acompanha quem já vê a operação do clube: presidência, direção e
-- coordenação. **Escrever** fica na presidência e na direção, como o resto do
-- `WRITE_ALL` — e delega-se a quem trata do material (secretaria, roupeiro) no
-- editor de cargos, que é precisamente para isso que ele existe.
-- ---------------------------------------------------------------------------

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['inventory:read']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['inventory:read'];

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['inventory:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['inventory:write'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['inventory:read']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['inventory:read'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['inventory:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['inventory:write'];
