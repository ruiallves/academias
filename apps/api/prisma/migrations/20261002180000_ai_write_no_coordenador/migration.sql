-- O coordenador passa a ter `ai:write`.
--
-- O treinador tem-na desde `20260902200000_academias_ai`; o coordenador ficou só
-- com `ai:read`. Como não se convida para um cargo que dá o que o convidante
-- não tem, um coordenador deixou de conseguir convidar treinadores — e a
-- mensagem falava de uma permissão que nem aparece no editor de cargos.
--
-- Só toca em cargos e departamentos de coordenação que já leem a área
-- (`ai:read`): os que o clube desenhou sem ela (uma secretaria, um financeiro)
-- ficam como estão.

UPDATE "AcademyRole"
   SET permissions = permissions || ARRAY['ai:write'],
       "updatedAt" = now()
 WHERE "baseRole" = 'COORDINATOR'
   AND permissions @> ARRAY['ai:read']
   AND NOT permissions @> ARRAY['ai:write'];

UPDATE "Department"
   SET permissions = permissions || ARRAY['ai:write'],
       "updatedAt" = now()
 WHERE "baseRole" = 'COORDINATOR'
   AND permissions @> ARRAY['ai:read']
   AND NOT permissions @> ARRAY['ai:write'];
