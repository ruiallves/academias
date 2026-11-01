-- Área comercial: o papel Comercial, as reuniões que ele marca, os turnos, quanto
-- se lhe paga e os meses aprovados.
--
-- Só acrescenta: um valor novo no enum dos papéis, três colunas no Contact (todas
-- com valor por omissão ou vazias) e tabelas novas. A versão em produção continua
-- a funcionar até ao deploy da API nova.

ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'COMERCIAL';

CREATE TYPE "ContactLostReason" AS ENUM ('PRECO', 'JA_USA_OUTRO', 'NAO_E_ALTURA', 'SEM_DECISAO', 'CLUBE_PEQUENO', 'SEM_INTERESSE', 'OUTRO');
CREATE TYPE "SalesMeetingMode" AS ENUM ('PRESENCIAL', 'VIDEOCHAMADA', 'TELEFONE');
CREATE TYPE "SalesMeetingStatus" AS ENUM ('MARCADA', 'REALIZADA', 'FALTARAM', 'CANCELADA');

ALTER TABLE "Contact"
  ADD COLUMN "locality"      TEXT,
  ADD COLUMN "noAnswerCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lostReason"    "ContactLostReason";

ALTER TABLE "ContactTouch"
  ADD COLUMN "byId"    TEXT,
  ADD COLUMN "outcome" TEXT;
CREATE INDEX "ContactTouch_byId_happenedAt_idx" ON "ContactTouch"("byId", "happenedAt");

CREATE TABLE "SalesMeeting" (
  "id"                  TEXT NOT NULL,
  "contactId"           TEXT NOT NULL,
  "scheduledAt"         TIMESTAMP(3) NOT NULL,
  "durationMin"         INTEGER NOT NULL DEFAULT 45,
  "mode"                "SalesMeetingMode" NOT NULL DEFAULT 'VIDEOCHAMADA',
  "location"            TEXT,
  "personName"          TEXT NOT NULL,
  "personRole"          TEXT,
  "personPhone"         TEXT,
  "personEmail"         TEXT,
  "decides"             BOOLEAN,
  "athletes"            INTEGER,
  "teams"               TEXT,
  "currentTool"         TEXT,
  "pain"                TEXT,
  "suggestedPlan"       TEXT,
  "notes"               TEXT,
  "status"              "SalesMeetingStatus" NOT NULL DEFAULT 'MARCADA',
  "outcomeNote"         TEXT,
  "outcomeAt"           TIMESTAMP(3),
  "countsForCommission" BOOLEAN NOT NULL DEFAULT true,
  "bookedById"          TEXT,
  "bookedByName"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesMeeting_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesMeeting_scheduledAt_idx" ON "SalesMeeting"("scheduledAt");
CREATE INDEX "SalesMeeting_bookedById_createdAt_idx" ON "SalesMeeting"("bookedById", "createdAt");
CREATE INDEX "SalesMeeting_contactId_idx" ON "SalesMeeting"("contactId");
ALTER TABLE "SalesMeeting" ADD CONSTRAINT "SalesMeeting_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesMeeting" ADD CONSTRAINT "SalesMeeting_bookedById_fkey"
  FOREIGN KEY ("bookedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SalesShift" (
  "id"        TEXT NOT NULL,
  "adminId"   TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt"   TIMESTAMP(3),
  "note"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesShift_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesShift_adminId_startedAt_idx" ON "SalesShift"("adminId", "startedAt");
ALTER TABLE "SalesShift" ADD CONSTRAINT "SalesShift_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SalesCompensation" (
  "adminId"               TEXT NOT NULL,
  "hourlyCents"           INTEGER NOT NULL DEFAULT 700,
  "meetingsPerCommission" INTEGER NOT NULL DEFAULT 5,
  "commissionCents"       INTEGER NOT NULL DEFAULT 0,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalesCompensation_pkey" PRIMARY KEY ("adminId")
);
ALTER TABLE "SalesCompensation" ADD CONSTRAINT "SalesCompensation_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SalesPayout" (
  "id"              TEXT NOT NULL,
  "adminId"         TEXT NOT NULL,
  "month"           TEXT NOT NULL,
  "minutes"         INTEGER NOT NULL,
  "meetings"        INTEGER NOT NULL,
  "commissions"     INTEGER NOT NULL,
  "hoursCents"      INTEGER NOT NULL,
  "commissionCents" INTEGER NOT NULL,
  "totalCents"      INTEGER NOT NULL,
  "approvedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedById"    TEXT,
  "transactionId"   TEXT,
  CONSTRAINT "SalesPayout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SalesPayout_adminId_month_key" ON "SalesPayout"("adminId", "month");
CREATE UNIQUE INDEX "SalesPayout_transactionId_key" ON "SalesPayout"("transactionId");
ALTER TABLE "SalesPayout" ADD CONSTRAINT "SalesPayout_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesPayout" ADD CONSTRAINT "SalesPayout_approvedById_fkey"
  FOREIGN KEY ("approvedById") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SalesPayout" ADD CONSTRAINT "SalesPayout_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "PlatformTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Tabelas da plataforma: nenhum acesso a partir do código dos clubes. Ver a
-- migração 20260821000200_contacts, que explica porque é que isto é preciso.
REVOKE ALL ON "SalesMeeting"      FROM academia_app;
REVOKE ALL ON "SalesShift"        FROM academia_app;
REVOKE ALL ON "SalesCompensation" FROM academia_app;
REVOKE ALL ON "SalesPayout"       FROM academia_app;
