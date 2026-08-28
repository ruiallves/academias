-- Sócios fora dos cargos que nunca o deviam ter tido
--
-- ## De onde veio
--
-- `member:read`/`member:write` abrem o menu *Sócios* — a lista de sócios do clube,
-- com quotas e contactos. São da direcção: nenhuma das bases COACH, STAFF,
-- MEDICAL, SCOUT ou COORDINATOR as traz.
--
-- Mesmo assim há cargos com base COACH que as têm. Duas coisas se juntaram:
--
--   1. um cargo criado **sem departamento** era semeado a partir de
--      `ROLE_PERMISSIONS.STAFF`, e a base STAFF trouxe `member:read` e
--      `member:write` durante algum tempo (deixou de as trazer depois, com a
--      razão escrita em `common/permissions.ts`);
--   2. o catálogo de áreas do editor de acessos **não tinha linha para Sócios**,
--      por isso a permissão não aparecia em lado nenhum — não se podia dar, e
--      sobretudo não se podia tirar.
--
-- Resultado: um treinador com o menu *Sócios*, sem ninguém ter decidido isso e
-- sem ninguém conseguir desfazê-lo.
--
-- ## Porque é que se pode corrigir sem perguntar ao clube
--
-- Porque ninguém escolheu isto. A permissão nunca esteve visível em ecrã nenhum,
-- portanto nenhum cargo com estas bases a tem por decisão de alguém — tem-na por
-- arrastamento. A partir de agora a linha *Sócios* existe no editor: um clube que
-- queira mesmo o treinador principal a tratar de sócios volta a dá-la, e dessa
-- vez fica escrito onde se vê.
--
-- Os cargos de base OWNER e DIRECTOR não são tocados: aí a permissão é a norma.

UPDATE "AcademyRole"
   SET permissions = ARRAY(
         SELECT p FROM unnest(permissions) AS p
          WHERE p NOT IN ('member:read', 'member:write')
       ),
       "updatedAt" = now()
 WHERE "baseRole" IN ('COACH', 'STAFF', 'MEDICAL', 'SCOUT', 'COORDINATOR')
   AND (permissions && ARRAY['member:read', 'member:write']);

-- O mesmo para os departamentos, pela mesma razão e com o mesmo critério.
UPDATE "Department"
   SET permissions = ARRAY(
         SELECT p FROM unnest(permissions) AS p
          WHERE p NOT IN ('member:read', 'member:write')
       ),
       "updatedAt" = now()
 WHERE "baseRole" IN ('COACH', 'STAFF', 'MEDICAL', 'SCOUT', 'COORDINATOR')
   AND (permissions && ARRAY['member:read', 'member:write']);

-- E as excepções por pessoa: um `grant` de sócios a quem tem um papel técnico
-- seguiria o mesmo caminho invisível. Hoje não há nenhum, mas a regra fica.
UPDATE "Membership"
   SET grants = ARRAY(
         SELECT p FROM unnest(grants) AS p
          WHERE p NOT IN ('member:read', 'member:write')
       )
 WHERE role IN ('COACH', 'STAFF', 'MEDICAL', 'SCOUT', 'COORDINATOR')
   AND (grants && ARRAY['member:read', 'member:write']);
