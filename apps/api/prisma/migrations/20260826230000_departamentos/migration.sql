-- Departamentos deixam de ser um enum e passam a ser linhas.
--
-- ## Porquê
--
-- Pediam-se duas coisas que um enum não dá: **criar** departamentos a partir da
-- consola, e guardar as **permissões** de cada um. O ecrã de criar cargos
-- perguntava "Âmbito" a cada cargo, e ninguém percebia a pergunta — porque era
-- uma decisão sobre o departamento a ser repetida no sítio errado. Com uma linha
-- por departamento, a pergunta faz-se uma vez, onde pertence.
--
-- ## O que esta migração faz
--
-- 1. Cria `Department`, com RLS igual às outras tabelas de domínio.
-- 2. Semeia os quatro de origem em cada academia que já existe, com as
--    permissões e os menus que os cargos de lá já usavam.
-- 3. Liga `AcademyRole.departmentId` e converte o enum antigo por nome.
--
-- O enum `StaffDepartment` **fica**: `Membership.department` e
-- `StaffInvite.department` ainda o usam para agrupar staff nas listas, e essa
-- conversão é outra migração. Aqui muda só quem decide permissões.

CREATE TABLE "Department" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "baseRole"    "Role" NOT NULL DEFAULT 'STAFF',
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "navKeys"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "order"       INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Department_academyId_key_key" ON "Department"("academyId", "key");
CREATE INDEX "Department_academyId_idx" ON "Department"("academyId");

ALTER TABLE "Department"
  ADD CONSTRAINT "Department_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AcademyRole" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "AcademyRole"
  ADD CONSTRAINT "AcademyRole_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "AcademyRole_departmentId_idx" ON "AcademyRole"("departmentId");

-- ---------------------------------------------------------------------------
-- Semear os quatro de origem.
--
-- As permissões de cada um são a **união** do que os cargos existentes desse
-- departamento já tinham. Assim ninguém perde nada com esta migração: o
-- departamento nasce a poder o que a sua gente já podia. Numa academia nova (ou
-- num departamento sem cargos), fica a lista fixa escrita aqui.

INSERT INTO "Department" ("id", "academyId", "key", "name", "description", "baseRole", "permissions", "navKeys", "isSystem", "order", "updatedAt")
SELECT
  'dep_' || substr(md5(a."id" || d.key), 1, 20),
  a."id",
  d.key,
  d.name,
  d.description,
  d.base::"Role",
  d.perms,
  ARRAY[]::TEXT[],
  true,
  d.ord,
  NOW()
FROM "Academy" a
CROSS JOIN (VALUES
  ('direcao', 'Direção', 'Responde pelo clube: sócios, mensalidades, staff e definições.', 'DIRECTOR', 0,
   ARRAY['team:read','team:write','athlete:read','athlete:write','calendar:read','calendar:write','attendance:read','attendance:write','member:read','member:write','billing:read','billing:write','comms:read','comms:write','staff:read','staff:write','clinical:status','document:read','document:write','media:read','media:write','role:read','role:write','role:menu','academy:write']),
  ('tecnica', 'Equipa Técnica', 'Treina: as suas equipas, presenças, convocatórias e calendário.', 'COACH', 1,
   ARRAY['team:read','athlete:read','calendar:read','calendar:write','attendance:read','attendance:write','comms:read','clinical:status','document:read','media:read','media:write']),
  ('clinico', 'Departamento Clínico', 'Dá baixas e altas, e é quem vê o boletim clínico.', 'STAFF', 2,
   ARRAY['team:read','athlete:read','calendar:read','clinical:status','clinical:read','clinical:write','document:read','comms:read']),
  ('scouting', 'Departamento Scouting', 'Observa, avalia e recruta.', 'STAFF', 3,
   ARRAY['team:read','athlete:read','calendar:read','scouting:read','scouting:write','comms:read','document:read'])
) AS d(key, name, description, base, ord, perms);

-- Onde já havia cargos, o departamento herda a união do que eles podiam.
UPDATE "Department" dep SET "permissions" = u.perms
FROM (
  SELECT r."academyId",
         CASE r."department"
           WHEN 'DIRECTION' THEN 'direcao' WHEN 'TECHNICAL' THEN 'tecnica'
           WHEN 'CLINICAL'  THEN 'clinico' WHEN 'SCOUTING'  THEN 'scouting'
         END AS key,
         ARRAY(SELECT DISTINCT unnest(array_agg(p)) ORDER BY 1) AS perms
  FROM "AcademyRole" r, unnest(r."permissions") p
  WHERE r."department" IS NOT NULL AND r."department" <> 'OPERATIONS'
  GROUP BY r."academyId", r."department"
) u
WHERE dep."academyId" = u."academyId" AND dep."key" = u.key;

-- E os cargos passam a apontar para a linha.
UPDATE "AcademyRole" r SET "departmentId" = dep."id"
FROM "Department" dep
WHERE dep."academyId" = r."academyId"
  AND dep."key" = CASE r."department"
        WHEN 'DIRECTION' THEN 'direcao' WHEN 'TECHNICAL' THEN 'tecnica'
        WHEN 'CLINICAL'  THEN 'clinico' WHEN 'SCOUTING'  THEN 'scouting'
      END;

-- ---------------------------------------------------------------------------
-- RLS.
--
-- Mesma política das outras tabelas de domínio. Sem contexto de academia,
-- `app.current_academy_id()` é NULL e nenhuma linha passa — falha fechado. Uma
-- tabela que decide permissões não pode ser a que fica de fora.

ALTER TABLE "Department" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Department" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Department";
CREATE POLICY tenant_isolation ON "Department"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "Department" TO academia_app;
