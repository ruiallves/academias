-- Os departamentos de sistema passam a valer o que o seu papel-base promete.
--
-- ## O que estava errado
--
-- A migração `20260826230000_departamentos` escreveu as quatro linhas com listas
-- de permissões **à mão, em SQL**, ao lado de `SEED_DEPARTMENTS` — que semeia as
-- mesmas quatro a partir de `ROLE_PERMISSIONS`. Duas definições da mesma coisa, e
-- a do SQL ganhou porque correu primeiro. Divergiram em dois pontos:
--
--  1. **As permissões.** O Departamento Scouting ficou com `scouting:read` e
--     `scouting:write` e sem `scouting:video:*` — um departamento de olheiros que
--     não podia ver nem carregar vídeo, que é metade do trabalho. A Direção e a
--     Equipa Técnica ficaram igualmente curtas.
--
--  2. **O papel-base**, que é pior. O SQL pôs `STAFF` no Clínico e no Scouting;
--     a lista em código diz `MEDICAL` e `SCOUT`. E `baseRole` não é decoração:
--     `teamScopeFilter` deixa MEDICAL e SCOUT ver o clube inteiro de propósito —
--     "um prospecto não pertence a equipa nenhuma" — enquanto STAFF fica preso às
--     equipas onde está atribuído. Um olheiro não está atribuído a nenhuma, por
--     isso a lista vinha vazia. O departamento nascia sem alcance.
--
-- Academias criadas depois disto não têm o problema: nascem por
-- `DepartmentsService.list()`, que lê `ROLE_PERMISSIONS`. Só as que já existiam
-- quando aquela migração correu é que ficaram assim.
--
-- ## O que isto muda, e o que não muda
--
-- Um departamento é um **modelo**: as permissões que valem em tempo de execução
-- são as de `AcademyRole`, copiadas na criação do cargo (ver `auth.service.ts`,
-- `effectivePermissions`). Mexer aqui muda o ponto de partida dos cargos novos e
-- não toca em ninguém que já esteja a trabalhar.
--
-- A excepção é o passo 3, e é deliberada: os cargos que herdaram `STAFF` de um
-- departamento que devia ter dito `MEDICAL` ou `SCOUT` ficam com o âmbito
-- corrigido. Sem isso, o "Head Of Scouting" continuava a não ver atleta nenhum.
-- As permissões desses cargos não se tocam — só o âmbito que o departamento lhes
-- devia ter dado à partida.
--
-- Este ficheiro é **gerado** a partir de `ROLE_PERMISSIONS` (ver
-- `scripts/gerar-migracao-departamentos.cjs`), para as duas listas não voltarem a
-- divergir por alguém editar uma e esquecer a outra.

-- 1. O papel-base que a lista em código sempre disse.
UPDATE "Department" SET "baseRole" = 'MEDICAL'
 WHERE "key" = 'clinico'  AND "isSystem" = true AND "baseRole" = 'STAFF';
UPDATE "Department" SET "baseRole" = 'SCOUT'
 WHERE "key" = 'scouting' AND "isSystem" = true AND "baseRole" = 'STAFF';

-- 2. O piso de permissões. União, nunca substituição: o que alguém tenha
--    acrescentado a um departamento fica onde está.
UPDATE "Department" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['academy:read','academy:write','access:write','athlete:read','athlete:write','attendance:read','attendance:write','billing:read','billing:write','calendar:read','calendar:write','clinical:read','clinical:status','clinical:write','comms:read','comms:write','evaluation:read','evaluation:write','family:read','family:write','member:read','member:write','report:read','report:write','scouting:read','scouting:request','scouting:video:read','scouting:video:write','scouting:write','settings:write','staff:read','staff:write','team:read','team:write']) ORDER BY 1)
 WHERE "key" = 'direcao' AND "isSystem" = true AND NOT ("permissions" @> ARRAY['academy:read','academy:write','access:write','athlete:read','athlete:write','attendance:read','attendance:write','billing:read','billing:write','calendar:read','calendar:write','clinical:read','clinical:status','clinical:write','comms:read','comms:write','evaluation:read','evaluation:write','family:read','family:write','member:read','member:write','report:read','report:write','scouting:read','scouting:request','scouting:video:read','scouting:video:write','scouting:write','settings:write','staff:read','staff:write','team:read','team:write']);

UPDATE "Department" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['academy:read','athlete:read','athlete:write','attendance:read','attendance:write','calendar:read','calendar:write','clinical:read','clinical:status','comms:read','comms:write','evaluation:read','evaluation:write','family:read','report:read','report:write','scouting:request','team:read']) ORDER BY 1)
 WHERE "key" = 'tecnica' AND "isSystem" = true AND NOT ("permissions" @> ARRAY['academy:read','athlete:read','athlete:write','attendance:read','attendance:write','calendar:read','calendar:write','clinical:read','clinical:status','comms:read','comms:write','evaluation:read','evaluation:write','family:read','report:read','report:write','scouting:request','team:read']);

UPDATE "Department" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['academy:read','athlete:read','calendar:read','clinical:read','clinical:status','clinical:write','report:read','team:read']) ORDER BY 1)
 WHERE "key" = 'clinico' AND "isSystem" = true AND NOT ("permissions" @> ARRAY['academy:read','athlete:read','calendar:read','clinical:read','clinical:status','clinical:write','report:read','team:read']);

UPDATE "Department" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY['academy:read','athlete:read','calendar:read','report:read','scouting:read','scouting:request','scouting:video:read','scouting:video:write','scouting:write','team:read']) ORDER BY 1)
 WHERE "key" = 'scouting' AND "isSystem" = true AND NOT ("permissions" @> ARRAY['academy:read','athlete:read','calendar:read','report:read','scouting:read','scouting:request','scouting:video:read','scouting:video:write','scouting:write','team:read']);

-- 3. Os cargos que herdaram o papel-base errado, e só esses.
--    `rank` acompanha: MEDICAL e SCOUT valem 40, STAFF vale 20, e é o rank
--    que decide quem pode criar e editar quem.
UPDATE "AcademyRole" r SET "baseRole" = d."baseRole", "rank" = 40
  FROM "Department" d
 WHERE d."id" = r."departmentId"
   AND d."isSystem" = true
   AND d."key" IN ('clinico', 'scouting')
   AND r."baseRole" = 'STAFF';
