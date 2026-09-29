-- Quem mudou à mão o estado de uma mensalidade, e quando.
--
-- Marcar como paga, voltar a por pagar ou anular é uma decisão de alguém da
-- direção, e a consola passa a dizê-lo na coluna do pagamento. Nulo nas que
-- nunca foram mexidas à mão e nas anteriores a isto. Sai a pessoa, fica a data:
-- ON DELETE SET NULL.
ALTER TABLE "Charge" ADD COLUMN "statusChangedById" TEXT;
ALTER TABLE "Charge" ADD COLUMN "statusChangedAt" TIMESTAMPTZ(3);

ALTER TABLE "Charge" ADD CONSTRAINT "Charge_statusChangedById_fkey"
  FOREIGN KEY ("statusChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Charge_statusChangedById_idx" ON "Charge"("statusChangedById");
