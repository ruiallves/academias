-- Quem pagou, e um identificador que se lê no backoffice da euPago.
--
-- ## O problema
--
-- O clube via "pago" na consola e um movimento na euPago, e não tinha como
-- saber de quem era. O que seguia para a euPago como `identifier` era o id do
-- Payment (`cmf3x…`), e do nosso lado não se guardava que pessoa carregou em
-- "pagar".
--
-- ## O que muda
--
-- - `identificador`: o que passa a seguir para a euPago, no formato
--   TIPO-MES-ATLETAS-PAGADOR-ID (ver `billing/identificador.ts`). Único, porque
--   é por ele que o webhook e a reconciliação voltam a encontrar o pagamento.
--   Nulo nos pagamentos antigos e nos marcados à mão.
-- - `payerName` / `payerRelation`: quem pagou e o que é do atleta ("Mãe"),
--   fotografados no momento do pagamento. Uma fotografia e não uma chave: o
--   recibo não pode mudar porque alguém mudou de nome ou saiu do clube.
--
-- O resolvedor do webhook passa a aceitar o identificador além do id e do
-- `providerRef`. Os pagamentos já criados continuam a ser encontrados pelo id,
-- que é o que foi para a euPago quando nasceram.

ALTER TABLE "Payment" ADD COLUMN "identificador" TEXT;
ALTER TABLE "Payment" ADD COLUMN "payerName" TEXT;
ALTER TABLE "Payment" ADD COLUMN "payerRelation" TEXT;

CREATE UNIQUE INDEX "Payment_identificador_key" ON "Payment"("identificador");

CREATE OR REPLACE FUNCTION app.resolve_payment_academy(p_provider text, p_ref text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c."academyId", f."academyId")
  FROM "Payment" p
  LEFT JOIN "Charge" c ON c.id = p."chargeId"
  LEFT JOIN "MemberFee" f ON f.id = p."memberFeeId"
  WHERE p.provider = p_provider
    AND (p."providerRef" = p_ref OR p.id = p_ref OR p.identificador = p_ref)
  LIMIT 1;
$$;
