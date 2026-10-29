-- Os minutos de cada parte, por equipa.
--
-- As partes do jogo eram sempre iguais (a duração dividida pelas partes). Nos
-- infantis, benjamins e traquinas de futebol de 2026/27 a última parte é maior
-- (15 + 15 + 40, 15 + 15 + 35, 15 + 15 + 30).
--
-- Vazio = partes iguais: nenhuma equipa muda sem alguém escolher. Aditiva: a
-- API em produção não lê a coluna.

ALTER TABLE "Team" ADD COLUMN "matchPartMinutes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "Team"
  ADD CONSTRAINT "Team_matchPartMinutes_check"
  CHECK (cardinality("matchPartMinutes") <= 8 AND 0 < ALL ("matchPartMinutes") AND 120 >= ALL ("matchPartMinutes"));
