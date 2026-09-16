-- ---------------------------------------------------------------------------
-- O ano de quotas abre num dia, não só num mês
-- ---------------------------------------------------------------------------
--
-- A `periodo_anual_do_clube` pôs o mês de abertura no clube. Um clube que fecha
-- contas a 15 de Setembro abre o ano de quotas a 15 de Setembro — e o período
-- acaba a 14 de Setembro do ano seguinte. O dia decide **quando** o período
-- abre (antes do dia 15, Setembro ainda é do período anterior); a quota continua
-- a ter por período o mês em que abre, `AAAA-MM`. Por omissão, o dia 1, que é o
-- que era.

ALTER TABLE "Academy"
  ADD COLUMN IF NOT EXISTS "memberAnnualStartDay" INTEGER NOT NULL DEFAULT 1;
