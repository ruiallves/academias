-- Patrocinadores e parcerias dos sócios.
--
-- A lista de patrocinadores do site (`SiteSponsor`) passa a ser a lista do
-- clube: gere-se em Gestão → Patrocinadores, o site mostra-a (Connect Pro) e
-- a app do sócio mostra-a no separador Parcerias, com a vantagem de cada um.
--
--   1. `SiteSponsor.benefit` — a vantagem para os sócios. Vazio = só patrocinador.
--   2. A permissão `sponsor:read` / `sponsor:write`, para quem já tinha
--      `settings:write` ou `website:write` (quem já mexia nos patrocinadores
--      pelo menu Website). Os cargos guardam permissões resolvidas: sem isto o
--      menu novo não chegava a nenhum clube.
--   3. O menu `sponsors` nos cargos que escolheram os menus à mão (`navKeys`
--      não vazio) e que já viam o Website ou os Sócios.
--
-- Toda aditiva: pode aplicar-se com a API antiga em serviço.

-- 1. A vantagem ----------------------------------------------------------------

ALTER TABLE "SiteSponsor" ADD COLUMN "benefit" TEXT NOT NULL DEFAULT '';

-- 2. A permissão ---------------------------------------------------------------

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['sponsor:read', 'sponsor:write']) AS p),
       "updatedAt" = now()
 WHERE (permissions @> ARRAY['settings:write'] OR permissions @> ARRAY['website:write'])
   AND NOT permissions @> ARRAY['sponsor:read', 'sponsor:write'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['sponsor:read', 'sponsor:write']) AS p),
       "updatedAt" = now()
 WHERE (permissions @> ARRAY['settings:write'] OR permissions @> ARRAY['website:write'])
   AND NOT permissions @> ARRAY['sponsor:read', 'sponsor:write'];

-- 3. O menu --------------------------------------------------------------------

UPDATE "AcademyRole"
   SET "navKeys" = array_append("navKeys", 'sponsors'),
       "updatedAt" = now()
 WHERE cardinality("navKeys") > 0
   AND "navKeys" && ARRAY['website', 'members']
   AND NOT 'sponsors' = ANY("navKeys");

UPDATE "Department"
   SET "navKeys" = array_append("navKeys", 'sponsors'),
       "updatedAt" = now()
 WHERE cardinality("navKeys") > 0
   AND "navKeys" && ARRAY['website', 'members']
   AND NOT 'sponsors' = ANY("navKeys");
