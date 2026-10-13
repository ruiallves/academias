-- O pagamento de uma entrega de equipamento.
--
-- `priceCents` nulo: sem pagamento. Com valor e sem `chargeId`: por pagar, mas
-- só no equipamento (a família vê-o no bloco Equipamento da app, e não nos
-- Pagamentos). Com `chargeId`: ligado a uma cobrança, cujo estado manda (por
-- pagar na app, ou pago, que cai nas Contas do clube).
--
-- Só colunas novas e opcionais: a API que está no ar não as lê.

ALTER TABLE "InventoryAssignment"
  ADD COLUMN "priceCents" INTEGER,
  ADD COLUMN "chargeId" TEXT;

CREATE UNIQUE INDEX "InventoryAssignment_chargeId_key" ON "InventoryAssignment"("chargeId");

ALTER TABLE "InventoryAssignment"
  ADD CONSTRAINT "InventoryAssignment_chargeId_fkey"
  FOREIGN KEY ("chargeId") REFERENCES "Charge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
