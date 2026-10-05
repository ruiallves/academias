-- A fatura de cada mensalidade da plataforma paga.
--
-- A euPago não emite faturas: emitem-se no Portal das Finanças e anexam-se aqui,
-- no painel, ao pagamento a que dizem respeito. Anexar pode mandar o PDF por
-- email ao responsável do clube, ou não; e pode-se só marcar como enviada, sem
-- ficheiro, quando a fatura seguiu por outro caminho. Enquanto `invoiceSentAt`
-- for nulo numa mensalidade paga, a lista do painel diz "falta fatura".
--
-- Só colunas novas e opcionais: a API que está no ar não as lê nem as escreve.

ALTER TABLE "SubscriptionNotice"
  ADD COLUMN "invoiceSentAt" TIMESTAMP(3),
  ADD COLUMN "invoicePath" TEXT,
  ADD COLUMN "invoiceFileName" TEXT,
  ADD COLUMN "invoiceEmailedTo" TEXT,
  ADD COLUMN "invoiceEmailedAt" TIMESTAMP(3);
