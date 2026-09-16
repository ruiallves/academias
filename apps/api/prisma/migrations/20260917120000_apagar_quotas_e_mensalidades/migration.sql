-- ---------------------------------------------------------------------------
-- Apagar quotas e mensalidades, sem que a emissão as traga de volta
-- ---------------------------------------------------------------------------
--
-- Quotas de sócio e mensalidades de atleta mudavam de estado (paga, por pagar,
-- anulada) mas não se apagavam. Apagar uma lançada por engano esbarra na
-- emissão automática: ela corre de hora a hora e cria **o que falta** — a
-- mensalidade do mês de cada atleta activo com preço, a quota do período de
-- cada sócio activo com preço. Uma apagada é, para ela, uma que falta.
--
-- Estas duas tabelas são a memória de que a direcção a tirou. A emissão salta
-- o par (pessoa, período) que aqui estiver; lançá-lo à mão apaga a marca, e é
-- assim que se volta atrás. Não são histórico nem auditoria — só a razão de a
-- emissão não recriar o que alguém acabou de apagar.

CREATE TABLE IF NOT EXISTS "ChargeSkip" (
  "academyId" TEXT NOT NULL,
  "athleteId" TEXT NOT NULL,
  "period"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChargeSkip_pkey" PRIMARY KEY ("athleteId", "period"),
  CONSTRAINT "ChargeSkip_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChargeSkip_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ChargeSkip_academyId_period_idx" ON "ChargeSkip"("academyId", "period");

CREATE TABLE IF NOT EXISTS "MemberFeeSkip" (
  "academyId" TEXT NOT NULL,
  "memberId"  TEXT NOT NULL,
  "period"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MemberFeeSkip_pkey" PRIMARY KEY ("memberId", "period"),
  CONSTRAINT "MemberFeeSkip_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemberFeeSkip_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "MemberFeeSkip_academyId_period_idx" ON "MemberFeeSkip"("academyId", "period");

-- A mesma isolação de todas as tabelas de um clube.
ALTER TABLE "ChargeSkip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ChargeSkip" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ChargeSkip";
CREATE POLICY tenant_isolation ON "ChargeSkip"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "ChargeSkip" TO academia_app;

ALTER TABLE "MemberFeeSkip" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemberFeeSkip" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MemberFeeSkip";
CREATE POLICY tenant_isolation ON "MemberFeeSkip"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "MemberFeeSkip" TO academia_app;
