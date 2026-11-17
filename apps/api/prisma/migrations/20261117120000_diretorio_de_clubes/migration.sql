-- O diretório dos clubes federados de Portugal, com o emblema (17/11/2026).
--
-- Uma tabela da plataforma, sem `academyId` e sem RLS: a lista é a mesma para
-- todos os clubes (o adversário de um jogo é um clube de Portugal, não um dado
-- do clube). Só o importador escreve (`scripts/emblemas-importar.mjs`, com a
-- ligação de migração); `academia_app` lê e mais nada. Os privilégios por
-- omissão do esquema dão tudo a `academia_app` numa tabela nova, daí o REVOKE.
--
-- Os emblemas ficam no bucket público `emblemas` (criado pelo importador),
-- tratados e com cache de um ano; ver `KnownClub` no schema.

CREATE TABLE IF NOT EXISTS "KnownClub" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "normalizedName" TEXT NOT NULL,
    "association" TEXT,
    "region" TEXT,
    "locality" TEXT,
    "sports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "fpfId" INTEGER,
    "fpbId" INTEGER,
    "sourceLogoUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "logoKey" TEXT,
    "logoVersion" INTEGER NOT NULL DEFAULT 0,
    "logoHash" TEXT,
    "logoWidth" INTEGER,
    "logoHeight" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnownClub_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "KnownClub_fpfId_key" ON "KnownClub"("fpfId");
CREATE UNIQUE INDEX IF NOT EXISTS "KnownClub_fpbId_key" ON "KnownClub"("fpbId");
CREATE INDEX IF NOT EXISTS "KnownClub_normalizedName_idx" ON "KnownClub"("normalizedName");
CREATE INDEX IF NOT EXISTS "KnownClub_region_idx" ON "KnownClub"("region");

GRANT SELECT ON "KnownClub" TO academia_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "KnownClub" FROM academia_app;
