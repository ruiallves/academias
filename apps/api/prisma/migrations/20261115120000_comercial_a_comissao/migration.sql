-- Comercial pago só à comissão: o modelo de pagamento de cada pessoa e a
-- carteira de clubes que trouxe.
--
-- Só acrescenta: um enum, colunas com valor por omissão e uma tabela nova. Quem
-- já tem condições fica à hora (HOURLY), como estava. A versão em produção
-- continua a funcionar até ao deploy da API nova.

CREATE TYPE "SalesPayModel" AS ENUM ('HOURLY', 'COMMISSION');

ALTER TABLE "SalesCompensation"
  ADD COLUMN "payModel"    "SalesPayModel" NOT NULL DEFAULT 'HOURLY',
  ADD COLUMN "clubPercent" INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN "clubMonths"  INTEGER;

ALTER TABLE "SalesPayout"
  ADD COLUMN "portfolioCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "SalesPortfolioClub" (
  "id"          TEXT NOT NULL,
  "adminId"     TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "percent"     INTEGER NOT NULL,
  "months"      INTEGER,
  "startsOn"    DATE NOT NULL,
  "endedOn"     DATE,
  "note"        TEXT,
  "createdById" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesPortfolioClub_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesPortfolioClub_academyId_key" ON "SalesPortfolioClub"("academyId");
CREATE INDEX "SalesPortfolioClub_adminId_idx" ON "SalesPortfolioClub"("adminId");
ALTER TABLE "SalesPortfolioClub" ADD CONSTRAINT "SalesPortfolioClub_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesPortfolioClub" ADD CONSTRAINT "SalesPortfolioClub_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tabela da plataforma: nenhum acesso a partir do código dos clubes.
REVOKE ALL ON "SalesPortfolioClub" FROM academia_app;
