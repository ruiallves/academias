-- Se uma competição é oficial.
--
-- Nos jogos de uma competição oficial a convocatória respeita a idade do
-- escalão; nas não oficiais (o "Amigável", e o que o clube marcar assim nas
-- Definições: torneios, convívios) chama-se de qualquer escalão. Até aqui a
-- regra ia pelo nome "Amigável"; passa a ser uma escolha do clube.
--
-- Só acrescenta uma coluna com valor por omissão: a API antiga não a lê.
-- Todas as competições nascem oficiais, menos o "Amigável" de cada clube.

ALTER TABLE "CatalogItem" ADD COLUMN "official" BOOLEAN NOT NULL DEFAULT true;

UPDATE "CatalogItem" SET "official" = false WHERE kind = 'competitions' AND label = 'Amigável';
