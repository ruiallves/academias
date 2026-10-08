-- ---------------------------------------------------------------------------
-- Academias AI — a calibração do campo.
--
-- O treinador clica 4 a 6 pontos conhecidos do campo num frame do vídeo
-- (cantos, grande área, meio-campo). Daí sai a homografia imagem → campo em
-- metros, que o worker arrasta com a compensação de câmara. É o que diz o que
-- está dentro das linhas (pessoas, bolas) e permite os padrões em metros.
-- ---------------------------------------------------------------------------

ALTER TABLE "AIAnalysis" ADD COLUMN "calibration" JSONB;
