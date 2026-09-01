-- Contas: a gestão financeira do clube.
--
-- ## Três decisões que definem o módulo
--
-- 1. **As mensalidades pagas não entram nesta tabela.** São derivadas na
--    leitura a partir de `Charge`, que já é a verdade delas. Materializá-las
--    seria a mesma verdade em duas tabelas — com backfill, deduplicação por
--    webhook e divergência garantida ao primeiro estorno. "Nunca duplicar
--    movimentos" fica trivialmente verdade: não há segunda escrita.
--
-- 2. **O saldo não é uma coluna.** É saldo inicial + concluídos + fontes
--    automáticas ligadas, calculado na leitura — a regra do disponível do
--    inventário e da carga de treino, pela mesma razão.
--
-- 3. **Nada se apaga.** Um movimento errado cancela-se e fica riscado; um
--    módulo financeiro onde linhas desaparecem em silêncio deixa de merecer
--    confiança na primeira contagem que não bate certo.

CREATE TYPE "FinanceKind" AS ENUM ('INCOME', 'EXPENSE');
CREATE TYPE "FinanceStatus" AS ENUM ('PLANNED', 'PENDING', 'COMPLETED', 'CANCELLED');

CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "kind" "FinanceKind" NOT NULL,
    "status" "FinanceStatus" NOT NULL DEFAULT 'COMPLETED',
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "occurredAt" DATE NOT NULL,
    "dueDate" DATE,
    "categoryId" TEXT,
    "method" "PaymentMethod",
    "counterparty" TEXT,
    "notes" TEXT,
    "athleteId" TEXT,
    "memberId" TEXT,
    "teamId" TEXT,
    "staffId" TEXT,
    "matchId" TEXT,
    "calendarEventId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinanceSettings" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "initialBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "initialBalanceAt" DATE,
    "includeFees" BOOLEAN NOT NULL DEFAULT true,
    "includeQuotas" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinanceSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialBudget" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinancialBudget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FinanceSettings_academyId_key" ON "FinanceSettings"("academyId");
CREATE UNIQUE INDEX "FinancialBudget_academyId_seasonId_categoryId_key" ON "FinancialBudget"("academyId", "seasonId", "categoryId");
CREATE INDEX "FinancialTransaction_academyId_occurredAt_idx" ON "FinancialTransaction"("academyId", "occurredAt");
CREATE INDEX "FinancialTransaction_academyId_kind_status_idx" ON "FinancialTransaction"("academyId", "kind", "status");
CREATE INDEX "FinancialTransaction_matchId_idx" ON "FinancialTransaction"("matchId");
CREATE INDEX "FinancialTransaction_calendarEventId_idx" ON "FinancialTransaction"("calendarEventId");
CREATE INDEX "FinancialBudget_academyId_seasonId_idx" ON "FinancialBudget"("academyId", "seasonId");

ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_calendarEventId_fkey" FOREIGN KEY ("calendarEventId") REFERENCES "CalendarEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "FinanceSettings" ADD CONSTRAINT "FinanceSettings_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FinancialBudget" ADD CONSTRAINT "FinancialBudget_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialBudget" ADD CONSTRAINT "FinancialBudget_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FinancialBudget" ADD CONSTRAINT "FinancialBudget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento por academia — a mesma política de sempre, na base e não na
-- aplicação. Dinheiro é a última coisa que pode atravessar clubes.
-- ---------------------------------------------------------------------------

ALTER TABLE "FinancialTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancialTransaction" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FinancialTransaction";
CREATE POLICY tenant_isolation ON "FinancialTransaction"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "FinanceSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceSettings" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FinanceSettings";
CREATE POLICY tenant_isolation ON "FinanceSettings"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "FinancialBudget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancialBudget" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FinancialBudget";
CREATE POLICY tenant_isolation ON "FinancialBudget"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE
   ON "FinancialTransaction", "FinanceSettings", "FinancialBudget"
   TO academia_app;

-- ---------------------------------------------------------------------------
-- As permissões chegam aos cargos que já existem — a regra que o guarda
-- `check-permissions.mjs` vigia desde o incidente do `team:delete`.
--
-- Dinheiro é da primeira pessoa do clube, da presidência e da direção, como o
-- inventário e o financeiro que já existe (`billing:*`). A coordenação fica de
-- fora; quem precisar recebe num cargo.
-- ---------------------------------------------------------------------------

UPDATE "AcademyRole"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['finance:read', 'finance:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['finance:read'];

UPDATE "Department"
   SET permissions = ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['finance:read', 'finance:write']) AS p),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND cardinality(permissions) > 0
   AND NOT permissions @> ARRAY['finance:read'];
