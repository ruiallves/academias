-- Um jogo cancelado deixa de ocupar o horário.
--
-- `@@unique([teamId, startsAt])` impedia a mesma equipa de ter dois jogos à mesma
-- hora — o que está certo enquanto os dois estiverem de pé. Mas apanhava também os
-- **cancelados**: cancelar um jogo e tentar marcar outro adversário para a mesma
-- hora dava "esta equipa já tem um jogo marcado", sem que houvesse nenhum. Um jogo
-- desmarcado não ocupa o campo.
--
-- Fica um índice único **parcial**, que o Prisma não sabe exprimir no schema (não
-- há `@@unique` condicional) — daí viver aqui, em SQL, como as políticas de RLS.
-- O `@@index` equivalente continua declarado no schema para as leituras.

DROP INDEX IF EXISTS "Match_teamId_startsAt_key";

CREATE UNIQUE INDEX "Match_teamId_startsAt_active_key"
  ON "Match" ("teamId", "startsAt")
  WHERE status <> 'CANCELLED';
