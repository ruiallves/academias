-- Um pagamento pode cobrir vários meses de quota.
--
-- ## Porque é que não chega o `Payment.memberFeeId`
--
-- Porque é um só. Um sócio que esteja três meses em atraso e queira ficar em
-- dia tinha de fazer três pagamentos — três pedidos MB Way no telemóvel, ou
-- três referências Multibanco para pagar uma a uma. Ninguém faz isso; deixa
-- para depois, e o clube fica sem o dinheiro.
--
-- ## A ordem é a regra, e é ela que dá sentido a isto
--
-- As quotas pagam-se do mês mais antigo para o mais recente, sempre. Nunca
-- pode haver Março pago com Fevereiro em aberto — um histórico com buracos não
-- se lê, e a conversa "então eu paguei ou não paguei?" não tem resposta. Por
-- isso o que a app pede não é "estes meses", é "até este mês": o servidor
-- resolve o conjunto para trás e cobra tudo o que faltava, sem saltos
-- possíveis.
--
-- ## O `memberFeeId` fica — como âncora
--
-- Continua a apontar para o **mês mais antigo** do grupo. É o que as
-- notificações usam para abrir o ecrã certo, e é o que os pagamentos antigos
-- (anteriores a esta migração) têm. A verdade sobre o que um pagamento liquida
-- passa a ser esta tabela, e os antigos são copiados para cá já a seguir — para
-- não haver dois sítios com respostas diferentes.

CREATE TABLE "MemberFeePayment" (
    "paymentId"   TEXT NOT NULL,
    "memberFeeId" TEXT NOT NULL,

    CONSTRAINT "MemberFeePayment_pkey" PRIMARY KEY ("paymentId", "memberFeeId")
);

CREATE INDEX "MemberFeePayment_memberFeeId_idx" ON "MemberFeePayment"("memberFeeId");

ALTER TABLE "MemberFeePayment" ADD CONSTRAINT "MemberFeePayment_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MemberFeePayment" ADD CONSTRAINT "MemberFeePayment_memberFeeId_fkey"
  FOREIGN KEY ("memberFeeId") REFERENCES "MemberFee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Os pagamentos que já existem passam a estar aqui também. Sem isto, o dia em
-- que o webhook passasse a ler só esta tabela deixava de liquidar as quotas dos
-- pagamentos que estavam em curso.
INSERT INTO "MemberFeePayment" ("paymentId", "memberFeeId")
SELECT "id", "memberFeeId" FROM "Payment" WHERE "memberFeeId" IS NOT NULL
ON CONFLICT DO NOTHING;

-- A mesma política das outras tabelas de junção (ver `TeamCompetition`): não
-- tem `academyId`, chega-lhe pela quota.
ALTER TABLE "MemberFeePayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemberFeePayment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MemberFeePayment";
CREATE POLICY tenant_isolation ON "MemberFeePayment"
  USING (EXISTS (SELECT 1 FROM "MemberFee" f WHERE f."id" = "memberFeeId" AND f."academyId" = app.current_academy_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "MemberFee" f WHERE f."id" = "memberFeeId" AND f."academyId" = app.current_academy_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "MemberFeePayment" TO academia_app;
