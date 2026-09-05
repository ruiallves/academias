-- A Área técnica passa a viver dentro de cada modalidade.
--
-- ## O que muda
--
-- Até aqui a Área técnica era o produto de futebol da Academias: Exercícios,
-- Modelos de jogo e Bolas paradas eram três menus soltos, com vocabulário de
-- futebol, e nenhum dos três sabia a que modalidade pertencia. Um clube com
-- futebol e basquetebol teria uma biblioteca só, com os rondos ao lado dos
-- drills de lançamento.
--
-- Passa a haver **uma Área técnica por modalidade**: ⚽ Futebol com exercícios,
-- modelos de jogo e bolas paradas; 🏀 Basquetebol com exercícios, sistemas de
-- jogo e situações especiais. O que decide isto é a **disciplina** da
-- modalidade (`Sport.code`), e cada conteúdo técnico passa a dizer de que
-- modalidade é (`sportId`).
--
-- ## Quatro coisas, por ordem
--
--  1. As colunas e as tabelas novas — o DDL tal como o Prisma o gera.
--  2. `Sport.code` preenchido pelo nome que o clube escreveu, com o nome
--     normalizado onde era só uma variante de maiúsculas, e os campos vazios
--     (posições, lado dominante, duração) preenchidos pelo padrão da disciplina.
--  3. Os exercícios, modelos e bolas paradas que já existem ganham modalidade:
--     pela equipa quando há, senão pelo desenho, senão pela única modalidade do
--     clube. O que não se consegue atribuir com confiança fica **sem** — e é
--     adoptado pelo serviço no dia em que o clube criar a modalidade certa.
--  4. Os menus dos cargos: as três chaves antigas viram uma.

-- ---------------------------------------------------------------------------
-- 1. DDL
-- ---------------------------------------------------------------------------

ALTER TABLE "Sport" ADD COLUMN "code" TEXT;

ALTER TABLE "Exercise" ADD COLUMN "sportId" TEXT;

ALTER TABLE "GameModel" ADD COLUMN "kind" TEXT,
                        ADD COLUMN "sportId" TEXT;

ALTER TABLE "SetPiece" ADD COLUMN "gameModelId" TEXT,
                       ADD COLUMN "sportId" TEXT;

-- As ligações Sistema ↔ Exercícios e Situação ↔ Exercícios. Tabelas com chaves
-- estrangeiras e não arrays de ids: apagar o exercício tira a ligação sozinho,
-- e "em que sistemas entra este exercício?" responde-se com um índice.
CREATE TABLE "GameModelExercise" (
    "gameModelId" TEXT NOT NULL,
    "exerciseId"  TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameModelExercise_pkey" PRIMARY KEY ("gameModelId","exerciseId")
);

CREATE TABLE "SetPieceExercise" (
    "setPieceId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SetPieceExercise_pkey" PRIMARY KEY ("setPieceId","exerciseId")
);

CREATE INDEX "GameModelExercise_exerciseId_idx" ON "GameModelExercise"("exerciseId");
CREATE INDEX "SetPieceExercise_exerciseId_idx" ON "SetPieceExercise"("exerciseId");
CREATE INDEX "Exercise_academyId_sportId_idx" ON "Exercise"("academyId", "sportId");
CREATE INDEX "GameModel_academyId_sportId_idx" ON "GameModel"("academyId", "sportId");
CREATE INDEX "SetPiece_academyId_sportId_idx" ON "SetPiece"("academyId", "sportId");
CREATE INDEX "SetPiece_gameModelId_idx" ON "SetPiece"("gameModelId");

-- `SET NULL` na modalidade: apagar uma modalidade já recusa quando há equipas
-- ou prospectos (ver `removeSport`); se um dia passar, o conteúdo técnico fica
-- órfão em vez de desaparecer — um exercício sem modalidade recupera-se, um
-- apagado em cascata não.
ALTER TABLE "Exercise"  ADD CONSTRAINT "Exercise_sportId_fkey"  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GameModel" ADD CONSTRAINT "GameModel_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SetPiece"  ADD CONSTRAINT "SetPiece_sportId_fkey"  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SetPiece"  ADD CONSTRAINT "SetPiece_gameModelId_fkey" FOREIGN KEY ("gameModelId") REFERENCES "GameModel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GameModelExercise" ADD CONSTRAINT "GameModelExercise_gameModelId_fkey" FOREIGN KEY ("gameModelId") REFERENCES "GameModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GameModelExercise" ADD CONSTRAINT "GameModelExercise_exerciseId_fkey"  FOREIGN KEY ("exerciseId")  REFERENCES "Exercise"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetPieceExercise"  ADD CONSTRAINT "SetPieceExercise_setPieceId_fkey"   FOREIGN KEY ("setPieceId")  REFERENCES "SetPiece"("id")  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SetPieceExercise"  ADD CONSTRAINT "SetPieceExercise_exerciseId_fkey"   FOREIGN KEY ("exerciseId")  REFERENCES "Exercise"("id")  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS pela relação, como `ExerciseFavorite`: as tabelas de ligação não têm
-- `academyId`, e o isolamento chega-lhes pelo pai.
ALTER TABLE "GameModelExercise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GameModelExercise" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GameModelExercise";
CREATE POLICY tenant_isolation ON "GameModelExercise"
  USING (EXISTS (SELECT 1 FROM "GameModel" g WHERE g."id" = "gameModelId" AND g."academyId" = app.current_academy_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "GameModel" g WHERE g."id" = "gameModelId" AND g."academyId" = app.current_academy_id()));

ALTER TABLE "SetPieceExercise" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SetPieceExercise" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SetPieceExercise";
CREATE POLICY tenant_isolation ON "SetPieceExercise"
  USING (EXISTS (SELECT 1 FROM "SetPiece" s WHERE s."id" = "setPieceId" AND s."academyId" = app.current_academy_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM "SetPiece" s WHERE s."id" = "setPieceId" AND s."academyId" = app.current_academy_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON "GameModelExercise", "SetPieceExercise" TO academia_app;

-- ---------------------------------------------------------------------------
-- 2. A disciplina de cada modalidade
-- ---------------------------------------------------------------------------

-- Pelo nome que o clube escreveu. Futsal antes de futebol de propósito:
-- "futebol de salão" é futsal, e a ordem inversa fazia dele futebol.
UPDATE "Sport"
   SET "code" = CASE
         WHEN name ILIKE '%futsal%' OR name ILIKE '%salão%' OR name ILIKE '%salao%' THEN 'futsal'
         WHEN name ILIKE '%futebol%' OR name ILIKE '%football%' OR name ILIKE '%soccer%'  THEN 'football'
         WHEN name ILIKE '%basquet%' OR name ILIKE '%basket%'                             THEN 'basketball'
         ELSE NULL
       END
 WHERE "code" IS NULL;

-- O nome normaliza-se só quando era uma variante de maiúsculas ou espaços da
-- forma canónica ("futebol" → "Futebol"). "Futebol feminino" fica como está —
-- é um nome, não um erro. E nunca por cima de outra modalidade do mesmo clube
-- que já se chame assim: (academyId, name) é único.
UPDATE "Sport" s
   SET name = c.canon
  FROM (VALUES ('football', 'Futebol'), ('futsal', 'Futsal'), ('basketball', 'Basquetebol')) AS c(code, canon)
 WHERE s."code" = c.code
   AND lower(btrim(s.name)) = lower(c.canon)
   AND s.name <> c.canon
   AND NOT EXISTS (SELECT 1 FROM "Sport" o WHERE o."academyId" = s."academyId" AND o.name = c.canon AND o.id <> s.id);

-- Os campos vazios recebem o padrão da disciplina. Só os vazios: o que o clube
-- já escreveu é decisão dele.
UPDATE "Sport"
   SET positions = CASE "code"
         WHEN 'football'   THEN ARRAY['Guarda-redes', 'Defesa central', 'Lateral', 'Médio defensivo', 'Médio centro', 'Médio ofensivo', 'Extremo', 'Avançado']
         WHEN 'futsal'     THEN ARRAY['Guarda-redes', 'Fixo', 'Ala', 'Pivô', 'Universal']
         WHEN 'basketball' THEN ARRAY['Base', 'Extremo', 'Ala', 'Ala-poste', 'Poste']
       END
 WHERE "code" IN ('football', 'futsal', 'basketball')
   AND cardinality(positions) = 0;

UPDATE "Sport"
   SET skills = CASE "code"
         WHEN 'basketball' THEN ARRAY['Técnica individual', 'Lançamento', 'Leitura de jogo', 'Defesa', 'Físico', 'Atitude']
         ELSE ARRAY['Técnica', 'Táctica', 'Físico', 'Atitude']
       END
 WHERE "code" IN ('football', 'futsal', 'basketball')
   AND cardinality(skills) = 0;

UPDATE "Sport"
   SET "dominantSideLabel" = CASE "code" WHEN 'basketball' THEN 'Mão dominante' ELSE 'Pé dominante' END
 WHERE "code" IN ('football', 'futsal', 'basketball')
   AND ("dominantSideLabel" IS NULL OR btrim("dominantSideLabel") = '');

UPDATE "Sport"
   SET "matchMinutes" = CASE "code" WHEN 'football' THEN 90 ELSE 40 END
 WHERE "code" IN ('football', 'futsal', 'basketball')
   AND "matchMinutes" IS NULL;

-- ---------------------------------------------------------------------------
-- 3. O conteúdo que já existe ganha modalidade
-- ---------------------------------------------------------------------------

-- 3a. Pela equipa, quando há. Um modelo de jogo do Sub-13 de futsal é de futsal.
UPDATE "GameModel" g
   SET "sportId" = t."sportId"
  FROM "Team" t
 WHERE t.id = g."teamId" AND g."sportId" IS NULL;

UPDATE "SetPiece" p
   SET "sportId" = t."sportId"
  FROM "Team" t
 WHERE t.id = p."teamId" AND p."sportId" IS NULL;

-- Os exercícios não têm equipa, mas os treinos onde entraram têm: um exercício
-- usado em sessões do Sub-11 de futebol é de futebol. Com empate, a equipa que
-- o usou mais vezes.
WITH uso AS (
  SELECT b."exerciseId", t."sportId", count(*) AS n,
         row_number() OVER (PARTITION BY b."exerciseId" ORDER BY count(*) DESC, t."sportId") AS rn
    FROM "SessionBlock" b
    JOIN "TrainingSession" s ON s.id = b."sessionId"
    JOIN "Team" t ON t.id = s."teamId"
   WHERE b."exerciseId" IS NOT NULL
   GROUP BY b."exerciseId", t."sportId"
)
UPDATE "Exercise" e
   SET "sportId" = uso."sportId"
  FROM uso
 WHERE uso."exerciseId" = e.id AND uso.rn = 1 AND e."sportId" IS NULL;

-- 3b. Pelo desenho. O terreno do diagrama diz a disciplina: `futsal`/`futsal-half`
-- é futsal, qualquer campo de relva (f11/f9/f7/f5, ou os nomes antigos full/half)
-- é futebol. Atribui-se à modalidade do clube com essa disciplina, se existir.
-- Um clube só de futsal não recebe os rondos de campo de onze na sua área — e
-- um clube de basquetebol muito menos.
UPDATE "Exercise" e
   SET "sportId" = s.id
  FROM "Sport" s
 WHERE s."academyId" = e."academyId"
   AND e."sportId" IS NULL
   AND s."code" = CASE
         WHEN e.diagram->>'field' ILIKE 'futsal%' THEN 'futsal'
         WHEN e.diagram->>'field' ILIKE 'basket%' THEN 'basketball'
         WHEN e.diagram->>'field' IS NOT NULL     THEN 'football'
       END;

UPDATE "GameModel" g
   SET "sportId" = s.id
  FROM "Sport" s
 WHERE s."academyId" = g."academyId"
   AND g."sportId" IS NULL
   AND s."code" = CASE
         WHEN g.lineup->>'pitch' ILIKE 'futsal%' THEN 'futsal'
         WHEN g.lineup->>'pitch' ILIKE 'basket%' THEN 'basketball'
         ELSE 'football'
       END;

UPDATE "SetPiece" p
   SET "sportId" = s.id
  FROM "Sport" s
 WHERE s."academyId" = p."academyId"
   AND p."sportId" IS NULL
   AND s."code" = CASE
         WHEN p.diagram->>'field' ILIKE 'futsal%' THEN 'futsal'
         WHEN p.diagram->>'field' ILIKE 'basket%' THEN 'basketball'
         ELSE 'football'
       END;

-- 3c. O que sobra e é **trabalho de alguém** (tem autor) não pode desaparecer:
-- vai para a modalidade com área técnica que o clube tem — a que tem mais
-- equipas, que é onde a pessoa trabalha. Um exercício escrito sem desenho num
-- clube só de futsal é de futsal.
--
-- A biblioteca base sem correspondência (os rondos de relva num clube só de
-- futsal) fica sem modalidade de propósito: não é de ninguém, não foi usada, e
-- reaparece sozinha no dia em que o clube criar a modalidade certa.
WITH principal AS (
  SELECT s."academyId", s.id AS "sportId",
         row_number() OVER (PARTITION BY s."academyId" ORDER BY (SELECT count(*) FROM "Team" t WHERE t."sportId" = s.id) DESC, s.name) AS rn
    FROM "Sport" s
   WHERE s."code" IS NOT NULL
)
UPDATE "Exercise" e
   SET "sportId" = principal."sportId"
  FROM principal
 WHERE principal."academyId" = e."academyId" AND principal.rn = 1
   AND e."sportId" IS NULL
   AND e."createdById" IS NOT NULL;

WITH principal AS (
  SELECT s."academyId", s.id AS "sportId",
         row_number() OVER (PARTITION BY s."academyId" ORDER BY (SELECT count(*) FROM "Team" t WHERE t."sportId" = s.id) DESC, s.name) AS rn
    FROM "Sport" s
   WHERE s."code" IS NOT NULL
)
UPDATE "GameModel" g
   SET "sportId" = principal."sportId"
  FROM principal
 WHERE principal."academyId" = g."academyId" AND principal.rn = 1
   AND g."sportId" IS NULL;

WITH principal AS (
  SELECT s."academyId", s.id AS "sportId",
         row_number() OVER (PARTITION BY s."academyId" ORDER BY (SELECT count(*) FROM "Team" t WHERE t."sportId" = s.id) DESC, s.name) AS rn
    FROM "Sport" s
   WHERE s."code" IS NOT NULL
)
UPDATE "SetPiece" p
   SET "sportId" = principal."sportId"
  FROM principal
 WHERE principal."academyId" = p."academyId" AND principal.rn = 1
   AND p."sportId" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Os menus dos cargos
-- ---------------------------------------------------------------------------

-- "Exercícios", "Modelos de jogo" e "Bolas paradas" deixam de ser itens do
-- menu: passam a viver dentro de cada modalidade, e o item que os representa
-- chama-se `sports`. Um cargo que mostrava qualquer um dos três mostra agora
-- as modalidades; um cargo que os escondia aos três continua a escondê-las.
-- A ordem do array não importa — o cliente ordena pelo catálogo.
UPDATE "AcademyRole"
   SET "navKeys" = ARRAY(
         SELECT DISTINCT k
           FROM unnest(array_replace(array_replace(array_replace("navKeys", 'exercises', 'sports'), 'game-models', 'sports'), 'set-pieces', 'sports')) AS k
       ),
       "updatedAt" = now()
 WHERE "navKeys" && ARRAY['exercises', 'game-models', 'set-pieces'];

UPDATE "Department"
   SET "navKeys" = ARRAY(
         SELECT DISTINCT k
           FROM unnest(array_replace(array_replace(array_replace("navKeys", 'exercises', 'sports'), 'game-models', 'sports'), 'set-pieces', 'sports')) AS k
       ),
       "updatedAt" = now()
 WHERE "navKeys" && ARRAY['exercises', 'game-models', 'set-pieces'];
