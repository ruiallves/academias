-- A federação passa para cada modalidade, e o atleta ganha o que o boletim
-- da FPB pede. Só colunas novas, todas opcionais; nada se apaga.

ALTER TABLE "Sport" ADD COLUMN "federationClubCode" TEXT;
ALTER TABLE "Sport" ADD COLUMN "association" TEXT;
ALTER TABLE "Sport" ADD COLUMN "insuranceKind" TEXT;
ALTER TABLE "Sport" ADD COLUMN "insurancePolicy" TEXT;
ALTER TABLE "Sport" ADD COLUMN "insuranceCompany" TEXT;

ALTER TABLE "Athlete" ADD COLUMN "idDocValidUntil" DATE;
ALTER TABLE "Athlete" ADD COLUMN "district" TEXT;
ALTER TABLE "Athlete" ADD COLUMN "municipality" TEXT;

-- O que o clube já escreveu em Definições → Geral vai para as modalidades de
-- futebol e de futsal (pelo código, ou pelo nome nas que não o têm). As
-- colunas da academia ficam, sem uso, até a API antiga sair de produção.
UPDATE "Sport" s
   SET "federationClubCode" = a."fpfClubCode",
       "association" = a."footballAssociation"
  FROM "Academy" a
 WHERE s."academyId" = a."id"
   AND (a."fpfClubCode" IS NOT NULL OR a."footballAssociation" IS NOT NULL)
   AND (
     s."code" IN ('football', 'futsal')
     OR (s."code" IS NULL AND (s."name" ILIKE '%futebol%' OR s."name" ILIKE '%futsal%' OR s."name" ILIKE '%sal_o%'))
   );
