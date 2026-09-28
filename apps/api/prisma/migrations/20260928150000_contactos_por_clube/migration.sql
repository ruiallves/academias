-- Contactos passam a ser clubes.
--
-- O objetivo da lista é saber que clubes já contactámos: se mandámos email, se
-- ligámos, se responderam e o quê. O nome do contacto passa a ser o do clube; a
-- pessoa com quem se falou, quando se sabe, fica em "personName".
--
-- Só acrescenta colunas: a versão em produção continua a funcionar até ao deploy
-- (lê "club" e "name" como antes; "club" deixa de ser usado pela versão nova).

ALTER TABLE "Contact"
  ADD COLUMN "sport"       TEXT NOT NULL DEFAULT 'Futebol',
  ADD COLUMN "association" TEXT,
  ADD COLUMN "personName"  TEXT,
  ADD COLUMN "emailedAt"   TIMESTAMP(3),
  ADD COLUMN "calledAt"    TIMESTAMP(3),
  ADD COLUMN "replyNote"   TEXT;

-- O clube passa a ser o nome; a pessoa fica guardada à parte.
UPDATE "Contact"
SET "personName" = "name",
    "name" = btrim("club")
WHERE "club" IS NOT NULL AND btrim("club") NOT IN ('', '?');

-- O que já estava registado no histórico conta como email enviado / chamada feita.
UPDATE "Contact" c
SET "calledAt" = t.quando
FROM (SELECT "contactId", max("happenedAt") AS quando FROM "ContactTouch" WHERE channel = 'CHAMADA' GROUP BY 1) t
WHERE t."contactId" = c.id;

UPDATE "Contact" c
SET "emailedAt" = t.quando
FROM (SELECT "contactId", max("happenedAt") AS quando FROM "ContactTouch" WHERE channel = 'EMAIL' GROUP BY 1) t
WHERE t."contactId" = c.id;

CREATE INDEX "Contact_sport_association_idx" ON "Contact"("sport", "association");
