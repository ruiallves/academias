-- A faturação por API (25/10/2026).
--
-- Cada pagamento a um clube (mensalidade, extra, quota, bilhete, encomenda)
-- passa a gerar uma fatura no programa certificado do clube — InvoiceXpress,
-- Moloni ou Sage One — e o PDF segue por email a quem pagou. A ligação ao
-- programa vive em `InvoicingAccount` (uma por clube, credenciais cifradas);
-- a fatura de cada pagamento em `Invoice`, que nasce na transação que dá o
-- pagamento por pago e é emitida depois, por uma fila.
--
-- Toda aditiva: nenhum clube tem ligação, por isso nada muda até alguém ligar
-- a dele nas Definições. A API nova lê estas tabelas: aplicar ANTES do deploy.

CREATE TYPE "InvoicingProvider" AS ENUM ('INVOICEXPRESS', 'MOLONI', 'SAGE_ONE', 'PHC_GO', 'VENDUS');
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'ISSUED', 'SENT', 'FAILED', 'CANCELLED');

-- Os dados de faturação de quem paga na app, por clube.
ALTER TABLE "Membership" ADD COLUMN "invoiceDetails" JSONB;

-- O NIF de quem compra no site, se o quiser dar.
ALTER TABLE "TicketOrder" ADD COLUMN "buyerTaxId" TEXT;
ALTER TABLE "SiteOrder" ADD COLUMN "buyerTaxId" TEXT;

CREATE TABLE "InvoicingAccount" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "provider"    "InvoicingProvider" NOT NULL,
  "credentials" TEXT NOT NULL,
  "settings"    JSONB NOT NULL DEFAULT '{}',
  "taxRules"    JSONB NOT NULL DEFAULT '{}',
  "readyAt"     TIMESTAMP(3),
  "lastError"   TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvoicingAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InvoicingAccount_academyId_key" ON "InvoicingAccount"("academyId");
ALTER TABLE "InvoicingAccount"
  ADD CONSTRAINT "InvoicingAccount_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Invoice" (
  "id"                TEXT NOT NULL,
  "academyId"         TEXT NOT NULL,
  "paymentId"         TEXT NOT NULL,
  "provider"          "InvoicingProvider" NOT NULL,
  "status"            "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "externalId"        TEXT,
  "number"            TEXT,
  "atcud"             TEXT,
  "permalink"         TEXT,
  "receiptExternalId" TEXT,
  "document"          JSONB NOT NULL,
  "sentTo"            TEXT,
  "sentAt"            TIMESTAMP(3),
  "attempts"          INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt"     TIMESTAMP(3),
  "lastError"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invoice_paymentId_key" ON "Invoice"("paymentId");
CREATE INDEX "Invoice_academyId_status_idx" ON "Invoice"("academyId", "status");
CREATE INDEX "Invoice_academyId_createdAt_idx" ON "Invoice"("academyId", "createdAt");
CREATE INDEX "Invoice_status_nextAttemptAt_idx" ON "Invoice"("status", "nextAttemptAt");
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Invoice"
  ADD CONSTRAINT "Invoice_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Isolamento por clube, como em todas as tabelas com `academyId`.
ALTER TABLE "InvoicingAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InvoicingAccount" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "InvoicingAccount";
CREATE POLICY tenant_isolation ON "InvoicingAccount"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Invoice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invoice";
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "InvoicingAccount", "Invoice" TO academia_app;

-- Que clubes têm faturação ligada: a fila das faturas e a renovação dos tokens
-- percorrem-nos um a um, cada um no seu contexto. Como
-- `app.academies_for_billing()`: uma função estreita, que só devolve ids.
CREATE OR REPLACE FUNCTION app.academies_with_invoicing()
RETURNS TABLE (academy_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT ia."academyId"
  FROM "InvoicingAccount" ia
  JOIN "Academy" a ON a.id = ia."academyId"
  WHERE a.status <> 'CANCELLED'
  ORDER BY ia."createdAt";
$$;

REVOKE ALL ON FUNCTION app.academies_with_invoicing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.academies_with_invoicing() TO academia_app;
