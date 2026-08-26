-- A equipa deixa de ter escalão. Passa a ter uma idade máxima.
--
-- O escalão e a equipa eram a mesma coisa dita duas vezes: toda a equipa se
-- chamava "Sub-11 Futebol" e tinha `ageGroup = 'Sub-11'` ao lado. Pior do que a
-- duplicação era o uso: a elegibilidade de convocatória lia um número de dentro
-- do texto ("Sub-13" → 13) e ficava muda para um clube que escrevesse
-- "Iniciados A". Agora é um inteiro, e a pergunta passa a ser sobre o atleta —
-- *tem idade para esta equipa?* — em vez de uma comparação entre equipas.
--
-- A conversão é feita aqui, com os dados na mão. Nada se perde por adivinhação:
-- o que não se conseguir ler fica em 99, que na prática é "sem limite de idade"
-- e é também a resposta certa para uma equipa de seniores.

ALTER TABLE "Team" ADD COLUMN "maxAge" INTEGER;

-- "Sub-11", "sub 11", "SUB-11 A" → 11. O `substring` com classe POSIX apanha o
-- primeiro grupo de dígitos a seguir a "sub"; o resto do texto é ignorado.
UPDATE "Team"
SET "maxAge" = CAST(substring("ageGroup" FROM '[0-9]+') AS INTEGER)
WHERE "ageGroup" ~* 'sub[[:space:]-]*[0-9]+';

-- Um escalão escrito só com números — "10-14 anos" — vale pelo maior, que é o
-- tecto da equipa. "10-14" dá 14.
-- `regexp_matches` devolve `text[]` e não `text` — daí o `m.n[1]`. Sem o índice,
-- o `CAST` rebenta com "cannot cast type text[] to integer" **a meio da
-- migração**, com a coluna nova já criada e a antiga ainda lá.
UPDATE "Team"
SET "maxAge" = (
  SELECT MAX(CAST(m.n[1] AS INTEGER))
  FROM regexp_matches("ageGroup", '[0-9]+', 'g') AS m(n)
)
WHERE "maxAge" IS NULL AND "ageGroup" ~ '[0-9]';

-- Seniores, "Iniciados A", e tudo o resto sem número: sem limite de idade.
UPDATE "Team" SET "maxAge" = 99 WHERE "maxAge" IS NULL;

-- Um tecto absurdo vindo de um texto estranho ("Sub-2015", alguém a escrever o
-- ano de nascimento) não pode passar a limite de idade real.
UPDATE "Team" SET "maxAge" = 99 WHERE "maxAge" < 4 OR "maxAge" > 99;

ALTER TABLE "Team" ALTER COLUMN "maxAge" SET NOT NULL;
ALTER TABLE "Team" DROP COLUMN "ageGroup";

-- O catálogo de escalões deixa de ter para onde apontar. As restantes espécies
-- (locais, balneários, tipos de evento) ficam.
DELETE FROM "CatalogItem" WHERE "kind" = 'ageGroups';
