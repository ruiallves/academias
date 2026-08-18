-- Convocar atletas de outro escalão
--
-- Joga-se para cima, nunca para baixo: um Sub-13 pode alinhar um miúdo de 11 anos,
-- o contrário é irregular em qualquer federação. `isGuest` marca esses casos —
-- é o que distingue, numa convocatória, quem é do plantel de quem subiu de
-- escalão para este jogo. A regra de quem é elegível fica no serviço
-- (`app/academy/matches.service.ts`, `ageGroupRank`): não é imposta aqui na base
-- porque depende do texto do escalão, que é livre de propósito — a academia
-- multi-desporto não tem uma única palavra de futebol no esquema.

ALTER TABLE "MatchCallUp" ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false;
