-- O vídeo de um jogo deixa de ficar guardado no Supabase.
--
-- Vai direito ao worker, em blocos, e vive no disco dele só durante o
-- processamento. Duas colunas novas dizem isso: `holder` é o worker que tem o
-- ficheiro (e o único que pode reclamar os jobs desta análise), `purgedAt` é a
-- hora a que o ficheiro foi apagado. Um vídeo com `holder` nulo e `storageKey`
-- é o caminho antigo, pelo Storage — continua a funcionar.

ALTER TABLE "AIVideo" ADD COLUMN "holder" TEXT;
ALTER TABLE "AIVideo" ADD COLUMN "purgedAt" TIMESTAMP(3);

-- O estado "já não há ficheiro": os dados ficam, o vídeo não. Partilhado com
-- o vídeo de scouting, que ainda não o usa.
ALTER TYPE "VideoStatus" ADD VALUE IF NOT EXISTS 'PURGED';
