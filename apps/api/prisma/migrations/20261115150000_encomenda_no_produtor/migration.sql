-- Encomenda entregue ao produtor (15/11/2026).
--
-- Camisolas com nome e número, equipamentos por medida, cachecóis bordados:
-- o clube recebe a encomenda paga e manda-a ao fornecedor, e só dias depois
-- a tem na mão para pôr pronta ou enviar. Até aqui ficava em "paga, por
-- preparar" esse tempo todo, e a lista por preparar enchia-se de encomendas
-- em que o clube já tinha feito a sua parte. O estado novo fica entre a
-- paga e a pronta/enviada, com a data em que foi ao produtor.
--
-- Um `ALTER TYPE ... ADD VALUE` é aceite numa transação desde o Postgres 12
-- desde que o valor não se use na mesma transação; o Prisma corre cada
-- migração numa, e aqui o valor não se usa.
ALTER TYPE "SiteOrderStatus" ADD VALUE IF NOT EXISTS 'IN_PRODUCTION';

ALTER TABLE "SiteOrder" ADD COLUMN IF NOT EXISTS "productionAt" TIMESTAMP(3);
