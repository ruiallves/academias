-- Vencimentos das pessoas do clube (18/11/2026).
--
-- 1. `Salary`: o vencimento de alguém do staff ou de um atleta, por período
--    ("600 € por mês desde setembro"). Mudar o valor fecha a linha e abre outra.
-- 2. `FinancialTransaction.salaryId` / `salaryPeriod`: o movimento que pagou um
--    mês de um vencimento, e qual. É por aqui que a folha sabe o que falta.
--
-- Aditiva: a API antiga não lê nenhuma das duas. RLS por clube, como as outras
-- tabelas das Contas.

CREATE TABLE IF NOT EXISTS "Salary" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "membershipId" TEXT,
    "athleteId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "payDay" INTEGER,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Salary_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Salary_academyId_membershipId_idx" ON "Salary"("academyId", "membershipId");
CREATE INDEX IF NOT EXISTS "Salary_academyId_athleteId_idx" ON "Salary"("academyId", "athleteId");

ALTER TABLE "Salary" DROP CONSTRAINT IF EXISTS "Salary_academyId_fkey";
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Salary" DROP CONSTRAINT IF EXISTS "Salary_membershipId_fkey";
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Salary" DROP CONSTRAINT IF EXISTS "Salary_athleteId_fkey";
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Salary" DROP CONSTRAINT IF EXISTS "Salary_createdById_fkey";
ALTER TABLE "Salary" ADD CONSTRAINT "Salary_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinancialTransaction" ADD COLUMN IF NOT EXISTS "salaryId" TEXT;
ALTER TABLE "FinancialTransaction" ADD COLUMN IF NOT EXISTS "salaryPeriod" TEXT;
ALTER TABLE "FinancialTransaction" DROP CONSTRAINT IF EXISTS "FinancialTransaction_salaryId_fkey";
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_salaryId_fkey" FOREIGN KEY ("salaryId") REFERENCES "Salary"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "FinancialTransaction_salaryId_salaryPeriod_idx" ON "FinancialTransaction"("salaryId", "salaryPeriod");

-- Isolamento por academia: dinheiro é a última coisa que pode atravessar clubes.
ALTER TABLE "Salary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Salary" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Salary";
CREATE POLICY tenant_isolation ON "Salary"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "Salary" TO academia_app;
