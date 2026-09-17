-- ---------------------------------------------------------------------------
-- O aviso de uma consulta marcada
-- ---------------------------------------------------------------------------
--
-- Agendar uma consulta (nutrição, psicologia, fisioterapia, exame) passou a
-- avisar a família e o atleta, e a aparecer na app. É um tipo próprio e não um
-- `ANNOUNCEMENT_PUBLISHED`: tem data, hora e sítio, e quem o recebe tem de
-- estar lá — o que muda o ícone, a ordem e o ecrã onde o toque aterra.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CLINICAL_APPOINTMENT';
