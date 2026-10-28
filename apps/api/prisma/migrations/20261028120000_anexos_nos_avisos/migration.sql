-- Os avisos do clube passam a levar anexos: PDF, fotografias, Word.
--
-- O clube mandava o regulamento do torneio ou a ficha de inscrição por WhatsApp,
-- porque o aviso na app só levava texto. Agora o ficheiro vai com o aviso, e
-- quem o recebe (pais, atletas, sócios, treinadores) abre-o na app.
--
-- Os ficheiros ficam no bucket `documentos`, em {academyId}/comunicacoes/, e por
-- isso contam no espaço do clube sem mexer em `app.storage_by_academy`.
--
-- Só acrescenta uma coluna com valor por omissão. Tem de correr ANTES do servidor
-- novo: o servidor lê `files` ao listar os avisos.

ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "files" JSONB NOT NULL DEFAULT '[]';
