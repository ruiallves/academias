-- O webhook volta a encontrar um pagamento pelo **nosso** id.
--
-- ## O que se partiu, e quando
--
-- `20260902130000_pagamentos_eupago` ensinou `app.resolve_payment_academy` a
-- aceitar `p.id = p_ref` além de `p."providerRef" = p_ref`. Na mesma tarde,
-- `20260902160000_app_do_clube` redefiniu a função para juntar as quotas de
-- sócio (`MemberFee`) — e reescreveu o WHERE **sem** o `OR p.id`. Ninguém
-- reparou porque as duas migrações nasceram com uma hora de diferença e a
-- segunda partiu de uma cópia antiga da primeira.
--
-- ## Porque é que isto importa mais do que parece
--
-- O que enviamos à euPago como `identifier` ao criar um pagamento é o **id do
-- Payment**. É isso que ela devolve no webhook. O `providerRef` que guardamos
-- é o `transactionID` dela (num MB Way, 32 caracteres hexadecimais), e o `trid`
-- do webhook é outro número ainda. Sem o `OR p.id`, um webhook de MB Way não
-- bate em nada: `encontrarPagamento` devolve nulo, o servidor responde 200
-- "pagamento desconhecido", e a mensalidade fica por pagar **mesmo com a
-- euPago configurada e a assinar bem**.
--
-- Foi apanhado pelo teste da reconciliação ("expirar não é negar"): um webhook
-- assinado e válido para um pagamento nosso entrava e não liquidava nada.

CREATE OR REPLACE FUNCTION app.resolve_payment_academy(p_provider text, p_ref text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c."academyId", f."academyId")
  FROM "Payment" p
  LEFT JOIN "Charge" c ON c.id = p."chargeId"
  LEFT JOIN "MemberFee" f ON f.id = p."memberFeeId"
  WHERE p.provider = p_provider AND (p."providerRef" = p_ref OR p.id = p_ref)
  LIMIT 1;
$$;
