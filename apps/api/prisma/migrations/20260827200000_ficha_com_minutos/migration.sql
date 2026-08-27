-- A ficha de jogo ganha minutos.
--
-- A ficha registava quem jogou, quantos minutos ao todo, golos, assistências,
-- amarelos (0/1/2) e vermelho. Faltava **quando**: a que minuto entrou, a que
-- minuto saiu, a que minuto viu cada cartão.
--
-- É informação que o treinador nem sempre tem e quase nunca é obrigado a ter —
-- por isso tudo entra opcional. Quem só quer dizer "jogou 60 minutos" continua a
-- dizer isso e não vê nada disto; quem quer a ficha completa passa a poder.
--
-- Nada é preenchido retroactivamente: as fichas que já existem ficam com estes
-- campos vazios, que é a verdade sobre elas — ninguém registou os minutos.

ALTER TABLE "MatchAppearance"
  ADD COLUMN "onMinute"  INTEGER,
  ADD COLUMN "offMinute" INTEGER,
  -- `Int[]` do Prisma. `DEFAULT '{}'` e não nulo: uma lista vazia diz "sem
  -- amarelos registados" sem obrigar cada leitura a distinguir nulo de vazio.
  ADD COLUMN "yellowAt"  INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "redAt"     INTEGER;
