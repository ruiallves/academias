-- Cobrar uma coisa avulsa a uma família.
--
-- ## O que muda
--
-- Uma `Charge` deixa de ser sempre a mensalidade do mês. Passa a ter um tipo
-- (`FEE` ou `EXTRA`), um título, uma categoria de receita e uma nota — o que
-- basta para o clube pedir o equipamento, a inscrição no torneio ou a viagem do
-- autocarro pelo mesmo caminho por onde já pede a mensalidade.
--
-- Uma tabela e não duas: do lado do pai são a mesma coisa. Aparecem na mesma
-- lista, pagam-se pelos mesmos meios, e a euPago não distingue nenhuma das duas.
-- Uma tabela nova obrigava a duplicar o fluxo de pagamento inteiro — referência
-- Multibanco, webhook, estado — para mudar um rótulo.
--
-- ## Porque é que a chave única ganha uma coluna
--
-- `UNIQUE (athleteId, period)` era o que garantia **uma** mensalidade por atleta
-- por mês: é ele que trava a corrida entre duas secretarias a gerar o mesmo
-- período ao mesmo tempo (ver `skipDuplicates` em `generateCharges`). Não se
-- pode simplesmente largar.
--
-- Mas também não pode ficar como está: um clube pede o equipamento **e** a
-- viagem ao mesmo pai no mesmo mês, e as duas coisas são duas cobranças.
--
-- `slot` resolve os dois: vazio na mensalidade — e aí a chave é a de sempre —,
-- único em cada extra. Todas as linhas que já existem são mensalidades e ficam
-- com `''`, por isso a garantia antiga sobrevive à migração sem uma linha de
-- código a verificá-la.
--
-- A alternativa era um índice único parcial (`WHERE kind = 'FEE'`), que o
-- Postgres faz bem e o Prisma não sabe escrever. Ficaria fora do
-- `schema.prisma`, e o `check:schema` — que compara a base a correr com o
-- modelo do código — passaria a acusar deriva em todas as execuções. Uma coluna
-- que o modelo conhece vale mais do que um índice que ele não vê.

CREATE TYPE "ChargeKind" AS ENUM ('FEE', 'EXTRA');

ALTER TABLE "Charge" ADD COLUMN "kind" "ChargeKind" NOT NULL DEFAULT 'FEE';
ALTER TABLE "Charge" ADD COLUMN "slot" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Charge" ADD COLUMN "title" TEXT;
ALTER TABLE "Charge" ADD COLUMN "notes" TEXT;
ALTER TABLE "Charge" ADD COLUMN "categoryId" TEXT;

-- A categoria vem do mesmo catálogo das receitas das Contas. `SET NULL` e não
-- `CASCADE`: apagar uma categoria do catálogo não pode apagar dinheiro que uma
-- família já deve — perde-se a etiqueta, nunca a cobrança.
ALTER TABLE "Charge"
  ADD CONSTRAINT "Charge_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "CatalogItem"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX "Charge_athleteId_period_key";
CREATE UNIQUE INDEX "Charge_athleteId_period_slot_key" ON "Charge"("athleteId", "period", "slot");
CREATE INDEX "Charge_categoryId_idx" ON "Charge"("categoryId");
