-- A loja do site do clube passa a vender (fase 3 do site, 24/10/2026).
--
-- Até aqui a loja era um catálogo: os botões levavam aos contactos. Agora há
-- carrinho, encomenda e pagamento pela euPago do clube, como na bilheteira:
--
--   1. `SiteOrder` e `SiteOrderItem`: a encomenda (quem, como se entrega,
--      quanto, o estado) e as linhas (produto, tamanho, quantidade, preço de
--      então). Os artigos ficam guardados 10 minutos à espera do pagamento;
--      o stock desce quando a encomenda é paga.
--   2. `Payment.siteOrderId`: o pagamento de uma encomenda, pelo mesmo webhook
--      da euPago do clube. O `Payment` passa a ter quatro donos possíveis.
--   3. `SiteProduct.images` (a galeria) e `SiteProduct.stock` (o stock por
--      tamanho de um produto sem artigo do Inventário).
--   4. `SiteConfig.shop`: como o clube entrega (levantamento, envio e o preço
--      dele) e o aviso da loja.
--
-- Toda aditiva: a API em produção continua a funcionar com ela aplicada (salvo
-- a reconciliação, que passa a ver também as encomendas em voo). Aplicar
-- ANTES do deploy da API nova, que já pede `Payment.siteOrderId` ao arrancar.

-- CreateEnum
CREATE TYPE "SiteOrderStatus" AS ENUM ('RESERVED', 'PAID', 'READY', 'SHIPPED', 'DELIVERED', 'EXPIRED', 'LATE_PAYMENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SiteOrderDelivery" AS ENUM ('PICKUP', 'SHIPPING');

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "siteOrderId" TEXT;

-- AlterTable
ALTER TABLE "SiteConfig" ADD COLUMN     "shop" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "SiteProduct" ADD COLUMN     "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "stock" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "SiteOrder" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "SiteOrderStatus" NOT NULL DEFAULT 'RESERVED',
    "delivery" "SiteOrderDelivery" NOT NULL DEFAULT 'PICKUP',
    "buyerName" TEXT NOT NULL,
    "buyerEmail" TEXT NOT NULL,
    "buyerPhone" TEXT,
    "address" JSONB,
    "note" TEXT,
    "itemsCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "reservedUntil" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "trackingCode" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "refundDueCents" INTEGER,
    "refundedAt" TIMESTAMP(3),
    "refundNote" TEXT,
    "accessToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteOrderItem" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "variantId" TEXT,
    "productName" TEXT NOT NULL,
    "size" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteOrder_accessToken_key" ON "SiteOrder"("accessToken");

-- CreateIndex
CREATE INDEX "SiteOrder_academyId_status_createdAt_idx" ON "SiteOrder"("academyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "SiteOrder_status_reservedUntil_idx" ON "SiteOrder"("status", "reservedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "SiteOrder_academyId_number_key" ON "SiteOrder"("academyId", "number");

-- CreateIndex
CREATE INDEX "SiteOrderItem_orderId_idx" ON "SiteOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "SiteOrderItem_productId_size_idx" ON "SiteOrderItem"("productId", "size");

-- CreateIndex
CREATE INDEX "SiteOrderItem_academyId_idx" ON "SiteOrderItem"("academyId");

-- AddForeignKey
-- RESTRICT: uma encomenda com pagamento não se apaga por arrasto, como nos bilhetes
-- (`20261021180000_bilheteira_proteger`). O caminho é anular.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_siteOrderId_fkey" FOREIGN KEY ("siteOrderId") REFERENCES "SiteOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteOrder" ADD CONSTRAINT "SiteOrder_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteOrderItem" ADD CONSTRAINT "SiteOrderItem_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteOrderItem" ADD CONSTRAINT "SiteOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SiteOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
-- SET NULL: apagar um produto não apaga o que se vendeu dele; a linha fica com o nome e o preço de então.
ALTER TABLE "SiteOrderItem" ADD CONSTRAINT "SiteOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "SiteProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteOrderItem" ADD CONSTRAINT "SiteOrderItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "InventoryVariant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: cada clube só vê as suas encomendas, como em todas as tabelas do clube.
-- ---------------------------------------------------------------------------

ALTER TABLE "SiteOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteOrder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteOrder";
CREATE POLICY tenant_isolation ON "SiteOrder"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SiteOrderItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteOrderItem" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteOrderItem";
CREATE POLICY tenant_isolation ON "SiteOrderItem"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "SiteOrder", "SiteOrderItem" TO academia_app;

-- ---------------------------------------------------------------------------
-- O `Payment` passa a ter um quarto dono: a encomenda da loja.
--
-- A regra "exatamente um" e a política de isolamento passam a contar com
-- `siteOrderId`, como a bilheteira fez com `ticketOrderId`.
-- ---------------------------------------------------------------------------

ALTER TABLE "Payment" DROP CONSTRAINT IF EXISTS "Payment_exactly_one_owner";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_exactly_one_owner"
  CHECK (
    (("chargeId" IS NOT NULL)::int + ("memberFeeId" IS NOT NULL)::int + ("ticketOrderId" IS NOT NULL)::int + ("siteOrderId" IS NOT NULL)::int) = 1
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
    OR EXISTS (
      SELECT 1 FROM "SiteOrder" s
      WHERE s.id = "Payment"."siteOrderId" AND s."academyId" = app.current_academy_id()
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
    OR EXISTS (
      SELECT 1 FROM "SiteOrder" s
      WHERE s.id = "Payment"."siteOrderId" AND s."academyId" = app.current_academy_id()
    )
  );

-- O webhook da euPago encontra o clube de um pagamento de uma encomenda.
CREATE OR REPLACE FUNCTION app.resolve_payment_academy(p_provider text, p_ref text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c."academyId", f."academyId", o."academyId", s."academyId")
  FROM "Payment" p
  LEFT JOIN "Charge" c ON c.id = p."chargeId"
  LEFT JOIN "MemberFee" f ON f.id = p."memberFeeId"
  LEFT JOIN "TicketOrder" o ON o.id = p."ticketOrderId"
  LEFT JOIN "SiteOrder" s ON s.id = p."siteOrderId"
  WHERE p.provider = p_provider
    AND (p."providerRef" = p_ref OR p.id = p_ref OR p.identificador = p_ref)
  LIMIT 1;
$$;

-- A reconciliação passa a ver as encomendas em voo.
CREATE OR REPLACE FUNCTION app.payments_in_flight()
RETURNS TABLE (academy_id text, payment_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c."academyId", f."academyId", o."academyId", s."academyId") AS academy_id, p.id AS payment_id
  FROM "Payment" p
  LEFT JOIN "Charge" c ON c.id = p."chargeId"
  LEFT JOIN "MemberFee" f ON f.id = p."memberFeeId"
  LEFT JOIN "TicketOrder" o ON o.id = p."ticketOrderId"
  LEFT JOIN "SiteOrder" s ON s.id = p."siteOrderId"
  WHERE p.provider = 'eupago'
    AND p.status IN ('PENDING', 'PROCESSING')
    AND COALESCE(c."academyId", f."academyId", o."academyId", s."academyId") IS NOT NULL
  ORDER BY p."createdAt";
$$;
