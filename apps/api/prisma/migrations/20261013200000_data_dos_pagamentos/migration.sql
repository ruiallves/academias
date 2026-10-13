-- A data de pagamento das cobranças pagas que não a têm.
--
-- As Contas leem os pagamentos das cobranças pela data em que foram pagas
-- (`settledAt`). Algumas foram dadas como pagas à mão antes de essa data se
-- guardar: apareciam nos movimentos com a data de hoje e ficavam fora das
-- contas do mês e do gráfico. A melhor data que há é a de quem as marcou
-- (`statusChangedAt`) e, sem ela, a última alteração da linha.
--
-- Só dados, e só linhas pagas sem data: não mexe em nenhuma com data.

UPDATE "Charge"
   SET "settledAt" = COALESCE("statusChangedAt", "updatedAt")
 WHERE status = 'SETTLED' AND "settledAt" IS NULL;

UPDATE "MemberFee"
   SET "settledAt" = "updatedAt"
 WHERE status = 'SETTLED' AND "settledAt" IS NULL;
