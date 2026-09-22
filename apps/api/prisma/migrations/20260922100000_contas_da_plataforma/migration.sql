-- As contas da plataforma: o que entra, o que sai, e o que aí vem.
--
-- ## O que isto responde
--
-- "Quanto é que este mês rendeu?", "quanto é que gasto por mês, mesmo sem
-- vender nada?" e "a partir de que mês é que os clubes que já tenho pagam os
-- custos fixos?". O painel sabia o MRR e mais nada: um número de receita sem
-- custos ao lado não diz se o negócio se paga.
--
-- ## Três tabelas, e porquê
--
-- - `PlatformTransaction` — o livro. Um movimento por linha, ganho ou gasto,
--   com o sentido em `kind` e o valor sempre positivo (a mesma regra das contas
--   dos clubes: um gasto negativo faz a primeira soma errada passar despercebida).
-- - `PlatformRecurringExpense` — os **gastos fixos**. Uma despesa mensal ou
--   anual descrita uma vez (servidores, contabilidade, domínios, seguros) em vez
--   de doze linhas escritas à mão. É daqui que sai a previsão dos próximos meses.
-- - `PlatformFinanceSettings` — o saldo de abertura e o IVA das mensalidades.
--
-- A receita recorrente **não** se escreve aqui: vem dos clubes, das subscrições
-- e dos avisos de pagamento (`SubscriptionNotice`). Copiá-la para o livro à mão
-- dava dois sítios a dizer quanto rende cada clube.
--
-- ## O IVA
--
-- Cada movimento guarda o valor **com IVA** e a taxa. O líquido calcula-se, e é
-- o líquido que conta na previsão: é o que fica depois de entregar o IVA.
-- Guardar os dois valores era guardar a mesma coisa duas vezes e deixar que
-- discordassem.
--
-- ## Tabelas da plataforma
--
-- Como `Plan`, `Subscription` e `AuditLog`: o papel da aplicação (`academia_app`)
-- não lhes toca. Estas contas são do negócio, não dos clubes.

CREATE TYPE "PlatformFinanceKind" AS ENUM ('INCOME', 'EXPENSE');

-- COMPLETED: aconteceu. PENDING: está previsto e ainda não se moveu (a factura
-- do contabilista que só se paga no dia 20). Um previsto entra na previsão e
-- fica de fora do que já rendeu.
CREATE TYPE "PlatformFinanceStatus" AS ENUM ('COMPLETED', 'PENDING');

CREATE TYPE "PlatformRecurrence" AS ENUM ('MONTHLY', 'ANNUAL');

CREATE TABLE "PlatformTransaction" (
  "id"           TEXT PRIMARY KEY,
  "kind"         "PlatformFinanceKind" NOT NULL,
  "status"       "PlatformFinanceStatus" NOT NULL DEFAULT 'COMPLETED',

  "description"  TEXT NOT NULL,
  -- Sempre positivo, em cêntimos, **com IVA**. O sentido está em `kind`.
  "amountCents"  INTEGER NOT NULL,
  -- 23, 13, 6 ou 0. O líquido é uma divisão, não uma coluna.
  "vatRate"      INTEGER NOT NULL DEFAULT 23,

  "occurredAt"   DATE NOT NULL,
  "dueDate"      DATE,

  -- Texto livre, como nas contas dos clubes na fase 1: "Servidores", "Contabilidade".
  "category"     TEXT,
  -- De quem veio ou para quem foi.
  "counterparty" TEXT,
  "notes"        TEXT,

  -- O clube, quando o movimento é de um clube.
  "academyId"    TEXT REFERENCES "Academy"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- O aviso de mensalidade que foi pago e deu origem a este ganho. Único: um
  -- aviso pago é um ganho, e marcar duas vezes não pode somar duas.
  "noticeId"     TEXT UNIQUE REFERENCES "SubscriptionNotice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- O gasto fixo que o gerou, quando não foi escrito à mão.
  "recurringId"  TEXT,

  "createdById"  TEXT REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL
);

CREATE INDEX "PlatformTransaction_occurredAt_idx" ON "PlatformTransaction"("occurredAt" DESC);
CREATE INDEX "PlatformTransaction_kind_occurredAt_idx" ON "PlatformTransaction"("kind", "occurredAt" DESC);
CREATE INDEX "PlatformTransaction_academyId_idx" ON "PlatformTransaction"("academyId");

CREATE TABLE "PlatformRecurringExpense" (
  "id"           TEXT PRIMARY KEY,
  "description"  TEXT NOT NULL,
  "amountCents"  INTEGER NOT NULL,
  "vatRate"      INTEGER NOT NULL DEFAULT 23,
  "recurrence"   "PlatformRecurrence" NOT NULL DEFAULT 'MONTHLY',
  -- Em que dia do mês sai. Até 28 de propósito: um gasto marcado para 31 não
  -- existe em Fevereiro, e a previsão passaria a saltar meses.
  "dayOfMonth"   INTEGER NOT NULL DEFAULT 1,
  -- Só nos anuais: em que mês (1 a 12).
  "month"        INTEGER,
  "category"     TEXT,
  "counterparty" TEXT,
  "notes"        TEXT,
  -- Desde quando conta, e até quando. Um gasto que acabou fica na história e
  -- deixa de entrar na previsão.
  "startsOn"     DATE NOT NULL,
  "endsOn"       DATE,
  "isActive"     BOOLEAN NOT NULL DEFAULT true,

  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL
);

CREATE INDEX "PlatformRecurringExpense_isActive_idx" ON "PlatformRecurringExpense"("isActive");

ALTER TABLE "PlatformTransaction"
  ADD CONSTRAINT "PlatformTransaction_recurringId_fkey"
  FOREIGN KEY ("recurringId") REFERENCES "PlatformRecurringExpense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma linha só, como as definições financeiras de um clube.
CREATE TABLE "PlatformFinanceSettings" (
  "id"                  TEXT PRIMARY KEY,
  -- O que havia em caixa quando estas contas começaram, e desde quando os
  -- movimentos contam. O que aconteceu antes está dentro do saldo de abertura.
  "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
  "openingBalanceAt"    DATE,
  -- O IVA das mensalidades dos clubes, e se o preço acordado já o inclui.
  -- Por omissão o preço do plano é sem IVA e acrescem 23%, que é como se
  -- anuncia a um clube.
  "subscriptionVatRate" INTEGER NOT NULL DEFAULT 23,
  "subscriptionVatIncluded" BOOLEAN NOT NULL DEFAULT false,
  "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"           TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- O aviso de mensalidade passa a saber se foi pago
-- ---------------------------------------------------------------------------
--
-- É o que fecha o ciclo aberto na migração `20260921100000`: o aviso sai todos
-- os meses, e agora regista-se o recebimento. O que está pago conta como ganho;
-- o que não está é dívida do clube, e aparece como tal.

ALTER TABLE "SubscriptionNotice"
  ADD COLUMN IF NOT EXISTS "paidAt"      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "paidNote"    TEXT,
  ADD COLUMN IF NOT EXISTS "paidById"    TEXT;

ALTER TABLE "SubscriptionNotice"
  ADD CONSTRAINT "SubscriptionNotice_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SubscriptionNotice_paidAt_idx" ON "SubscriptionNotice"("paidAt");

-- ---------------------------------------------------------------------------
-- Fora do alcance da aplicação
-- ---------------------------------------------------------------------------

REVOKE ALL ON "PlatformTransaction"      FROM academia_app;
REVOKE ALL ON "PlatformRecurringExpense" FROM academia_app;
REVOKE ALL ON "PlatformFinanceSettings"  FROM academia_app;
