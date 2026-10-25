-- A faturação das vendas do site (25/10/2026).
--
-- Um clube só vende no site (bilheteira paga e loja) com o programa de
-- faturação configurado. Marca-se no painel da plataforma, na ficha do clube:
-- o programa e quando ficou confirmado. Nulo = não vende.
--
-- Aditiva: nenhum clube fica marcado, por isso nenhum vende até alguém o marcar
-- no painel. A API nova lê estas colunas: aplicar ANTES do deploy dela.

ALTER TABLE "Academy" ADD COLUMN "invoicingSystem" TEXT;
ALTER TABLE "Academy" ADD COLUMN "invoicingConfirmedAt" TIMESTAMP(3);
