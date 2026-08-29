-- A área técnica chega aos cargos que já existiam.
--
-- ## Porque é que isto pode ser uma migração
--
-- A regra da casa é que alargar permissões numa base com clientes não é decisão
-- de uma migração (ver `20260828200000`). Mas `training:read` e `training:write`
-- **nasceram agora**: nenhum cargo as tem, e nenhum clube pôde alguma vez decidir
-- tirá-las — não há escolha de ninguém a atropelar. Sem isto, um "Treinador
-- Principal" criado no editor de cargos (que guarda permissões resolvidas) nunca
-- veria a área nova, enquanto um treinador sem cargo (que cai no mapa-base do
-- código) a via — a mesma pessoa, dois comportamentos, e a diferença seria só a
-- data em que o cargo foi criado.
--
-- O critério é o do mapa-base: quem tem base de treinador para cima trabalha na
-- área técnica; clínico, scouting, staff genérico e famílias ficam de fora, como
-- no código.

UPDATE "AcademyRole"
   SET permissions = ARRAY(
         SELECT DISTINCT p
           FROM unnest(permissions || ARRAY['training:read', 'training:write']) AS p
       ),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR', 'COACH')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['training:read'];

-- Os departamentos são o ponto de partida dos cargos novos: sem isto, cada cargo
-- criado amanhã na Equipa Técnica nascia outra vez sem a área.
UPDATE "Department"
   SET permissions = ARRAY(
         SELECT DISTINCT p
           FROM unnest(permissions || ARRAY['training:read', 'training:write']) AS p
       ),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR', 'COORDINATOR', 'COACH')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['training:read'];
