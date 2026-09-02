-- ---------------------------------------------------------------------------
-- A app do clube: contextos, cartão de sócio, quotas e sondagens
-- ---------------------------------------------------------------------------
--
-- A app da família passa a ser a app do clube: a mesma conta pode ter vários
-- contextos — Família (o vínculo GUARDIAN que já existia) e Sócio (uma ficha de
-- `Member` reclamada por convite). Esta migração traz o que falta do lado dos
-- dados:
--
--   1. a ponte `Member.userId` (e o convite que a estabelece);
--   2. o token opaco do cartão/QR;
--   3. o livro de quotas (`MemberFee`) — o irmão do `Charge` dos atletas;
--   4. sondagens (`Poll`/`PollOption`/`PollVote`);
--   5. o `Payment` a saber pagar quotas, além de mensalidades.
--
-- Ver os cabeçalhos dos modelos no schema para o porquê de cada decisão.

-- ---------------------------------------------------------------------------
-- 1. O cartão na Academy: dois interruptores
-- ---------------------------------------------------------------------------

ALTER TABLE "Academy" ADD COLUMN "memberCardEnabled"   BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Academy" ADD COLUMN "memberCardQrEnabled" BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 2. Member: a conta que reclamou a ficha, o token do cartão, o convite
-- ---------------------------------------------------------------------------

ALTER TABLE "Member" ADD COLUMN "userId"          TEXT;
ALTER TABLE "Member" ADD COLUMN "cardToken"       TEXT;
ALTER TABLE "Member" ADD COLUMN "inviteTokenHash" TEXT;
ALTER TABLE "Member" ADD COLUMN "inviteSentAt"    TIMESTAMP(3);

ALTER TABLE "Member" ADD CONSTRAINT "Member_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Member_cardToken_key"       ON "Member"("cardToken");
CREATE UNIQUE INDEX "Member_inviteTokenHash_key" ON "Member"("inviteTokenHash");
-- Uma conta reclama no máximo uma ficha por clube; noutro clube pode reclamar
-- outra. (Os NULL não contam para um unique do Postgres — os sócios sem conta,
-- que são quase todos, não chocam entre si.)
CREATE UNIQUE INDEX "Member_academyId_userId_key" ON "Member"("academyId", "userId");

-- ---------------------------------------------------------------------------
-- 3. MemberFee — o livro de quotas
-- ---------------------------------------------------------------------------

CREATE TABLE "MemberFee" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "memberId"    TEXT NOT NULL,

  "period"      TEXT NOT NULL,
  "label"       TEXT,
  "amountCents" INTEGER NOT NULL,
  "dueOn"       DATE,

  "status"      "ChargeStatus" NOT NULL DEFAULT 'OPEN',
  "settledAt"   TIMESTAMP(3),
  "method"      "PaymentMethod",
  "notes"       TEXT,

  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MemberFee_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MemberFee_academyId_fkey" FOREIGN KEY ("academyId")
    REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MemberFee_memberId_fkey" FOREIGN KEY ("memberId")
    REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Uma quota por período por sócio: gerar o mesmo período duas vezes não pode
-- duplicar dívida. O serviço salta os existentes; o índice é a rede.
CREATE UNIQUE INDEX "MemberFee_memberId_period_key" ON "MemberFee"("memberId", "period");
CREATE INDEX "MemberFee_academyId_status_idx" ON "MemberFee"("academyId", "status");
CREATE INDEX "MemberFee_academyId_period_idx" ON "MemberFee"("academyId", "period");

-- ---------------------------------------------------------------------------
-- 4. Sondagens
-- ---------------------------------------------------------------------------

CREATE TYPE "PollStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

CREATE TABLE "Poll" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,

  "question"    TEXT NOT NULL,
  "details"     TEXT,

  "status"      "PollStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3),
  "closedAt"    TIMESTAMP(3),

  "createdById" TEXT,

  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Poll_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Poll_academyId_fkey" FOREIGN KEY ("academyId")
    REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById")
    REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Poll_academyId_status_idx" ON "Poll"("academyId", "status");

CREATE TABLE "PollOption" (
  "id"        TEXT NOT NULL,
  -- Duplicado do pai de propósito: é o que deixa a política de RLS comparar
  -- direto, sem EXISTS — a regra de todas as tabelas-filho deste schema.
  "academyId" TEXT NOT NULL,
  "pollId"    TEXT NOT NULL,

  "label"     TEXT NOT NULL,
  "order"     INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PollOption_academyId_fkey" FOREIGN KEY ("academyId")
    REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId")
    REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PollOption_pollId_idx" ON "PollOption"("pollId");

CREATE TABLE "PollVote" (
  "id"        TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "pollId"    TEXT NOT NULL,
  "optionId"  TEXT NOT NULL,
  "memberId"  TEXT NOT NULL,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PollVote_academyId_fkey" FOREIGN KEY ("academyId")
    REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId")
    REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId")
    REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "PollVote_memberId_fkey" FOREIGN KEY ("memberId")
    REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Um sócio, um voto. O serviço recusa antes com uma frase; isto é a rede.
CREATE UNIQUE INDEX "PollVote_pollId_memberId_key" ON "PollVote"("pollId", "memberId");
CREATE INDEX "PollVote_optionId_idx" ON "PollVote"("optionId");

-- ---------------------------------------------------------------------------
-- 5. Payment: uma mensalidade OU uma quota
-- ---------------------------------------------------------------------------

ALTER TABLE "Payment" ALTER COLUMN "chargeId" DROP NOT NULL;
ALTER TABLE "Payment" ADD COLUMN "memberFeeId" TEXT;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_memberFeeId_fkey"
  FOREIGN KEY ("memberFeeId") REFERENCES "MemberFee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "Payment_memberFeeId_idx" ON "Payment"("memberFeeId");

-- Exactamente um dos dois. O Prisma não sabe dizer "ou exclusivo"; o Postgres
-- sabe, e é ele que fica de guarda — um pagamento órfão dos dois lados seria
-- dinheiro sem dono, e com os dois seria dinheiro contado duas vezes.
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_exactly_one_owner"
  CHECK (("chargeId" IS NOT NULL) <> ("memberFeeId" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 6. RLS e GRANTs
-- ---------------------------------------------------------------------------

ALTER TABLE "MemberFee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MemberFee" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "MemberFee"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "Poll" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Poll" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "Poll"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "PollOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PollOption" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PollOption"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "PollVote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PollVote" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "PollVote"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "MemberFee", "Poll", "PollOption", "PollVote" TO academia_app;

-- O Payment já tinha política — mas ela só sabia chegar à academia pela
-- mensalidade. Com quotas no meio, um pagamento de quota ficava invisível
-- dentro do próprio tenant. Reescreve-se com os dois caminhos.
DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment"
  USING (
    EXISTS (
      SELECT 1 FROM "Charge" c
      WHERE c.id = "Payment"."chargeId" AND c."academyId" = app.current_academy_id()
    )
    OR EXISTS (
      SELECT 1 FROM "MemberFee" f
      WHERE f.id = "Payment"."memberFeeId" AND f."academyId" = app.current_academy_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Charge" c
      WHERE c.id = "Payment"."chargeId" AND c."academyId" = app.current_academy_id()
    )
    OR EXISTS (
      SELECT 1 FROM "MemberFee" f
      WHERE f.id = "Payment"."memberFeeId" AND f."academyId" = app.current_academy_id()
    )
  );

-- O webhook resolve a academia pelo pagamento — e o pagamento pode agora ser de
-- quota. Mesma assinatura, mesmo tipo de retorno: só o corpo muda, o que o
-- CREATE OR REPLACE aceita sem partir prepared statements (o 0A000 de que este
-- projecto já se queimou era uma mudança de *shape*, não de corpo).
CREATE OR REPLACE FUNCTION app.resolve_payment_academy(p_provider text, p_ref text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(c."academyId", f."academyId")
  FROM "Payment" p
  LEFT JOIN "Charge" c ON c.id = p."chargeId"
  LEFT JOIN "MemberFee" f ON f.id = p."memberFeeId"
  WHERE p.provider = p_provider AND p."providerRef" = p_ref
  LIMIT 1;
$$;
