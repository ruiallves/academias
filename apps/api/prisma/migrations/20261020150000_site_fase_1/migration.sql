-- O site do clube, fase 1: o que falta para um clube o pôr no ar a sério.
--
-- Cinco coisas, todas pequenas no esquema:
--
--   1. `SiteMessage` — as mensagens do formulário de contactos do site caem
--      na consola (menu Website › Mensagens) e vão por email ao clube, em vez
--      de abrirem o programa de email de quem escreve.
--   2. `CalendarEvent.isPublic` — um evento do calendário que o clube escolhe
--      mostrar no site (assembleia, jantar, torneio). Falso por omissão.
--   3. `SiteConfig.home` — a ordem das secções da página de início e o banner,
--      para o clube decidir o que vem primeiro.
--   4. `SiteProduct.inventoryItemId` — um artigo do Inventário à venda no site:
--      os tamanhos e o esgotado saem do stock, na leitura.
--   5. A permissão própria do site, `website:read` / `website:write`, no lugar
--      de `settings:write`. Distribuída a quem já tinha `settings:write`, para
--      ninguém perder o menu no deploy; a partir daqui dá-se a quem trata do
--      site (comunicação, marketing) sem lhe dar as Definições.
--
-- A direção e as instalações do clube ficam dentro de `SiteConfig.identity`
-- (JSON), sem coluna nova. Ver `src/site/site.tipos.ts`. Os nomes novos dos
-- temas (Tribuna, Holofote) vão na migração seguinte, de propósito: esta é
-- toda aditiva e pode aplicar-se com a API antiga em serviço; aquela só
-- depois do deploy, porque a API antiga não conhece os nomes novos.

-- ---------------------------------------------------------------------------
-- 1. As mensagens do site
-- ---------------------------------------------------------------------------

CREATE TABLE "SiteMessage" (
  "id"            TEXT NOT NULL,
  "academyId"     TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "email"         TEXT NOT NULL,
  "phone"         TEXT,
  "subject"       TEXT NOT NULL,
  "message"       TEXT NOT NULL,
  "ip"            TEXT,
  "readAt"        TIMESTAMP(3),
  "handledAt"     TIMESTAMP(3),
  "handledByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SiteMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SiteMessage_academyId_createdAt_idx" ON "SiteMessage"("academyId", "createdAt");
CREATE INDEX "SiteMessage_academyId_handledAt_idx" ON "SiteMessage"("academyId", "handledAt");

ALTER TABLE "SiteMessage"
  ADD CONSTRAINT "SiteMessage_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SiteMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteMessage" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteMessage";
CREATE POLICY tenant_isolation ON "SiteMessage"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- ---------------------------------------------------------------------------
-- 2. Eventos públicos
-- ---------------------------------------------------------------------------

ALTER TABLE "CalendarEvent" ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 3. A página de início
-- ---------------------------------------------------------------------------

ALTER TABLE "SiteConfig" ADD COLUMN "home" JSONB NOT NULL DEFAULT '{}';

-- ---------------------------------------------------------------------------
-- 4. Artigos do Inventário à venda no site
-- ---------------------------------------------------------------------------

ALTER TABLE "SiteProduct" ADD COLUMN "inventoryItemId" TEXT;

CREATE UNIQUE INDEX "SiteProduct_inventoryItemId_key" ON "SiteProduct"("inventoryItemId");

ALTER TABLE "SiteProduct"
  ADD CONSTRAINT "SiteProduct_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 5. A permissão do site nos cargos que já existem
--
-- Os cargos guardam permissões resolvidas: sem isto, `website:*` só valia
-- para quem não tem cargo. Vai para quem tinha `settings:write` — eram eles
-- que viam o menu Website até aqui — e para mais ninguém: é o mesmo acesso
-- de ontem, com nome próprio. Ver `prisma/permissoes-distribuidas.json`.
-- ---------------------------------------------------------------------------

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['website:read', 'website:write']) AS p),
       "updatedAt" = now()
 WHERE permissions @> ARRAY['settings:write']
   AND NOT permissions @> ARRAY['website:read', 'website:write'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['website:read', 'website:write']) AS p),
       "updatedAt" = now()
 WHERE permissions @> ARRAY['settings:write']
   AND NOT permissions @> ARRAY['website:read', 'website:write'];
