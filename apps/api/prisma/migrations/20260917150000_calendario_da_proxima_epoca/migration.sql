-- ---------------------------------------------------------------------------
-- O calendário de cobrança da próxima época
-- ---------------------------------------------------------------------------
--
-- Ao mudar o período de cobrança (dia de vencimento e meses cobrados), o clube
-- escolhe se vale já nesta época ou só a partir da próxima. A escolha "só a
-- partir da próxima" fica aqui à espera: `billingNextFrom` é o primeiro período
-- dessa época (`AAAA-08`), e a partir dele manda este calendário. Quando a
-- época vira, a emissão copia-o para `billingMonths`/`billingDueDay` e limpa
-- estas colunas. Nulo = nada agendado.

ALTER TABLE "Academy"
  ADD COLUMN IF NOT EXISTS "billingNextFrom" TEXT,
  ADD COLUMN IF NOT EXISTS "billingNextMonths" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  ADD COLUMN IF NOT EXISTS "billingNextDueDay" INTEGER;
