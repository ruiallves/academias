-- Papéis da academia
--
-- O mapa papel→permissões estava em código, em duplicado (servidor e consola), e
-- era por isso que criar um papel novo exigia um deploy. Passa a ser uma linha por
-- academia.
--
-- ## O enum `Role` fica
--
-- Não é indecisão: o enum decide o que uma lista de permissões não sabe decidir —
-- de onde vem o âmbito (`TeamStaff` para o treinador, `GuardianLink` para o pai),
-- quem é pessoal e quem é família, e a hierarquia que trava os convites. A tabela
-- nova decide o que cada papel **pode** e **vê**; o enum continua a decidir o que
-- cada papel **é**.
--
-- ## Compatível por construção
--
-- `Membership.customRoleId` nasce nulo em todas as linhas existentes, e nulo
-- significa "os valores por omissão do enum". Ninguém ganha nem perde acesso no
-- dia da migração; os papéis semeados só passam a valer quando alguém for
-- atribuído a eles.

-- ---------------------------------------------------------------------------
-- Novo papel-base: departamento de scouting
-- ---------------------------------------------------------------------------
--
-- Aditivo. `ADD VALUE` numa transação é aceite desde o Postgres 12 desde que o
-- valor novo não seja usado na mesma transação — não é: quem o usa é a semeadura,
-- depois.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SCOUT';
ALTER TYPE "StaffDepartment" ADD VALUE IF NOT EXISTS 'SCOUTING';

-- ---------------------------------------------------------------------------
-- A tabela
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AcademyRole" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "key"         TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "baseRole"    "Role" NOT NULL,
  "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "navKeys"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "isSystem"    BOOLEAN NOT NULL DEFAULT false,
  "rank"        INTEGER NOT NULL DEFAULT 20,
  "archivedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcademyRole_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AcademyRole_academyId_key_key" ON "AcademyRole"("academyId", "key");
CREATE INDEX IF NOT EXISTS "AcademyRole_academyId_idx" ON "AcademyRole"("academyId");

ALTER TABLE "AcademyRole"
  ADD CONSTRAINT "AcademyRole_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- A ligação à pessoa
-- ---------------------------------------------------------------------------
--
-- `ON DELETE SET NULL` e não `CASCADE`: apagar um papel nunca pode apagar
-- pessoas. Cai-se nos valores por omissão do papel-base, que é o comportamento
-- seguro — e o serviço recusa apagar um papel que ainda tenha gente, por isso
-- isto é só a rede por baixo.

ALTER TABLE "Membership" ADD COLUMN IF NOT EXISTS "customRoleId" TEXT;

ALTER TABLE "Membership"
  ADD CONSTRAINT "Membership_customRoleId_fkey"
  FOREIGN KEY ("customRoleId") REFERENCES "AcademyRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "Membership_customRoleId_idx" ON "Membership"("customRoleId");

-- ---------------------------------------------------------------------------
-- Isolamento
-- ---------------------------------------------------------------------------
--
-- Mesma política das outras tabelas de domínio. Sem contexto de academia,
-- `app.current_academy_id()` é NULL e nenhuma linha passa — falha fechado. Uma
-- tabela de permissões sem RLS seria a pior de todas a ficar de fora.

ALTER TABLE "AcademyRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AcademyRole" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AcademyRole";
CREATE POLICY tenant_isolation ON "AcademyRole"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "AcademyRole" TO academia_app;
