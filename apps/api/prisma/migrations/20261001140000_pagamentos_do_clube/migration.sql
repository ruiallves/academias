-- Duas decisões do clube sobre os pagamentos pela app, e o que cada pagamento
-- cobrou a mais por causa da segunda.
--
-- `paymentsEnabled`: a `false`, nem famílias nem sócios iniciam pagamentos pela
-- app. Nasce a `true` — é o que todos os clubes têm hoje.
--
-- `feesOnPayer`: a `true`, a comissão da euPago é posta por cima do valor e paga
-- por quem paga; os valores da plataforma passam a ser o que o clube recebe.
-- Nasce a `false` — é o que todos os clubes têm hoje.
--
-- `surchargeCents`: a comissão cobrada por cima, fotografada no pagamento. Zero
-- em tudo o que já existe.
--
-- Só acrescenta colunas com valor por omissão: nenhuma linha muda de sentido.
ALTER TABLE "Academy" ADD COLUMN "paymentsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Academy" ADD COLUMN "feesOnPayer" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Payment" ADD COLUMN "surchargeCents" INTEGER NOT NULL DEFAULT 0;
