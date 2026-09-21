-- Que clubes recebem o aviso de pagamento da subscrição.
--
-- A `Subscription` é uma tabela da plataforma, e a migração `20260816000600`
-- retirou **todo** o acesso às tabelas da plataforma ao papel da aplicação. É
-- deliberado: é isso que faz a separação valer alguma coisa. A varredura dos
-- avisos precisa de saber se a subscrição está cancelada, e a resposta vem por
-- aqui — uma função `SECURITY DEFINER`, como `app.academies_for_billing()`, e
-- não pela ligação com BYPASSRLS do painel, que não sai do módulo `platform`.
--
-- Um clube **sem** linha de subscrição entra na lista: é o clube que assinou as
-- condições antes de alguém lhe carimbar o plano na plataforma, e o contrato
-- assinado é o que obriga a pagar.

CREATE OR REPLACE FUNCTION app.academies_for_subscription_notices()
RETURNS TABLE (academy_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.id
  FROM "Academy" a
  LEFT JOIN "Subscription" s ON s."academyId" = a.id
  WHERE a.status <> 'CANCELLED'
    AND (s.id IS NULL OR s.status <> 'CANCELLED')
  ORDER BY a."createdAt";
$$;

REVOKE ALL ON FUNCTION app.academies_for_subscription_notices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.academies_for_subscription_notices() TO academia_app;
