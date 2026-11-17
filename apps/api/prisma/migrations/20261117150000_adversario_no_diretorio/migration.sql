-- O adversário de um jogo ligado ao diretório dos clubes, e os emblemas que os
-- clubes carregam (17/11/2026).
--
-- 1. `Match.opponentClubId`: o adversário escolhido do diretório (`KnownClub`).
--    O nome escrito (`opponent`) fica como estava; o emblema vem daqui.
-- 2. `ClubLogoProposal`: um emblema carregado por um clube para um adversário
--    sem emblema. Para esse clube vale logo; para a plataforma é uma proposta
--    que o painel aprova (passa ao diretório) ou rejeita, sem o clube saber.
--    RLS por clube, como as outras tabelas de clube; o painel lê tudo com a
--    ligação de migração.
--
-- Aditiva: a API antiga não lê nenhuma das duas.

ALTER TABLE "Match" ADD COLUMN IF NOT EXISTS "opponentClubId" TEXT;
ALTER TABLE "Match" DROP CONSTRAINT IF EXISTS "Match_opponentClubId_fkey";
ALTER TABLE "Match" ADD CONSTRAINT "Match_opponentClubId_fkey" FOREIGN KEY ("opponentClubId") REFERENCES "KnownClub"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "Match_opponentClubId_idx" ON "Match"("opponentClubId");

DO $$ BEGIN
  CREATE TYPE "ClubLogoProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ClubLogoProposal" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "knownClubId" TEXT,
    "clubName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "logoKey" TEXT,
    "status" "ClubLogoProposalStatus" NOT NULL DEFAULT 'PENDING',
    "byUserId" TEXT,
    "byName" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubLogoProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ClubLogoProposal_academyId_status_idx" ON "ClubLogoProposal"("academyId", "status");
CREATE INDEX IF NOT EXISTS "ClubLogoProposal_knownClubId_idx" ON "ClubLogoProposal"("knownClubId");
CREATE INDEX IF NOT EXISTS "ClubLogoProposal_status_createdAt_idx" ON "ClubLogoProposal"("status", "createdAt");

ALTER TABLE "ClubLogoProposal" DROP CONSTRAINT IF EXISTS "ClubLogoProposal_academyId_fkey";
ALTER TABLE "ClubLogoProposal" ADD CONSTRAINT "ClubLogoProposal_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClubLogoProposal" DROP CONSTRAINT IF EXISTS "ClubLogoProposal_knownClubId_fkey";
ALTER TABLE "ClubLogoProposal" ADD CONSTRAINT "ClubLogoProposal_knownClubId_fkey" FOREIGN KEY ("knownClubId") REFERENCES "KnownClub"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS: cada clube só vê as propostas que fez.
ALTER TABLE "ClubLogoProposal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClubLogoProposal" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClubLogoProposal";
CREATE POLICY tenant_isolation ON "ClubLogoProposal"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- O clube cria e confirma a sua; a revisão (estado) é do painel, pela ligação de migração.
GRANT SELECT, INSERT, UPDATE ON "ClubLogoProposal" TO academia_app;
REVOKE DELETE, TRUNCATE ON "ClubLogoProposal" FROM academia_app;
