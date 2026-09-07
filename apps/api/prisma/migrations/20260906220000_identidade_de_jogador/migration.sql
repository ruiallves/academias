-- ---------------------------------------------------------------------------
-- Academias AI — a identidade de jogador, entre o track e o atleta.
--
-- Um jogo real de 111 minutos deu 733 tracks para 22 jogadores: cada oclusão,
-- saída de enquadramento ou salto da câmara abre um track novo. A revisão
-- contava tracks — e pedia ao treinador 150 confirmações de "Track 77" às
-- cegas, sem uma imagem, sem uma proposta. Ele pensa "este é o Rui", não "este
-- é o Track 77".
--
-- `PlayerIdentity` é o que ele vê e confirma: um grupo de tracks que a etapa de
-- identificação decidiu ser a mesma pessoa, com a proposta da IA (atleta +
-- confiança), o número de camisola lido, e o veredicto. Uma correção humana
-- aplica-se aqui e vale para todos os tracks do grupo. O track passa a apontar
-- para a identidade; continua a existir porque é o dado técnico — só deixa de
-- ser o que o utilizador vê.
-- ---------------------------------------------------------------------------

CREATE TABLE "PlayerIdentity" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "label" INTEGER NOT NULL,
    "athleteId" TEXT,
    "proposedAthleteId" TEXT,
    "proposedConfidence" DOUBLE PRECISION,
    "jerseyNumber" INTEGER,
    "jerseyConfidence" DOUBLE PRECISION,
    "side" TEXT NOT NULL DEFAULT 'unknown',
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "firstMs" INTEGER NOT NULL,
    "lastMs" INTEGER NOT NULL,
    "trackCount" INTEGER NOT NULL DEFAULT 0,
    "presenceMs" INTEGER NOT NULL DEFAULT 0,
    "embeddingKey" TEXT,
    "summary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerIdentity_pkey" PRIMARY KEY ("id")
);

-- `(analysisId, status)` e não `analysisId` só: a pergunta da revisão é
-- "quais desta análise ainda pedem um humano", e é essa que tem de ser barata.
CREATE INDEX "PlayerIdentity_analysisId_status_idx" ON "PlayerIdentity"("analysisId", "status");
CREATE INDEX "PlayerIdentity_athleteId_idx" ON "PlayerIdentity"("athleteId");
CREATE INDEX "PlayerIdentity_academyId_idx" ON "PlayerIdentity"("academyId");

ALTER TABLE "PlayerIdentity" ADD CONSTRAINT "PlayerIdentity_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlayerIdentity" ADD CONSTRAINT "PlayerIdentity_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Apagar um atleta anonimiza a identidade; apagar a análise é que a leva.
ALTER TABLE "PlayerIdentity" ADD CONSTRAINT "PlayerIdentity_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- O track aponta para a identidade. `SET NULL`: re-agrupar identidades (uma
-- nova passagem da etapa, uma correção que separa duas pessoas) não pode
-- apagar tracks — são o dado de origem.
ALTER TABLE "PlayerTrack" ADD COLUMN "identityId" TEXT;
CREATE INDEX "PlayerTrack_identityId_idx" ON "PlayerTrack"("identityId");
ALTER TABLE "PlayerTrack" ADD CONSTRAINT "PlayerTrack_identityId_fkey"
  FOREIGN KEY ("identityId") REFERENCES "PlayerIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS, como em todas as tabelas de tenant da AI: imagem de menores não
-- atravessa clubes por engano de filtro.
ALTER TABLE "PlayerIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlayerIdentity" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PlayerIdentity";
CREATE POLICY tenant_isolation ON "PlayerIdentity"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());
