-- As competições que cada equipa disputa, e a prova de cada jogo.
--
-- ## Porquê no catálogo e não numa tabela própria
--
-- Porque é exactamente o que os catálogos são: uma lista de nomes que o clube
-- gere (criar, renomear, arquivar, reordenar), por modalidade. "Campeonato
-- Distrital Sub-13" é da mesma família de `venues` e `eventTypes`, e uma tabela
-- nova traria de volta os quatro ecrãs de gestão que já existem.
--
-- ## O que isto substitui
--
-- A folha de convocatória já tinha um campo "competição" — escrito à mão a cada
-- exportação e lembrado no `localStorage` do browser de quem exporta. Ou seja:
-- cada treinador tinha a sua versão do nome da prova, e mudar de computador
-- perdia-a. Passa a vir do jogo, que a herda da equipa.

CREATE TABLE "TeamCompetition" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,

    CONSTRAINT "TeamCompetition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TeamCompetition_teamId_competitionId_key" ON "TeamCompetition"("teamId", "competitionId");
CREATE INDEX "TeamCompetition_competitionId_idx" ON "TeamCompetition"("competitionId");

ALTER TABLE "TeamCompetition" ADD CONSTRAINT "TeamCompetition_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Apagar uma prova do catálogo desfaz as ligações; não deixa equipas a apontar
-- para nada, que é o dado órfão que uma lista de texto produziria.
ALTER TABLE "TeamCompetition" ADD CONSTRAINT "TeamCompetition_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Opcional: um amigável não pertence a prova nenhuma, e obrigar a escolher uma
-- faria os clubes inventarem "Amigáveis" como se fosse um campeonato.
ALTER TABLE "Match" ADD COLUMN "competitionId" TEXT;
-- `SET NULL` e não cascata: apagar a prova do catálogo não pode apagar os jogos
-- que se disputaram nela — o resultado aconteceu.
ALTER TABLE "Match" ADD CONSTRAINT "Match_competitionId_fkey"
  FOREIGN KEY ("competitionId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Match_competitionId_idx" ON "Match"("competitionId");

-- A mesma política de isolamento das outras tabelas de domínio. `TeamCompetition`
-- não tem `academyId` — chega-lhe pela equipa, como em `TeamStaff`.
ALTER TABLE "TeamCompetition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TeamCompetition" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TeamCompetition";
CREATE POLICY tenant_isolation ON "TeamCompetition"
  USING (EXISTS (SELECT 1 FROM "Team" t WHERE t."id" = "teamId" AND t."academyId" = app.current_academy_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "Team" t WHERE t."id" = "teamId" AND t."academyId" = app.current_academy_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "TeamCompetition" TO academia_app;
