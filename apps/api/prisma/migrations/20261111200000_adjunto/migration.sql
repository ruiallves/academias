-- O Adjunto: o assistente com IA da consola.
--
-- Cinco tabelas novas e uma coluna no clube. As conversas e as mensagens
-- guardam o que a pessoa disse e o que o modelo respondeu; as propostas são
-- o que a IA quer escrever e que só se grava depois de alguém confirmar; o
-- uso conta tokens por clube, mês e modelo; as importações guardam um
-- ficheiro lido, o mapeamento das colunas e o ensaio.
--
-- Toda aditiva: pode aplicar-se com a API antiga em serviço. O servidor
-- antigo não toca em nada disto; o novo precisa das tabelas para as rotas
-- `/api/adjunto`.

-- 1. A coluna no clube ---------------------------------------------------------

ALTER TABLE "Academy" ADD COLUMN IF NOT EXISTS "adjuntoEnabled" BOOLEAN NOT NULL DEFAULT true;

-- 2. Os tipos -----------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "AdjuntoRole" AS ENUM ('USER', 'ASSISTANT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AdjuntoProposalKind" AS ENUM ('ATTENDANCE', 'CLINICAL', 'CALLUPS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AdjuntoProposalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'UNDONE', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AdjuntoImportStatus" AS ENUM ('REHEARSED', 'IMPORTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. As conversas -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AdjuntoConversation" (
  "id"           TEXT NOT NULL,
  "academyId"    TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "title"        TEXT NOT NULL DEFAULT '',
  "context"      JSONB,
  "escalated"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdjuntoConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdjuntoConversation_academyId_membershipId_updatedAt_idx"
  ON "AdjuntoConversation"("academyId", "membershipId", "updatedAt");

ALTER TABLE "AdjuntoConversation"
  ADD CONSTRAINT "AdjuntoConversation_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. As mensagens -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AdjuntoMessage" (
  "id"             TEXT NOT NULL,
  "academyId"      TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role"           "AdjuntoRole" NOT NULL,
  "text"           TEXT NOT NULL DEFAULT '',
  "blocks"         JSONB NOT NULL DEFAULT '[]',
  "items"          JSONB NOT NULL DEFAULT '[]',
  "model"          TEXT,
  "inputTokens"    INTEGER NOT NULL DEFAULT 0,
  "cachedTokens"   INTEGER NOT NULL DEFAULT 0,
  "outputTokens"   INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdjuntoMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdjuntoMessage_conversationId_createdAt_idx"
  ON "AdjuntoMessage"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AdjuntoMessage_academyId_idx"
  ON "AdjuntoMessage"("academyId");

ALTER TABLE "AdjuntoMessage"
  ADD CONSTRAINT "AdjuntoMessage_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdjuntoMessage"
  ADD CONSTRAINT "AdjuntoMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AdjuntoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. As propostas -------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AdjuntoProposal" (
  "id"             TEXT NOT NULL,
  "academyId"      TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "membershipId"   TEXT NOT NULL,
  "kind"           "AdjuntoProposalKind" NOT NULL,
  "status"         "AdjuntoProposalStatus" NOT NULL DEFAULT 'PENDING',
  "title"          TEXT NOT NULL,
  "summary"        TEXT NOT NULL DEFAULT '',
  "payload"        JSONB NOT NULL,
  "undo"           JSONB,
  "result"         JSONB,
  "confirmedAt"    TIMESTAMP(3),
  "undoneAt"       TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdjuntoProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdjuntoProposal_academyId_conversationId_idx"
  ON "AdjuntoProposal"("academyId", "conversationId");
CREATE INDEX IF NOT EXISTS "AdjuntoProposal_academyId_status_createdAt_idx"
  ON "AdjuntoProposal"("academyId", "status", "createdAt");

ALTER TABLE "AdjuntoProposal"
  ADD CONSTRAINT "AdjuntoProposal_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdjuntoProposal"
  ADD CONSTRAINT "AdjuntoProposal_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AdjuntoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. O uso --------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AdjuntoUsage" (
  "id"           TEXT NOT NULL,
  "academyId"    TEXT NOT NULL,
  "month"        TEXT NOT NULL,
  "model"        TEXT NOT NULL,
  "requests"     INTEGER NOT NULL DEFAULT 0,
  "inputTokens"  INTEGER NOT NULL DEFAULT 0,
  "cachedTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "updatedAt"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdjuntoUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AdjuntoUsage_academyId_month_model_key"
  ON "AdjuntoUsage"("academyId", "month", "model");

ALTER TABLE "AdjuntoUsage"
  ADD CONSTRAINT "AdjuntoUsage_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 7. As importações -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AdjuntoImport" (
  "id"             TEXT NOT NULL,
  "academyId"      TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "membershipId"   TEXT NOT NULL,
  "fileName"       TEXT NOT NULL,
  "fileType"       TEXT NOT NULL,
  "status"         "AdjuntoImportStatus" NOT NULL DEFAULT 'REHEARSED',
  "sheets"         JSONB NOT NULL,
  "mapping"        JSONB,
  "rehearsal"      JSONB,
  "result"         JSONB,
  "error"          TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AdjuntoImport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AdjuntoImport_academyId_conversationId_idx"
  ON "AdjuntoImport"("academyId", "conversationId");

ALTER TABLE "AdjuntoImport"
  ADD CONSTRAINT "AdjuntoImport_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdjuntoImport"
  ADD CONSTRAINT "AdjuntoImport_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AdjuntoConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 8. RLS, em todas ------------------------------------------------------------

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['AdjuntoConversation', 'AdjuntoMessage', 'AdjuntoProposal', 'AdjuntoUsage', 'AdjuntoImport'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("academyId" = app.current_academy_id()) WITH CHECK ("academyId" = app.current_academy_id())',
      t
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO academia_app', t);
  END LOOP;
END $$;

-- 9. O menu --------------------------------------------------------------------
--
-- A entrada "Adjunto" no menu da consola (chave `adjunto`). Os cargos que
-- escolheram os menus à mão (`navKeys` não vazio) não a veriam: entra em todos.

UPDATE "AcademyRole"
   SET "navKeys" = array_append("navKeys", 'adjunto'),
       "updatedAt" = now()
 WHERE cardinality("navKeys") > 0
   AND NOT 'adjunto' = ANY("navKeys");

UPDATE "Department"
   SET "navKeys" = array_append("navKeys", 'adjunto'),
       "updatedAt" = now()
 WHERE cardinality("navKeys") > 0
   AND NOT 'adjunto' = ANY("navKeys");
