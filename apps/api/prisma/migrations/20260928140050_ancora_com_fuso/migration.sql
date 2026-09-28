-- O dia de cobrança guardado com fuso, como as outras datas da ordem.
--
-- `20260928140000_declaracao_de_aceitacao` criou `billingAnchorAt` como
-- TIMESTAMP sem fuso, e as outras datas desta tabela (`signedAt`, `sentAt`)
-- são TIMESTAMPTZ. Copiar uma para a outra (é o que a reemissão faz) convertia
-- pela hora da sessão e deslocava a âncora uma hora — que, perto da meia-noite,
-- muda o dia em que o clube paga. A coluna ainda está vazia em todo o lado.
ALTER TABLE "SubscriptionOrder"
  ALTER COLUMN "billingAnchorAt" TYPE TIMESTAMPTZ(3) USING "billingAnchorAt" AT TIME ZONE 'UTC';
