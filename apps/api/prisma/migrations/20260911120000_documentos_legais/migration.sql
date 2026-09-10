-- ---------------------------------------------------------------------------
-- Documentos legais versionados e o registo das aceitações.
--
-- ## O que isto cria, e o que não faz
--
-- Duas tabelas novas e nada mais: nenhuma coluna existente muda, nenhuma linha
-- existente é tocada. Aplicar esta migração **não bloqueia ninguém** — o gate
-- só passa a existir quando houver uma versão publicada de um documento, e isso
-- é o `seed:legal` (ou a plataforma) a fazê-lo, de propósito, noutro passo.
--
-- ## `LegalDocument` — global, e só de leitura para as academias
--
-- Os documentos são os mesmos para todos os clubes. O papel `academia_app` lê o
-- que está publicado e mais nada: rascunhos não saem daqui, e escrever é da
-- plataforma, pela ligação dela. A migração de RLS deixou um `ALTER DEFAULT
-- PRIVILEGES` a dar escrita em cada tabela nova, por isso o REVOKE abaixo não
-- é zelo a mais.
--
-- ## `LegalAcceptance` — do clube corrente, ou do próprio
--
-- Uma aceitação de âmbito `USER` é da pessoa e vale em todos os clubes onde ela
-- esteja. Se a política fosse só `academyId = app.current_academy_id()`, um
-- encarregado com filhos em dois clubes aceitava a Política de Privacidade duas
-- vezes — e, pior, o serviço não tinha como saber que já a tinha aceite. Por
-- isso a política deixa ver também as linhas do próprio utilizador, através de
-- uma segunda variável de sessão, `app.user_id`, que o serviço põe dentro de
-- `runAs` da mesma forma que o `academy_id`: LOCAL, morre com a transação.
--
-- Sem `app.user_id` posto, só se vêem as do clube corrente. Sem `app.academy_id`
-- posto, nada. Falha fechado, como tudo o resto.
-- ---------------------------------------------------------------------------

-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('TERMS_OF_SERVICE', 'TERMS_OF_USE', 'PRIVACY_POLICY', 'COOKIE_POLICY', 'DPA', 'ACCEPTABLE_USE', 'ACADEMIAS_AI_TERMS', 'DATA_RETENTION_POLICY');

-- CreateEnum
CREATE TYPE "LegalDocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- CreateEnum
CREATE TYPE "LegalScope" AS ENUM ('CLUB', 'USER');

-- CreateEnum
CREATE TYPE "LegalAudience" AS ENUM ('CLUB_OWNER', 'STAFF', 'FAMILY', 'MEMBER');

-- CreateEnum
CREATE TYPE "LegalAcceptanceKind" AS ENUM ('ACCEPT', 'ACKNOWLEDGE', 'NONE');

-- CreateEnum
CREATE TYPE "LegalAcceptanceContext" AS ENUM ('SIGNUP', 'LOGIN_GATE', 'TERMS_UPDATE', 'SETTINGS');

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "type" "LegalDocumentType" NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "LegalDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" "LegalScope" NOT NULL,
    "audiences" "LegalAudience"[] DEFAULT ARRAY[]::"LegalAudience"[],
    "acceptanceKind" "LegalAcceptanceKind" NOT NULL DEFAULT 'ACCEPT',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "publishedById" TEXT,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "academyId" TEXT,
    "membershipId" TEXT,
    "documentId" TEXT NOT NULL,
    "documentType" "LegalDocumentType" NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "scope" "LegalScope" NOT NULL,
    "onBehalfOfClub" BOOLEAN NOT NULL DEFAULT false,
    "context" "LegalAcceptanceContext" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalAcceptance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegalDocument_type_status_effectiveAt_idx" ON "LegalDocument"("type", "status", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_type_version_key" ON "LegalDocument"("type", "version");

-- CreateIndex
CREATE INDEX "LegalAcceptance_userId_documentType_idx" ON "LegalAcceptance"("userId", "documentType");

-- CreateIndex
CREATE INDEX "LegalAcceptance_academyId_documentType_idx" ON "LegalAcceptance"("academyId", "documentType");

-- CreateIndex
CREATE INDEX "LegalAcceptance_documentId_idx" ON "LegalAcceptance"("documentId");

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalAcceptance" ADD CONSTRAINT "LegalAcceptance_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- O utilizador do pedido — a segunda variável de sessão.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '');
$$;

GRANT EXECUTE ON FUNCTION app.current_user_id() TO academia_app;

-- ---------------------------------------------------------------------------
-- Documentos: publicados para todos, escrita só da plataforma.
-- ---------------------------------------------------------------------------

ALTER TABLE "LegalDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalDocument" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS published_only ON "LegalDocument";
CREATE POLICY published_only ON "LegalDocument"
  FOR SELECT
  USING (status = 'PUBLISHED');

REVOKE INSERT, UPDATE, DELETE ON "LegalDocument" FROM academia_app;
GRANT SELECT ON "LegalDocument" TO academia_app;

-- ---------------------------------------------------------------------------
-- Aceitações: do clube corrente, ou do próprio. Nunca se editam nem apagam.
-- ---------------------------------------------------------------------------

ALTER TABLE "LegalAcceptance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalAcceptance" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS own_or_academy ON "LegalAcceptance";
CREATE POLICY own_or_academy ON "LegalAcceptance"
  USING (
    ("academyId" IS NOT NULL AND "academyId" = app.current_academy_id())
    OR ("userId" = app.current_user_id())
  )
  WITH CHECK (
    ("academyId" IS NOT NULL AND "academyId" = app.current_academy_id())
    AND ("userId" = app.current_user_id())
  );

-- Append-only ao nível do papel: nem o serviço consegue apagar uma prova.
REVOKE UPDATE, DELETE ON "LegalAcceptance" FROM academia_app;
GRANT SELECT, INSERT ON "LegalAcceptance" TO academia_app;

-- ---------------------------------------------------------------------------
-- `legal:club` — aceitar os termos em nome do clube.
--
-- Permissão nova, e a regra dos cargos guardados (ver `permissoes-distribuidas.json`
-- e `check-permissions.mjs`) é que uma permissão nova tem de chegar a quem já
-- tem cargo, senão só a academia de demonstração a vê. Vai para os cargos e
-- departamentos que já administram a academia (`settings:write`) — presidência
-- e direção por omissão. Um treinador não a recebe: não representa o clube.
-- ---------------------------------------------------------------------------

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['legal:club']) AS p),
       "updatedAt" = now()
 WHERE permissions @> ARRAY['settings:write']
   AND NOT permissions @> ARRAY['legal:club'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['legal:club']) AS p),
       "updatedAt" = now()
 WHERE permissions @> ARRAY['settings:write']
   AND NOT permissions @> ARRAY['legal:club'];
