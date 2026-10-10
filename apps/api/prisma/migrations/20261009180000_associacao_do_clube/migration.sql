-- A associação distrital passa da modalidade para o clube: é a mesma em todas
-- (AF Braga no futebol, AB Braga no basquetebol). Uma coluna nova, opcional.

ALTER TABLE "Academy" ADD COLUMN "association" TEXT;

-- O que o clube já escreveu: a da modalidade de futebol primeiro, depois a de
-- qualquer outra, por fim a do Geral antigo. As colunas antigas ficam, sem uso.
UPDATE "Academy" a
   SET "association" = COALESCE(
     (SELECT s."association" FROM "Sport" s
       WHERE s."academyId" = a."id" AND s."association" IS NOT NULL
       ORDER BY (s."code" = 'football') DESC NULLS LAST, s."name"
       LIMIT 1),
     a."footballAssociation"
   )
 WHERE a."association" IS NULL;
