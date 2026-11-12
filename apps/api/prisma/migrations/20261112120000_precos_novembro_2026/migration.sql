-- Os preços de tabela de 12/11/2026, com o lançamento do Assistente IA:
-- Consola 14,99 → 19,99 €, Connect 24,99 → 29,99 €, Connect Pro 29,99 → 34,99 €
-- (IVA incluído). Só para quem entrar a partir de hoje.
--
-- A cobrança lê `COALESCE(Subscription.priceCents, Plan.amountCents)`, como na
-- migração 20261013170000_connect_a_2499. Quem segue a tabela fica com o preço
-- de antes como preço acordado; quem já tem preço acordado não se toca.
-- Ninguém que já cá está paga mais. (A 12/11/2026 todas as subscrições em
-- produção já tinham `priceCents`; os três UPDATE de Subscription são a rede.)
--
-- O Assistente IA (14,99 €/mês, 4.000 créditos) não é um Plan: é um extra que
-- se liga por clube (`Academy.adjuntoEnabled`) e se cobra à parte. A conta dos
-- créditos e a cobrança do extra ficam para a migração seguinte.

UPDATE "Subscription"
   SET "priceCents" = 1499, "updatedAt" = now()
 WHERE "planId" = 'plan_clube'
   AND "priceCents" IS NULL;

UPDATE "Subscription"
   SET "priceCents" = 2499, "updatedAt" = now()
 WHERE "planId" = 'plan_academia'
   AND "priceCents" IS NULL;

UPDATE "Subscription"
   SET "priceCents" = 2999, "updatedAt" = now()
 WHERE "planId" = 'plan_connect_pro'
   AND "priceCents" IS NULL;

UPDATE "Plan" SET "amountCents" = 1999, "updatedAt" = now() WHERE id = 'plan_clube';
UPDATE "Plan" SET "amountCents" = 2999, "updatedAt" = now() WHERE id = 'plan_academia';
UPDATE "Plan" SET "amountCents" = 3499, "updatedAt" = now() WHERE id = 'plan_connect_pro';
