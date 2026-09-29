-- Novidades para os clubes: uma versão escrita no painel, mandada por email aos
-- responsáveis dos clubes escolhidos.
--
-- Duas tabelas **só da plataforma**. Como `Ticket` e `PlatformAdmin`, a ligação
-- das academias (`academia_app`) não recebe privilégio nenhum sobre elas: a
-- separação é do Postgres e não de um `if` que alguém se pode esquecer de
-- escrever. Ver a nota no topo da migração `20260816000600_platform`.
--
-- `ReleaseRecipient` tem uma coluna `academyId` e **não** tem RLS. É de
-- propósito, e o `test:rls-cobertura` aceita-o pela segunda via que ele
-- verifica: uma tabela sem qualquer privilégio para `academia_app` não precisa
-- de política, porque nenhum pedido de academia lhe chega.

CREATE TABLE "Release" (
  "id"        TEXT         NOT NULL,
  "version"   TEXT         NOT NULL,
  "title"     TEXT         NOT NULL,
  "notes"     TEXT         NOT NULL,
  "sentAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "authorId"  TEXT,

  CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Release_sentAt_idx" ON "Release"("sentAt");

ALTER TABLE "Release"
  ADD CONSTRAINT "Release_authorId_fkey" FOREIGN KEY ("authorId")
  REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ReleaseRecipient" (
  "id"          TEXT NOT NULL,
  "releaseId"   TEXT NOT NULL,
  -- Sem chave estrangeira para "Academy": apagar um clube não pode apagar o
  -- registo de lhe termos escrito.
  "academyId"   TEXT NOT NULL,
  "academyName" TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "sentAt"      TIMESTAMP(3),
  "error"       TEXT,

  CONSTRAINT "ReleaseRecipient_pkey" PRIMARY KEY ("id")
);

-- Um clube, uma linha por versão. É o que torna reenviar uma versão idempotente
-- por clube em vez de duplicar o histórico.
CREATE UNIQUE INDEX "ReleaseRecipient_releaseId_academyId_key"
  ON "ReleaseRecipient"("releaseId", "academyId");
CREATE INDEX "ReleaseRecipient_academyId_idx" ON "ReleaseRecipient"("academyId");

ALTER TABLE "ReleaseRecipient"
  ADD CONSTRAINT "ReleaseRecipient_releaseId_fkey" FOREIGN KEY ("releaseId")
  REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Só a plataforma. Ver a nota no topo.

REVOKE ALL ON "Release" FROM academia_app;
REVOKE ALL ON "ReleaseRecipient" FROM academia_app;
