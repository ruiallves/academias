-- A mensalidade da plataforma paga-se na consola, pela euPago da plataforma
--
-- ## O que muda
--
-- Até aqui a cobrança da plataforma era um aviso por email no fim de cada mês
-- e um botão "Recebido" no painel, depois de a transferência chegar. Passa a:
--
--  1. nascer no **início** do período, com referência Multibanco e MB WAY na
--     consola do clube (`SubscriptionPayment`);
--  2. lembrar o responsável uma vez por semana enquanto estiver por pagar
--     (`remindersSent`, `lastReminderAt`);
--  3. **suspender** o clube quando o período acaba sem pagamento
--     (`Academy.suspendedAt`, com `status = 'PAST_DUE'`): a consola e a app
--     fecham até se pagar, e reabrem sozinhas quando o webhook chega.
--
-- Entram todos os clubes com a subscrição `ACTIVE` — com ou sem condições
-- emitidas. Sem ordem, o dia de cobrança é `Subscription.billingAnchorOn`.

ALTER TABLE "Academy" ADD COLUMN "suspendedAt" TIMESTAMP(3);

ALTER TABLE "Subscription" ADD COLUMN "billingAnchorOn" DATE;

ALTER TABLE "SubscriptionNotice"
  ADD COLUMN "paidMethod" TEXT,
  ADD COLUMN "remindersSent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "suspensionSentAt" TIMESTAMP(3);

-- O que já foi dado como recebido à mão fica marcado como tal.
UPDATE "SubscriptionNotice" SET "paidMethod" = 'MANUAL' WHERE "paidAt" IS NOT NULL AND "paidMethod" IS NULL;

-- O dia de cobrança dos clubes que já pagam: o das condições quando as há
-- (assinadas ou por assinar — é o que o painel já usava para contar os
-- períodos), senão o dia em que a subscrição passou a activa.
UPDATE "Subscription" s
SET "billingAnchorOn" = COALESCE(
  (SELECT COALESCE(o."billingAnchorAt", o."signedAt", o."startsOn")::date
     FROM "SubscriptionOrder" o
    WHERE o."academyId" = s."academyId" AND o.status IN ('SIGNED', 'PENDING')
    ORDER BY (o.status = 'SIGNED') DESC, o."createdAt" DESC
    LIMIT 1),
  s."updatedAt"::date
)
WHERE s.status = 'ACTIVE' AND s."billingAnchorOn" IS NULL;

CREATE TYPE "SubscriptionPaymentMethod" AS ENUM ('MBWAY', 'MULTIBANCO');
CREATE TYPE "SubscriptionPaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED');

CREATE TABLE "SubscriptionPayment" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "noticeId"    TEXT NOT NULL,
  "method"      "SubscriptionPaymentMethod" NOT NULL,
  "status"      "SubscriptionPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "identifier"  TEXT NOT NULL,
  "providerRef" TEXT,
  "entity"      TEXT,
  "reference"   TEXT,
  "phone"       TEXT,
  "amountCents" INTEGER NOT NULL,
  "expiresAt"   TIMESTAMP(3),
  "paidAt"      TIMESTAMP(3),
  "failureNote" TEXT,
  "payload"     JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubscriptionPayment_identifier_key" ON "SubscriptionPayment"("identifier");
CREATE INDEX "SubscriptionPayment_academyId_noticeId_idx" ON "SubscriptionPayment"("academyId", "noticeId");
CREATE INDEX "SubscriptionPayment_providerRef_idx" ON "SubscriptionPayment"("providerRef");

ALTER TABLE "SubscriptionPayment"
  ADD CONSTRAINT "SubscriptionPayment_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "SubscriptionPayment_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "SubscriptionNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Do clube, como o aviso: a consola lê e cria os seus, e mais nenhuns.
ALTER TABLE "SubscriptionPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionPayment" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "SubscriptionPayment";
CREATE POLICY tenant_isolation ON "SubscriptionPayment"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE ON "SubscriptionPayment" TO academia_app;
REVOKE DELETE, TRUNCATE ON "SubscriptionPayment" FROM academia_app;

-- O que a varredura precisa de saber de cada clube que paga, sem abrir a
-- `Subscription` ao papel da aplicação (ver a migração 20260816000600): o
-- dia de cobrança, o valor e se já está suspenso. Substitui
-- `app.academies_for_subscription_notices()`, que não distinguia quem paga
-- de quem experimenta.
CREATE OR REPLACE FUNCTION app.subscription_billing()
RETURNS TABLE (
  academy_id      text,
  academy_status  "AcademyStatus",
  trial_ends_at   timestamp(3),
  suspended_at    timestamp(3),
  plan_name       text,
  amount_cents    int,
  anchor_on       date
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id, a.status, a."trialEndsAt", a."suspendedAt",
         p.name, COALESCE(s."priceCents", p."amountCents"), s."billingAnchorOn"
  FROM "Subscription" s
  JOIN "Academy" a ON a.id = s."academyId"
  JOIN "Plan" p ON p.id = s."planId"
  WHERE s.status = 'ACTIVE' AND a.status <> 'CANCELLED'
  ORDER BY a."createdAt";
$$;

REVOKE ALL ON FUNCTION app.subscription_billing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.subscription_billing() TO academia_app;

-- Quem está suspenso, para o guard recusar sem uma consulta por pedido: a
-- lista é pequena, muda raramente, e a API guarda-a em memória por um minuto.
CREATE OR REPLACE FUNCTION app.suspended_academies()
RETURNS TABLE (academy_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM "Academy" WHERE "suspendedAt" IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION app.suspended_academies() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.suspended_academies() TO academia_app;

-- De que clube é este pagamento à plataforma. O webhook da euPago chega sem
-- clube nenhum (é a conta da plataforma), e sem isto não havia como abrir o
-- `runAs` certo: a tabela está fechada por clube. Irmã de
-- `app.resolve_payment_academy`, para os pagamentos aos clubes.
CREATE OR REPLACE FUNCTION app.resolve_subscription_payment(p_ref text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT "academyId" FROM "SubscriptionPayment"
  WHERE "identifier" = p_ref OR "providerRef" = p_ref OR "reference" = p_ref
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION app.resolve_subscription_payment(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.resolve_subscription_payment(text) TO academia_app;
