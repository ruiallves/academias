-- O Adjunto passa a mexer no site do clube: página de início, layout, loja,
-- patrocinadores e bilheteira.
--
-- Um valor a mais no tipo das propostas. Só aditivo; aplica-se à parte com
-- `prisma db execute --schema prisma/schema.prisma --file …` e marca-se com
-- `prisma migrate resolve --applied`.

ALTER TYPE "AdjuntoProposalKind" ADD VALUE IF NOT EXISTS 'SITE';
