-- Cargos por departamento, catálogos por desporto
--
-- Três mudanças que vêm do mesmo sítio: o convite de staff perguntava "acesso" e
-- "cargo" como se fossem coisas diferentes, e não são — "acesso Direção" e
-- "departamento Direção" são a mesma frase dita duas vezes. Ver
-- `docs/03-estado.md`.
--
-- 1. `AcademyRole.department` — um departamento tem vários cargos, um cargo
--    pertence a um departamento só. É o que deixa o convite perguntar primeiro o
--    departamento e só depois o cargo, em vez de uma lista onde
--    "Fisioterapeuta" aparece a par de "Treinador principal".
--
-- 2. `CatalogItem.sportId` — um clube com futebol e natação não tem os mesmos
--    escalões nem os mesmos balneários nas duas. Nulo é "todos os desportos", e
--    é o que todas as linhas existentes passam a ser: nenhum clube perde nada
--    por esta coluna nascer.
--
-- 3. `StaffInvite.academyRoleId` — o convite passa a carregar o cargo escolhido
--    em vez de um enum de permissões solto.

-- ---------------------------------------------------------------------------
-- 1. Cargos pertencem a um departamento
-- ---------------------------------------------------------------------------

ALTER TABLE "AcademyRole" ADD COLUMN "department" "StaffDepartment";

-- Os papéis já semeados ganham o departamento que sempre foi o deles na prática.
-- `presidente` fica a NULL de propósito: quem responde por tudo não pertence a
-- um departamento.
UPDATE "AcademyRole" SET "department" = 'DIRECTION'  WHERE "key" = 'direcao';
UPDATE "AcademyRole" SET "department" = 'TECHNICAL'  WHERE "key" = 'treinador';
UPDATE "AcademyRole" SET "department" = 'CLINICAL'   WHERE "key" = 'dep-medico';
UPDATE "AcademyRole" SET "department" = 'SCOUTING'   WHERE "key" = 'scouting';

-- ---------------------------------------------------------------------------
-- 2. Catálogos por desporto
-- ---------------------------------------------------------------------------

ALTER TABLE "CatalogItem" ADD COLUMN "sportId" TEXT;

ALTER TABLE "CatalogItem"
  ADD CONSTRAINT "CatalogItem_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CatalogItem_sportId_idx" ON "CatalogItem"("sportId");

-- A chave única passa a incluir o desporto: "Sub-13" pode existir no futebol
-- **e** na natação, e são dois itens diferentes. Sem isto, criar o segundo dava
-- erro de duplicado.
--
-- Uma nota sobre NULLs, para quem vier a ler isto a debugar um duplicado: no
-- Postgres, `UNIQUE` trata cada NULL como distinto, por isso esta chave **não**
-- impede dois "Campo 1" globais (`sportId IS NULL`). Um índice parcial fecharia
-- o caso, mas o Prisma não o sabe declarar e a cada `migrate dev` apareceria
-- como divergência. Fica fechado onde se consegue explicar melhor: em
-- `CatalogsService.create`, que já verifica duplicados antes de escrever.
DROP INDEX IF EXISTS "CatalogItem_academyId_kind_label_key";

CREATE UNIQUE INDEX "CatalogItem_academyId_kind_sportId_label_key"
  ON "CatalogItem"("academyId", "kind", "sportId", "label");

-- ---------------------------------------------------------------------------
-- 3. O convite carrega o cargo
-- ---------------------------------------------------------------------------

ALTER TABLE "StaffInvite" ADD COLUMN "academyRoleId" TEXT;

ALTER TABLE "StaffInvite"
  ADD CONSTRAINT "StaffInvite_academyRoleId_fkey"
  FOREIGN KEY ("academyRoleId") REFERENCES "AcademyRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. "Cargos da equipa técnica" deixa de ser um catálogo
-- ---------------------------------------------------------------------------
--
-- Era um catálogo de texto livre a par dos papéis, e a duplicação era o
-- problema: criava-se "Treinador principal" nos dois sítios e só um deles
-- decidia alguma coisa. O cargo passa a ser o `AcademyRole`, que é o que já
-- carrega as permissões.
--
-- Arquivar e não apagar, pela mesma razão de sempre: uma `Membership.title`
-- antiga guarda o texto, não uma referência, e um clube que tenha escrito
-- cargos à medida não os deve perder sem os ter lido.

UPDATE "CatalogItem"
  SET "archivedAt" = now()
  WHERE "kind" = 'staffTitles' AND "archivedAt" IS NULL;
