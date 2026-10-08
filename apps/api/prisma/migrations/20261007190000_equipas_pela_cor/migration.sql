-- ---------------------------------------------------------------------------
-- Academias AI — as equipas pela cor do equipamento.
--
-- O worker agrupa as pessoas seguidas pela cor do tronco em duas equipas e
-- "outros" (árbitro, guarda-redes). Qual é a nossa não se adivinha: o
-- treinador escolhe a cor no ecrã, e fica aqui. É o que transforma "A" e "B"
-- em "nossa" e "deles" nos tracks (`PlayerTrack.side`) e no vídeo a correr.
-- ---------------------------------------------------------------------------

ALTER TABLE "AIAnalysis" ADD COLUMN "oursKitColor" TEXT;
