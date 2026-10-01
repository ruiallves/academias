-- O plano de jogo: o onze no campo, o banco e os capitães.
--
-- Um por jogo (`matchId` único), como `MatchReport`. Sem `academyId`: chega
-- ao seu por `Match`, e a política RLS vai buscá-lo lá. Só acrescenta uma
-- tabela; não toca em nada do que existe.

CREATE TABLE "MatchPlan" (
  "id"            TEXT NOT NULL,
  "matchId"       TEXT NOT NULL,
  "authorId"      TEXT,
  "pitch"         TEXT NOT NULL,
  "system"        TEXT,
  "gameModelId"   TEXT,
  "slots"         JSONB NOT NULL DEFAULT '[]',
  "bench"         TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "captainId"     TEXT,
  "viceCaptainId" TEXT,
  "notes"         TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchPlan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchPlan_matchId_key" ON "MatchPlan"("matchId");

ALTER TABLE "MatchPlan"
  ADD CONSTRAINT "MatchPlan_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MatchPlan"
  ADD CONSTRAINT "MatchPlan_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS — o mesmo padrão de `MatchReport`: a academia lê-se pelo jogo.
ALTER TABLE "MatchPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchPlan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MatchPlan";
CREATE POLICY tenant_isolation ON "MatchPlan"
  USING (EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."id" = "MatchPlan"."matchId" AND m."academyId" = app.current_academy_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."id" = "MatchPlan"."matchId" AND m."academyId" = app.current_academy_id()
  ));
GRANT SELECT, INSERT, UPDATE, DELETE ON "MatchPlan" TO academia_app;
