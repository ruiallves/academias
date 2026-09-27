-- O número da camisola passa a ser por equipa.
--
-- Um atleta pode estar em várias equipas (futebol e futsal, por exemplo), e o
-- número de uma não é o da outra. `Athlete.squadNumber` fica, com o número da
-- equipa principal, para o código que ainda a lê.

ALTER TABLE "TeamMembership" ADD COLUMN "squadNumber" INTEGER;

-- Cada passagem viva herda o número que o atleta tinha.
UPDATE "TeamMembership" tm
SET "squadNumber" = a."squadNumber"
FROM "Athlete" a
WHERE tm."athleteId" = a.id
  AND tm."leftAt" IS NULL
  AND a."squadNumber" IS NOT NULL;
