-- Pagar pela app só com o canal euPago do clube configurado.
--
-- Sem canal próprio, um pagamento feito na app seguia pela chave geral e o
-- dinheiro caía na conta da plataforma, e não na do clube. Desligam-se os
-- pagamentos pela app em todos os clubes que ainda não têm as duas chaves do
-- canal (a da API e a do webhook). O servidor passa a recusar ligá-los enquanto
-- não as tiverem: ver `eupagoConfigurado` e `setPaymentRules`.
--
-- O que já foi pedido não se perde: uma referência Multibanco criada antes
-- continua pagável, e se for paga liquida a mensalidade como sempre.
--
-- O Life Club fica de fora de propósito: é o clube de demonstração, e é contra
-- ele que correm os testes de pagamentos (simulados, sem chave nenhuma).
UPDATE "Academy"
   SET "paymentsEnabled" = false
 WHERE "slug" <> 'life-club'
   AND ("eupagoApiKey" IS NULL OR btrim("eupagoApiKey") = ''
     OR "eupagoWebhookSecret" IS NULL OR btrim("eupagoWebhookSecret") = '');

-- Um clube novo nasce sem canal, e por isso com os pagamentos desligados.
ALTER TABLE "Academy" ALTER COLUMN "paymentsEnabled" SET DEFAULT false;
