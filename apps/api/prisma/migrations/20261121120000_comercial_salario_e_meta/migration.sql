-- Comercial: três formas de pagar (salário + comissão, só salário, só comissão),
-- meta semanal de reuniões e as condições escolhidas logo no convite.
-- Só acrescenta: o código antigo continua a funcionar com isto aplicado.

ALTER TYPE "SalesPayModel" ADD VALUE IF NOT EXISTS 'SALARY';

ALTER TABLE "SalesCompensation" ADD COLUMN "weeklyGoal" INTEGER NOT NULL DEFAULT 5;

ALTER TABLE "PlatformAdminInvite" ADD COLUMN "compensation" JSONB;
