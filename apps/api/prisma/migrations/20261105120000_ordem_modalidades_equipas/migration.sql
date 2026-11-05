-- A ordem das modalidades e das equipas.
--
-- O clube escolhe-a em Definições → Modalidades, com setas. A primeira
-- modalidade, e dentro dela a primeira equipa, é a que vem escolhida ao
-- inscrever um atleta, e é por esta ordem que as listas aparecem na consola.
--
--   1. `Sport.position` — a ordem das modalidades no clube.
--   2. `Team.position` — a ordem das equipas dentro da modalidade.
--
-- Ponto de partida: as modalidades por nome (era a ordem de até aqui) e as
-- equipas da mais nova para a mais velha (Sub-7, Sub-9, …, Seniores), e por
-- nome quando têm a mesma idade.
--
-- Toda aditiva: pode aplicar-se com a API antiga em serviço.

ALTER TABLE "Sport" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Team" ADD COLUMN "position" INTEGER NOT NULL DEFAULT 0;

UPDATE "Sport" s
   SET "position" = o.n
  FROM (
    SELECT id, (row_number() OVER (PARTITION BY "academyId" ORDER BY name, id) - 1)::int AS n
      FROM "Sport"
  ) o
 WHERE o.id = s.id;

UPDATE "Team" t
   SET "position" = o.n
  FROM (
    SELECT id, (row_number() OVER (PARTITION BY "sportId" ORDER BY "maxAge", name, id) - 1)::int AS n
      FROM "Team"
  ) o
 WHERE o.id = t.id;
