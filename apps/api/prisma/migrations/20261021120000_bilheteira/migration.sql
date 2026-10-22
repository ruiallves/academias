-- A bilheteira do site do clube (fase 2 do roadmap, 21/10/2026).
--
-- Tudo aditivo: aplica-se com a API antiga em serviço sem mudar nada do que
-- ela faz. Ver `src/bilheteira/` e `docs/08-site-do-clube.md`.
--
--   - `SiteMatchTickets` ganha as fases da venda (sócios a partir de, público
--     a partir de, só sócios, fecho) e `SiteConfig.ticketDefaults` os preços
--     por omissão (bancada x público ou categoria de sócio).
--   - `TicketOrder` (a compra, com os lugares guardados 10 minutos) e
--     `MatchTicket` (um por pessoa). O pagamento é um `Payment` como os outros,
--     com `ticketOrderId`, e entra pelo mesmo webhook da euPago do clube.
--   - `SeasonSeat`: o lugar anual do sócio numa época, que desconta da
--     lotação vendável da bancada.
--   - `TicketGateAccess`: o link + PIN de um segurança, por jogo e por porta.
--   - `TicketScan`: cada leitura à porta.

-- CreateEnum
CREATE TYPE "TicketOrderStatus" AS ENUM ('RESERVED', 'PAID', 'EXPIRED', 'LATE_PAYMENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TicketChannel" AS ENUM ('SITE', 'APP');

-- CreateEnum
CREATE TYPE "MatchTicketStatus" AS ENUM ('VALID', 'USED', 'VOID');

-- CreateEnum
CREATE TYPE "TicketScanResult" AS ENUM ('OK', 'ALREADY_USED', 'WRONG_GATE', 'WRONG_MATCH', 'VOID', 'INVALID', 'QUOTA_EM_ATRASO');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "ticketOrderId" TEXT;

-- AlterTable
ALTER TABLE "SiteConfig" ADD COLUMN     "ticketDefaults" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "SiteMatchTickets" ADD COLUMN     "closesAt" TIMESTAMP(3),
ADD COLUMN     "membersFrom" TIMESTAMP(3),
ADD COLUMN     "membersOnly" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicFrom" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TicketOrder" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "status" "TicketOrderStatus" NOT NULL DEFAULT 'RESERVED',
    "channel" "TicketChannel" NOT NULL DEFAULT 'SITE',
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "memberId" TEXT,
    "totalCents" INTEGER NOT NULL,
    "reservedUntil" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundDueCents" INTEGER,
    "refundedAt" TIMESTAMP(3),
    "refundNote" TEXT,
    "accessToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchTicket" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "typeName" TEXT NOT NULL,
    "bancadaId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "memberId" TEXT,
    "status" "MatchTicketStatus" NOT NULL DEFAULT 'VALID',
    "usedAt" TIMESTAMP(3),
    "usedGateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonSeat" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "bancadaId" TEXT NOT NULL,
    "seat" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonSeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketGateAccess" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketGateAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketScan" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "gateId" TEXT NOT NULL,
    "accessId" TEXT,
    "ticketId" TEXT,
    "seasonSeatId" TEXT,
    "result" "TicketScanResult" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketOrder_accessToken_key" ON "TicketOrder"("accessToken");

-- CreateIndex
CREATE INDEX "TicketOrder_academyId_matchId_status_idx" ON "TicketOrder"("academyId", "matchId", "status");

-- CreateIndex
CREATE INDEX "TicketOrder_matchId_status_reservedUntil_idx" ON "TicketOrder"("matchId", "status", "reservedUntil");

-- CreateIndex
CREATE INDEX "TicketOrder_memberId_idx" ON "TicketOrder"("memberId");

-- CreateIndex
CREATE INDEX "MatchTicket_matchId_bancadaId_status_idx" ON "MatchTicket"("matchId", "bancadaId", "status");

-- CreateIndex
CREATE INDEX "MatchTicket_orderId_idx" ON "MatchTicket"("orderId");

-- CreateIndex
CREATE INDEX "MatchTicket_matchId_memberId_idx" ON "MatchTicket"("matchId", "memberId");

-- CreateIndex
CREATE INDEX "SeasonSeat_academyId_seasonId_venueId_bancadaId_idx" ON "SeasonSeat"("academyId", "seasonId", "venueId", "bancadaId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonSeat_memberId_seasonId_venueId_key" ON "SeasonSeat"("memberId", "seasonId", "venueId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonSeat_seasonId_venueId_bancadaId_seat_key" ON "SeasonSeat"("seasonId", "venueId", "bancadaId", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "TicketGateAccess_tokenHash_key" ON "TicketGateAccess"("tokenHash");

-- CreateIndex
CREATE INDEX "TicketGateAccess_academyId_matchId_idx" ON "TicketGateAccess"("academyId", "matchId");

-- CreateIndex
CREATE INDEX "TicketScan_matchId_createdAt_idx" ON "TicketScan"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketScan_matchId_gateId_result_idx" ON "TicketScan"("matchId", "gateId", "result");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ticketOrderId_fkey" FOREIGN KEY ("ticketOrderId") REFERENCES "TicketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "SiteMatchTickets"("matchId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOrder" ADD CONSTRAINT "TicketOrder_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTicket" ADD CONSTRAINT "MatchTicket_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchTicket" ADD CONSTRAINT "MatchTicket_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TicketOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonSeat" ADD CONSTRAINT "SeasonSeat_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonSeat" ADD CONSTRAINT "SeasonSeat_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonSeat" ADD CONSTRAINT "SeasonSeat_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketGateAccess" ADD CONSTRAINT "TicketGateAccess_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_accessId_fkey" FOREIGN KEY ("accessId") REFERENCES "TicketGateAccess"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "MatchTicket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketScan" ADD CONSTRAINT "TicketScan_seasonSeatId_fkey" FOREIGN KEY ("seasonSeatId") REFERENCES "SeasonSeat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: cada clube só vê o que é seu, como em todas as tabelas do clube.
-- ---------------------------------------------------------------------------

ALTER TABLE "TicketOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TicketOrder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TicketOrder";
CREATE POLICY tenant_isolation ON "TicketOrder"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "MatchTicket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchTicket" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MatchTicket";
CREATE POLICY tenant_isolation ON "MatchTicket"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SeasonSeat" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SeasonSeat" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SeasonSeat";
CREATE POLICY tenant_isolation ON "SeasonSeat"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "TicketGateAccess" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TicketGateAccess" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TicketGateAccess";
CREATE POLICY tenant_isolation ON "TicketGateAccess"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "TicketScan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TicketScan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TicketScan";
CREATE POLICY tenant_isolation ON "TicketScan"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE
   ON "TicketOrder", "MatchTicket", "SeasonSeat", "TicketGateAccess", "TicketScan"
   TO academia_app;

-- ---------------------------------------------------------------------------
-- O webhook da euPago encontra o clube de um pagamento de bilhetes.
--
-- Igual à de `20260919120000_identificador_do_pagamento`, mais a compra de
-- bilhetes: um `Payment` com `ticketOrderId` é do clube dessa compra.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.resolve_payment_academy(p_provider text, p_ref text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c."academyId", f."academyId", o."academyId")
  FROM "Payment" p
  LEFT JOIN "Charge" c ON c.id = p."chargeId"
  LEFT JOIN "MemberFee" f ON f.id = p."memberFeeId"
  LEFT JOIN "TicketOrder" o ON o.id = p."ticketOrderId"
  WHERE p.provider = p_provider
    AND (p."providerRef" = p_ref OR p.id = p_ref OR p.identificador = p_ref)
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Um lugar anual entra uma vez por jogo, mesmo com dois seguranças a ler o
-- mesmo cartão ao mesmo tempo: a segunda entrada aceite bate neste índice.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX "TicketScan_uma_entrada_anual"
  ON "TicketScan" ("matchId", "seasonSeatId")
  WHERE "result" = 'OK' AND "seasonSeatId" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- O `Payment` passa a ter um terceiro dono: a compra de bilhetes.
--
-- Até aqui um pagamento era de uma mensalidade (`chargeId`) ou de uma quota
-- (`memberFeeId`), exatamente um. Sem mudar a regra, todo o pagamento de
-- bilhetes era recusado pela base; sem mudar a política, ficava invisível ao
-- próprio clube. As duas passam a contar com `ticketOrderId`.
-- ---------------------------------------------------------------------------

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_exactly_one_owner";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_exactly_one_owner"
  CHECK (
    (("chargeId" IS NOT NULL)::int + ("memberFeeId" IS NOT NULL)::int + ("ticketOrderId" IS NOT NULL)::int) = 1
  );

DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment"
  USING (
    EXISTS (
      SELECT 1 FROM "Charge" c
      WHERE c.id = "Payment"."chargeId" AND c."academyId" = app.current_academy_id()
    )
    OR EXISTS (
      SELECT 1 FROM "MemberFee" f
      WHERE f.id = "Payment"."memberFeeId" AND f."academyId" = app.current_academy_id()
    )
    OR EXISTS (
      SELECT 1 FROM "TicketOrder" o
      WHERE o.id = "Payment"."ticketOrderId" AND o."academyId" = app.current_academy_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Charge" c
      WHERE c.id = "Payment"."chargeId" AND c."academyId" = app.current_academy_id()
    )
    OR EXISTS (
      SELECT 1 FROM "MemberFee" f
      WHERE f.id = "Payment"."memberFeeId" AND f."academyId" = app.current_academy_id()
    )
    OR EXISTS (
      SELECT 1 FROM "TicketOrder" o
      WHERE o.id = "Payment"."ticketOrderId" AND o."academyId" = app.current_academy_id()
    )
  );

-- ---------------------------------------------------------------------------
-- A reconciliação (o passe que recupera pagamentos cujo webhook se perdeu)
-- passa a ver os pagamentos de quotas e de bilhetes. Só via mensalidades
-- (`JOIN "Charge"`): um bilhete pago com o aviso perdido ficava por emitir.
-- Mesma forma de retorno: `CREATE OR REPLACE` sem mudar a assinatura.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.payments_in_flight()
RETURNS TABLE (academy_id text, payment_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c."academyId", f."academyId", o."academyId") AS academy_id, p.id AS payment_id
  FROM "Payment" p
  LEFT JOIN "Charge" c ON c.id = p."chargeId"
  LEFT JOIN "MemberFee" f ON f.id = p."memberFeeId"
  LEFT JOIN "TicketOrder" o ON o.id = p."ticketOrderId"
  WHERE p.provider = 'eupago'
    AND p.status IN ('PENDING', 'PROCESSING')
    AND COALESCE(c."academyId", f."academyId", o."academyId") IS NOT NULL
  ORDER BY p."createdAt";
$$;
