-- O Connect passa de 19,99 € para 24,99 €, só para quem entrar a partir de hoje.
--
-- A cobrança lê `COALESCE(Subscription.priceCents, Plan.amountCents)` (ver
-- `app.subscription_billing`). Quem já está no Connect a seguir a tabela fica
-- com os 19,99 € como preço acordado antes de a tabela subir; quem já tem um
-- preço acordado (mais baixo) não se toca. Ninguém que já cá está paga mais.

UPDATE "Subscription"
   SET "priceCents" = 1999, "updatedAt" = now()
 WHERE "planId" = 'plan_academia'
   AND "priceCents" IS NULL;

UPDATE "Plan"
   SET "amountCents" = 2499, "updatedAt" = now()
 WHERE id = 'plan_academia';
