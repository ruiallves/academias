-- O período de cobrança pode ser por escalão.
--
-- Um clube escreveu a dizer que os escalões não pagam os mesmos meses: uns não
-- pagam Agosto e pagam o resto do ano, outros pagam Agosto e não pagam Julho.
-- Até aqui o calendário era só do clube (`Academy.billingMonths`).
--
-- `Academy.billingByTeam` escolhe o modo. Por escalão, cada equipa diz os seus
-- meses em `Team.billingMonths`; vazio quer dizer "segue o clube", que é como
-- nasce uma equipa. Nenhum clube muda de comportamento com esta migração: o modo
-- nasce `false` e os meses das equipas nascem vazios.
--
-- As colunas `Next` são o agendamento para a próxima época, como as que a
-- academia já tinha (`billingNextFrom`, `billingNextMonths`, `billingNextDueDay`).

ALTER TABLE "Academy" ADD COLUMN "billingByTeam" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Academy" ADD COLUMN "billingNextByTeam" BOOLEAN;

ALTER TABLE "Team" ADD COLUMN "billingMonths" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
ALTER TABLE "Team" ADD COLUMN "billingNextMonths" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
