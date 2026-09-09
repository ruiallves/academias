-- Copiar outra vez os pagamentos antigos para a tabela de junção.
--
-- A migração anterior (`20260910120000_quotas_varios_meses`) traz este mesmo
-- `INSERT`, e no ambiente de desenvolvimento **não copiou nada** — a tabela
-- ficou vazia com um pagamento elegível na base, anterior à migração. O mesmo
-- comando, corrido à mão a seguir, copiou-o sem se queixar. Não consegui
-- explicar a diferença, e não vale a pena adivinhar: é idempotente, corre-se
-- outra vez, e o assunto fecha-se.
--
-- Nada disto é crítico, e é bom que não seja: o `payPayment` só usa a junção
-- quando ela tem linhas e cai na âncora (`Payment.memberFeeId`) quando não tem
-- — um pagamento antigo liquida a sua quota de qualquer maneira. Isto é para os
-- dados ficarem a dizer a mesma coisa em todo o lado, não para o código
-- funcionar.

INSERT INTO "MemberFeePayment" ("paymentId", "memberFeeId")
SELECT "id", "memberFeeId" FROM "Payment" WHERE "memberFeeId" IS NOT NULL
ON CONFLICT DO NOTHING;
