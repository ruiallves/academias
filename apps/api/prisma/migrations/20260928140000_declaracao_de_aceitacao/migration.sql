-- A declaração de aceitação das condições de subscrição.
--
-- Assinar as condições era um clique: ficava registado quem, quando e de onde,
-- mas não **em nome de quem** nem com que identificação. Um contrato com um
-- clube tem de dizer que instituição se vincula (nome e NIF) e quem a
-- representa (nome, NIF e data de nascimento). Com isso gera-se uma declaração
-- em PDF, que fica anexada à ordem e se descarrega na consola e na plataforma.

-- 1. A identificação, na própria ordem --------------------------------------

ALTER TABLE "SubscriptionOrder"
  ADD COLUMN "institutionName"  TEXT,
  ADD COLUMN "institutionTaxId" TEXT,
  ADD COLUMN "signerTaxId"      TEXT,
  ADD COLUMN "signerBirthdate"  DATE,
  -- O dia de onde se contam os avisos de pagamento. Nulo = o dia da assinatura,
  -- que é a regra de sempre. Só se preenche quando uma ordem é reemitida para
  -- se voltar a assinar com as mesmas condições: reassinar por papelada não
  -- pode mudar o dia em que o clube paga.
  ADD COLUMN "billingAnchorAt"  TIMESTAMP(3);

-- 2. O PDF, à parte e só de escrita ------------------------------------------
--
-- Numa tabela sua para as leituras da ordem não arrastarem os bytes do PDF, e
-- para poder ser só de escrita: uma declaração assinada não se corrige, emite-se
-- outra. O `sha256` é a impressão digital do ficheiro tal como foi gerado.

CREATE TABLE "SubscriptionDeclaration" (
  "id"        TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "orderId"   TEXT NOT NULL,
  "pdf"       BYTEA NOT NULL,
  "sha256"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionDeclaration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionDeclaration_orderId_key" ON "SubscriptionDeclaration"("orderId");
CREATE INDEX "SubscriptionDeclaration_academyId_idx" ON "SubscriptionDeclaration"("academyId");

ALTER TABLE "SubscriptionDeclaration"
  ADD CONSTRAINT "SubscriptionDeclaration_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionDeclaration"
  ADD CONSTRAINT "SubscriptionDeclaration_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "SubscriptionOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SubscriptionDeclaration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionDeclaration" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SubscriptionDeclaration";
CREATE POLICY tenant_isolation ON "SubscriptionDeclaration"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- O Supabase dá arwd a academia_app em cada tabela nova de `public` (ver
-- `20260920163000_historico_so_escreve`). O GRANT restrito não chega: é
-- preciso retirar o resto à mão.
GRANT SELECT, INSERT ON "SubscriptionDeclaration" TO academia_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "SubscriptionDeclaration" FROM academia_app;
