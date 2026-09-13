-- ---------------------------------------------------------------------------
-- A ordem de adesão: as condições comerciais de um clube, assinadas
-- ---------------------------------------------------------------------------
--
-- Mudar o plano de um clube passava-se inteiro dentro da plataforma: escolhia-se
-- na lista, gravava-se, e do outro lado ninguém era informado de nada. O que
-- faltava não era um aviso — era o **contrato**: qual o plano, quanto custa, a
-- partir de quando, por quanto tempo, e como renova. E faltava alguém do clube
-- a dizer que sim.
--
-- ## Porque é que isto não é um documento legal
--
-- Os `LegalDocument` são versões iguais para toda a gente. Isto é do clube: o
-- preço, a data e o período mínimo são de uma negociação. Uma versão por clube
-- deixava o catálogo legal ilegível. A ligação entre os dois fica em
-- `termsDocumentId` — a ordem agarra-se à versão dos Termos que estava em vigor.
--
-- ## Porque é que os valores ficam copiados
--
-- O `Plan` muda de nome e de preço. Uma ordem assinada que os fosse ler ao plano
-- dizia outra coisa no dia seguinte — e o que interessa é o que foi assinado.

CREATE TYPE "SubscriptionBillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');
CREATE TYPE "SubscriptionOrderStatus" AS ENUM ('PENDING', 'SIGNED', 'SUPERSEDED');

CREATE TABLE "SubscriptionOrder" (
  "id"               TEXT PRIMARY KEY,
  "academyId"        TEXT NOT NULL REFERENCES "Academy"("id") ON DELETE CASCADE,
  "planId"           TEXT NOT NULL REFERENCES "Plan"("id"),

  "planName"         TEXT NOT NULL,
  "billingPeriod"    "SubscriptionBillingPeriod" NOT NULL DEFAULT 'MONTHLY',
  "listMonthlyCents" INTEGER NOT NULL,
  "discountPct"      INTEGER NOT NULL DEFAULT 0,
  "amountCents"      INTEGER NOT NULL,

  "startsOn"         DATE NOT NULL,
  "minimumMonths"    INTEGER NOT NULL DEFAULT 12,
  "renewalNote"      TEXT,
  "notes"            TEXT,

  "termsDocumentId"  TEXT REFERENCES "LegalDocument"("id") ON DELETE SET NULL,
  "termsVersion"     TEXT,

  "status"           "SubscriptionOrderStatus" NOT NULL DEFAULT 'PENDING',

  "sentToEmail"      TEXT,
  "sentToName"       TEXT,
  "sentAt"           TIMESTAMPTZ,

  "signedAt"         TIMESTAMPTZ,
  "signedByUserId"   TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "signerName"       TEXT,
  "signerEmail"      TEXT,
  "signerTitle"      TEXT,
  "signerIp"         TEXT,
  "signerAgent"      TEXT,

  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL
);

CREATE INDEX "SubscriptionOrder_academyId_status_idx" ON "SubscriptionOrder"("academyId", "status");
CREATE INDEX "SubscriptionOrder_academyId_createdAt_idx" ON "SubscriptionOrder"("academyId", "createdAt");

-- ---------------------------------------------------------------------------
-- Isolamento por clube
-- ---------------------------------------------------------------------------
--
-- A consola lê a ordem do próprio clube para a mostrar e assinar; a plataforma
-- escreve-a com a ligação de serviço, que não passa por aqui. A política é a
-- mesma do resto: só se vê o que é da academia do contexto.

ALTER TABLE "SubscriptionOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionOrder" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "SubscriptionOrder";
CREATE POLICY tenant_isolation ON "SubscriptionOrder"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE ON "SubscriptionOrder" TO academia_app;
