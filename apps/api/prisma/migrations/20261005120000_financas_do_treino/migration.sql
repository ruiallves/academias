-- O dinheiro de um treino. Uma coluna nova, opcional; nada do que existe muda.
--
-- Um movimento das Contas já se podia ligar a um jogo ou a um evento do
-- calendário. Os treinos ficavam de fora, e há treinos com custos próprios: o
-- pavilhão alugado, o autocarro para um treino fora, um treinador convidado.
--
-- `SET NULL`, como as outras ligações: apagar um treino não apaga o dinheiro.

ALTER TABLE "FinancialTransaction" ADD COLUMN "trainingSessionId" TEXT;

CREATE INDEX "FinancialTransaction_trainingSessionId_idx" ON "FinancialTransaction"("trainingSessionId");

ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_trainingSessionId_fkey" FOREIGN KEY ("trainingSessionId") REFERENCES "TrainingSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
