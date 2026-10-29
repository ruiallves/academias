-- Partes do jogo por equipa.
--
-- Até aqui o número de partes era da modalidade (2 no futebol e no futsal, 4
-- no basquetebol). Desde 2026/27 os infantis, benjamins e traquinas de futebol
-- jogam três partes, por isso passa a ser da equipa, como a duração.
--
-- Nulo = as da modalidade: nenhuma equipa muda sem alguém escolher. Aditiva:
-- a API em produção não lê a coluna.

ALTER TABLE "Team" ADD COLUMN "matchParts" INTEGER;

ALTER TABLE "Team"
  ADD CONSTRAINT "Team_matchParts_check" CHECK ("matchParts" IS NULL OR "matchParts" BETWEEN 1 AND 8);
