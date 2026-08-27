-- Os minutos dos golos e das assistências.
--
-- Gémeos de `yellowAt`: opcionais, e a contagem (`tally`, `assists`) continua a
-- ser o que vale nas somas. Quem só quer dizer "marcou dois" continua a dizer
-- isso; quem quer a acta ao minuto passa a ter onde a escrever.

ALTER TABLE "MatchAppearance"
  ADD COLUMN "tallyAt"   INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "assistsAt" INTEGER[] NOT NULL DEFAULT '{}';
