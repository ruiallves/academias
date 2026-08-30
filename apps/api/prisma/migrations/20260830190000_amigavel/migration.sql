-- "Amigável" em cada academia, e em cada equipa que já existe.
--
-- ## Porque é que isto tem de ser uma migração
--
-- Porque a competição passou a ser **obrigatória** ao marcar um jogo, e sem
-- esta linha todos os clubes que já cá estão ficavam bloqueados: equipas sem
-- competição nenhuma, e uma pergunta obrigatória sem resposta possível. Uma
-- funcionalidade nova que trava o trabalho de quem já usa o produto não é uma
-- funcionalidade nova, é uma avaria.
--
-- ## O que faz
--
-- 1. Cria a prova "Amigável" em cada academia que ainda não a tenha, marcada
--    como `isSystem` — não se apaga nem se renomeia, porque é a rede que
--    garante que há sempre uma competição para escolher.
-- 2. Liga-a a **todas** as equipas existentes. As equipas novas recebem-na na
--    criação (ver `createTeam`).
--
-- Os jogos já marcados ficam sem competição, e é o correcto: inventar-lhes uma
-- prova seria escrever no registo do clube um facto que ninguém afirmou. A
-- folha de convocatória continua a deixar escrevê-la à mão para esses.

INSERT INTO "CatalogItem" ("id", "academyId", "kind", "label", "isSystem", "order", "createdAt", "updatedAt")
SELECT
  'amig_' || substr(md5(a.id || 'amigavel'), 1, 20),
  a.id,
  'competitions',
  'Amigável',
  true,
  0,
  now(),
  now()
FROM "Academy" a
WHERE NOT EXISTS (
  SELECT 1 FROM "CatalogItem" c
   WHERE c."academyId" = a.id AND c."kind" = 'competitions' AND c."label" = 'Amigável'
);

INSERT INTO "TeamCompetition" ("id", "teamId", "competitionId")
SELECT
  'tc_' || substr(md5(t.id || c.id), 1, 22),
  t.id,
  c.id
FROM "Team" t
JOIN "CatalogItem" c
  ON c."academyId" = t."academyId" AND c."kind" = 'competitions' AND c."label" = 'Amigável'
WHERE NOT EXISTS (
  SELECT 1 FROM "TeamCompetition" tc WHERE tc."teamId" = t.id AND tc."competitionId" = c.id
);
