-- A duração do jogo passa para a equipa, e o jogo ganha dois relatórios.
--
-- ## A duração é do escalão
--
-- `Sport.matchMinutes` dizia que o futebol dura 90. Um Sub-11 joga 60, um
-- Sub-13 joga 70, e os minutos de quem jogou até ao fim eram calculados com 90
-- em todos. A coluna passa para `Team`, que é onde já vivia `maxCallUps` pela
-- mesma razão. As equipas que existem herdam o valor da modalidade, para que
-- nenhuma ficha mude de resultado só por causa desta migração; a coluna da
-- modalidade fica como ponto de partida das equipas novas.
--
-- ## Dois relatórios por jogo
--
-- `MatchReport` é o relatório do treinador sobre o jogo; `OpponentReport` é o
-- que se viu do adversário. Um de cada por jogo (`matchId` único): são
-- documentos que se corrigem, não diários. Nenhum tem `academyId` — chegam ao
-- seu por `Match`, como `MatchStaff`, e a política RLS vai buscá-lo lá.

ALTER TABLE "Team" ADD COLUMN "matchMinutes" INTEGER;

UPDATE "Team" t SET "matchMinutes" = s."matchMinutes"
FROM "Sport" s
WHERE s."id" = t."sportId" AND s."matchMinutes" IS NOT NULL;

CREATE TABLE "MatchReport" (
  "id"           TEXT NOT NULL,
  "matchId"      TEXT NOT NULL,
  "authorId"     TEXT,
  "summary"      TEXT,
  "positives"    TEXT,
  "negatives"    TEXT,
  "toImprove"    TEXT,
  "difficulties" TEXT,
  "videos"       JSONB NOT NULL DEFAULT '[]',
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatchReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchReport_matchId_key" ON "MatchReport"("matchId");

ALTER TABLE "MatchReport"
  ADD CONSTRAINT "MatchReport_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MatchReport"
  ADD CONSTRAINT "MatchReport_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "OpponentReport" (
  "id"         TEXT NOT NULL,
  "matchId"    TEXT NOT NULL,
  "authorId"   TEXT,
  "formation"  TEXT,
  "style"      TEXT,
  "strengths"  TEXT,
  "weaknesses" TEXT,
  "keyPlayers" TEXT,
  "setPieces"  TEXT,
  "notes"      TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OpponentReport_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpponentReport_matchId_key" ON "OpponentReport"("matchId");

ALTER TABLE "OpponentReport"
  ADD CONSTRAINT "OpponentReport_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpponentReport"
  ADD CONSTRAINT "OpponentReport_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS — o mesmo padrão de `MatchStaff`: a academia lê-se pelo jogo.

ALTER TABLE "MatchReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchReport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MatchReport";
CREATE POLICY tenant_isolation ON "MatchReport"
  USING (EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."id" = "MatchReport"."matchId" AND m."academyId" = app.current_academy_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."id" = "MatchReport"."matchId" AND m."academyId" = app.current_academy_id()
  ));
GRANT SELECT, INSERT, UPDATE, DELETE ON "MatchReport" TO academia_app;

ALTER TABLE "OpponentReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OpponentReport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "OpponentReport";
CREATE POLICY tenant_isolation ON "OpponentReport"
  USING (EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."id" = "OpponentReport"."matchId" AND m."academyId" = app.current_academy_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."id" = "OpponentReport"."matchId" AND m."academyId" = app.current_academy_id()
  ));
GRANT SELECT, INSERT, UPDATE, DELETE ON "OpponentReport" TO academia_app;
