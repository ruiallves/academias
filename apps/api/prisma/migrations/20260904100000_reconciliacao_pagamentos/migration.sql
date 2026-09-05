-- Reconciliação de pagamentos: a segunda fonte de verdade, depois do webhook.
--
-- ## O que aconteceu
--
-- Dois pais pagaram a mensalidade por MB Way num dia; na manhã seguinte a app
-- continuava a dizer-lhes que deviam. A euPago tinha o dinheiro; nós não
-- tínhamos o webhook. E nunca tivemos: em toda a base não há um único pagamento
-- confirmado pelo webhook — só os marcados à mão pela direcção.
--
-- O servidor está bem: um evento assinado com o nosso segredo é aceite em
-- produção (`200 ok`). O que não chega é o evento da euPago — ou porque o
-- backoffice não o envia para nós, ou porque o assina com outra chave e cai em
-- 401 antes de deixar rasto. Nenhuma das duas coisas se resolve com código: é
-- configuração do lado da euPago. Mas as duas tinham o mesmo efeito, e é esse
-- efeito que isto fecha.
--
-- ## A regra que fica
--
-- Continua a ser verdade que **o navegador nunca decide**. O que passa a haver
-- é uma segunda leitura, do lado do servidor: de tempos a tempos perguntamos à
-- euPago pelo estado de cada pagamento em voo, e liquidamos o que ela disser
-- que está pago — pelo mesmo `confirmPayment` do webhook, com a mesma
-- verificação de valor. O webhook passa a ser o caminho rápido; isto é a rede.
--
-- ## Porque é que é uma função SECURITY DEFINER
--
-- A varredura corre fora de qualquer pedido — não há academia no contexto — e
-- a RLS não deixa `academia_app` ler `Payment` sem `app.academy_id`. Uma
-- ligação sem RLS "só para isto" seria a porta que a migração de RLS existe
-- para não abrir. Em vez disso, a mesma escotilha estreita do webhook: uma
-- função que só sabe devolver **pares (academia, pagamento)** dos pagamentos
-- em voo — nem valores, nem referências, nem nada mais. Com o id da academia
-- na mão, o resto corre dentro de `runAs`, com a RLS de sempre.

CREATE OR REPLACE FUNCTION app.payments_in_flight()
RETURNS TABLE (academy_id text, payment_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c."academyId" AS academy_id, p.id AS payment_id
  FROM "Payment" p
  JOIN "Charge" c ON c.id = p."chargeId"
  WHERE p.provider = 'eupago'
    AND p.status IN ('PENDING', 'PROCESSING')
  ORDER BY p."createdAt";
$$;

REVOKE ALL ON FUNCTION app.payments_in_flight() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.payments_in_flight() TO academia_app;
