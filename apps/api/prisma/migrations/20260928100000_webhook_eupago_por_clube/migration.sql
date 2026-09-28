-- O webhook da euPago por clube.
--
-- Um clube com canal próprio na euPago configura lá o seu webhook, com uma
-- chave dele. Os avisos chegam a `/webhooks/eupago/<slug>` e verificam-se com
-- esta chave. Até aqui havia um segredo só para todos, e dá-lo a um clube era
-- dar-lhe a forma de confirmar pagamentos de qualquer outro.
--
-- Nula em todos os clubes que existem: continuam no webhook global, como sempre.
ALTER TABLE "Academy" ADD COLUMN "eupagoWebhookSecret" TEXT;
