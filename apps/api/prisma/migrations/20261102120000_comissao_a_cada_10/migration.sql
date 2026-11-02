-- A comissão do comercial passa a ser a cada 10 reuniões marcadas (era 5).
ALTER TABLE "SalesCompensation" ALTER COLUMN "meetingsPerCommission" SET DEFAULT 10;
