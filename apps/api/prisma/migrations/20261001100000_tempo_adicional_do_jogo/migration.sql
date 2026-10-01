-- O tempo adicional de um jogo, por parte.
--
-- Uma lista de minutos, um por parte: `{2,5}` é +2 na primeira e +5 na segunda.
-- Vazia quando ninguém o registou, e sempre vazia nas modalidades de cronómetro
-- parado (futsal, basquetebol), onde não há compensação. Quantas partes tem um
-- jogo é da modalidade; aqui só se guardam os minutos.
ALTER TABLE "Match" ADD COLUMN "addedMinutes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
