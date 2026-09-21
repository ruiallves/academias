-- Os avisos de pagamento da subscrição da plataforma.
--
-- Todo o mês (ou todo o ano, num contrato anual) o clube recebe o aviso da
-- mensalidade de uso da aplicação. O relógio é o dia em que aceitou as
-- condições: aceitou a 20, recebe a 20 — ver `subscription/ciclo.ts`.
--
-- A tabela existe por duas razões, e nenhuma delas é guardar email:
--  - **não repetir**: a varredura corre de hora a hora, e é o par
--    (academia, início do período) que garante um aviso por período;
--  - **poder responder**: "mandaram-me isso?" tem de ter resposta com data,
--    endereço e valor, mesmo quando quem recebeu já não está no clube.

CREATE TABLE "SubscriptionNotice" (
  "id"            TEXT PRIMARY KEY,
  "academyId"     TEXT NOT NULL REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- A ordem assinada que deu origem a este aviso. Fica a null se a ordem for
  -- substituída: o aviso é um facto do passado e não se apaga com o contrato.
  "orderId"       TEXT REFERENCES "SubscriptionOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE,

  -- O período que o aviso cobre, inclusivo dos dois lados.
  "periodStart"   DATE NOT NULL,
  "periodEnd"     DATE NOT NULL,
  -- O dia em que devia sair (o aniversário da assinatura) e a data-limite.
  "issuedOn"      DATE NOT NULL,
  "dueOn"         DATE NOT NULL,

  -- O instantâneo do que se cobrou. O plano muda de preço e de nome; o que foi
  -- pedido naquele dia fica escrito, como na ordem de adesão.
  "planName"      TEXT NOT NULL,
  "billingPeriod" "SubscriptionBillingPeriod" NOT NULL DEFAULT 'MONTHLY',
  "amountCents"   INTEGER NOT NULL,

  -- Para quem foi, e se chegou a sair.
  "toEmail"       TEXT,
  "toName"        TEXT,
  "sentAt"        TIMESTAMPTZ,
  "failureNote"   TEXT,

  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Um aviso por período e por clube. É esta restrição — e não a memória do
-- processo — que faz a varredura poder correr de hora a hora sem repetir nada.
CREATE UNIQUE INDEX "SubscriptionNotice_academyId_periodStart_key"
  ON "SubscriptionNotice"("academyId", "periodStart");
CREATE INDEX "SubscriptionNotice_academyId_issuedOn_idx"
  ON "SubscriptionNotice"("academyId", "issuedOn" DESC);

-- ---------------------------------------------------------------------------
-- Isolamento por clube
-- ---------------------------------------------------------------------------
--
-- A mesma política da ordem de adesão: a consola lê os avisos do próprio clube.
--
-- Há UPDATE porque o aviso nasce **antes** de o email sair: a linha é o que
-- reserva o período (o índice único não deixa dois avisos do mesmo mês), e só
-- depois se marca `sentAt`. Fazer o contrário — enviar e depois guardar — era
-- arriscar dois emails ao mesmo clube sempre que a gravação falhasse.
--
-- DELETE não há: um aviso que saiu é um facto, e apagá-lo faria a varredura
-- seguinte mandá-lo outra vez.

ALTER TABLE "SubscriptionNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SubscriptionNotice" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON "SubscriptionNotice";
CREATE POLICY tenant_isolation ON "SubscriptionNotice"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE ON "SubscriptionNotice" TO academia_app;
REVOKE DELETE, TRUNCATE ON "SubscriptionNotice" FROM academia_app;
