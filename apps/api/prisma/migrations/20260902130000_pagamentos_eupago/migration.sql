-- Pagamentos euPago a sério: todos os métodos, e o dinheiro do clube.
--
-- ## As três peças
--
-- 1. **Métodos novos.** Google Pay, Apple Pay e PaySafeCard são formulários
--    alojados da euPago (como o cartão); o débito directo é uma autorização
--    SEPA dada uma vez e debitada mês a mês.
--
-- 2. **`Academy.eupagoApiKey` — a arquitectura do "split".** O dinheiro das
--    mensalidades é do clube; a plataforma não fica com nada. Em vez de
--    repartir percentagens, cada clube tem o seu canal euPago com o seu IBAN
--    de liquidação, e os pagamentos dele criam-se com a chave desse canal —
--    100% para o clube por construção. Nulo = chave global do ambiente.
--
-- 3. **O webhook 2.0 devolve o `identifier` que lhe enviamos** (o id do nosso
--    Payment), por isso a resolução de academia passa a aceitar o id além da
--    referência do provedor.

ALTER TYPE "PaymentMethod" ADD VALUE 'GOOGLE_PAY' AFTER 'CARD';
ALTER TYPE "PaymentMethod" ADD VALUE 'APPLE_PAY' AFTER 'GOOGLE_PAY';
ALTER TYPE "PaymentMethod" ADD VALUE 'PAYSAFECARD' AFTER 'APPLE_PAY';
ALTER TYPE "PaymentMethod" ADD VALUE 'DIRECT_DEBIT' AFTER 'PAYSAFECARD';

ALTER TABLE "Payment" ADD COLUMN "redirectUrl" TEXT;
ALTER TABLE "Academy" ADD COLUMN "eupagoApiKey" TEXT;

CREATE TYPE "MandateStatus" AS ENUM ('PENDING', 'ACTIVE', 'CANCELLED');

-- A autorização de débito directo de um encarregado. O IBAN completo fica na
-- euPago; aqui só os últimos 4 dígitos e a referência que debita.
CREATE TABLE "DirectDebitMandate" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "debtorName" TEXT NOT NULL,
    "ibanTail" TEXT NOT NULL,
    "eupagoRef" TEXT NOT NULL,
    "status" "MandateStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DirectDebitMandate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DirectDebitMandate_membershipId_key" ON "DirectDebitMandate"("membershipId");
CREATE UNIQUE INDEX "DirectDebitMandate_eupagoRef_key" ON "DirectDebitMandate"("eupagoRef");
CREATE INDEX "DirectDebitMandate_academyId_idx" ON "DirectDebitMandate"("academyId");

ALTER TABLE "DirectDebitMandate"
  ADD CONSTRAINT "DirectDebitMandate_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectDebitMandate"
  ADD CONSTRAINT "DirectDebitMandate_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DirectDebitMandate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DirectDebitMandate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DirectDebitMandate";
CREATE POLICY tenant_isolation ON "DirectDebitMandate"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "DirectDebitMandate" TO academia_app;

-- O webhook chega sem tenant; o pagamento identifica-o. O 2.0 devolve o nosso
-- `identifier` (Payment.id) — a função passa a resolver por ele também.
CREATE OR REPLACE FUNCTION app.resolve_payment_academy(p_provider text, p_ref text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c."academyId"
  FROM "Payment" p
  JOIN "Charge" c ON c.id = p."chargeId"
  WHERE p.provider = p_provider AND (p."providerRef" = p_ref OR p.id = p_ref)
  LIMIT 1;
$$;
