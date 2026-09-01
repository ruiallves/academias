-- Despesas (e receitas) fixas mensais.
--
-- A serie e um id partilhado pelas ocorrencias, nao uma tabela de regras: o que
-- uma serie precisa de saber e "quem sao os meus irmaos". Cada mes continua a
-- ser uma linha de verdade, que se confirma, se corrige e se cancela sozinha.
ALTER TABLE "FinancialTransaction" ADD COLUMN "seriesId" TEXT;

CREATE INDEX "FinancialTransaction_academyId_seriesId_idx"
  ON "FinancialTransaction"("academyId", "seriesId");
