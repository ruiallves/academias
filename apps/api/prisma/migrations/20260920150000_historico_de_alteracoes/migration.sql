-- O histórico de alterações de uma ficha.
--
-- Quem mudou o quê, quando, e de que valor para que valor. Nasce da pergunta
-- que um clube faz quando um número não bate certo: "isto estava assim ontem?".
-- O peso e a altura de um atleta são o caso típico, mas vale para tudo o que se
-- edita numa ficha: nome, contacto, escalão, número, cargo, acessos, estado.
--
-- Uma linha por **campo** e não por gravação: é o que permite ler "Peso 62 → 64"
-- sem abrir nada, procurar por campo, e mostrar a história de um número só.
--
-- Não substitui o `AuditLog`, que é da plataforma (o que os administradores
-- fazem aos clubes). Este é do clube, e vive dentro do isolamento dele.

DROP TYPE IF EXISTS "ProfileKind";
CREATE TYPE "ProfileKind" AS ENUM ('ATHLETE', 'MEMBER', 'STAFF');

CREATE TABLE "ProfileChange" (
  "id"        TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "kind"      "ProfileKind" NOT NULL,
  -- O atleta, o sócio, ou a membership de quem é do staff.
  "subjectId" TEXT NOT NULL,
  "field"     TEXT NOT NULL,
  "before"    TEXT,
  "after"     TEXT,
  -- Quem mudou. Nulo quando a pessoa deixou o clube (a linha fica).
  "byId"      TEXT,
  -- O nome de quem mudou, à data. Guardado porque um cargo apagado não pode
  -- levar consigo a resposta a "quem fez isto".
  "byName"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProfileChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProfileChange_academyId_kind_subjectId_createdAt_idx"
  ON "ProfileChange"("academyId", "kind", "subjectId", "createdAt" DESC);
CREATE INDEX "ProfileChange_academyId_createdAt_idx" ON "ProfileChange"("academyId", "createdAt" DESC);

ALTER TABLE "ProfileChange"
  ADD CONSTRAINT "ProfileChange_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileChange"
  ADD CONSTRAINT "ProfileChange_byId_fkey"
  FOREIGN KEY ("byId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Isolamento: tem `academyId` próprio, e por isso entra em `TENANT_SCOPED`.
ALTER TABLE "ProfileChange" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProfileChange" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ProfileChange";
CREATE POLICY tenant_isolation ON "ProfileChange"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- Escreve-se e lê-se; não se edita nem se apaga. Um histórico que se corrige
-- não é um histórico.
GRANT SELECT, INSERT ON "ProfileChange" TO academia_app;
