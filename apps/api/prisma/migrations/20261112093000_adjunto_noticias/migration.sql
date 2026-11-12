-- O Adjunto passa a publicar notícias no site do clube.
--
-- Um valor a mais no tipo das propostas. Só aditivo; aplica-se à parte com
-- `prisma db execute` e marca-se com `prisma migrate resolve --applied`.

ALTER TYPE "AdjuntoProposalKind" ADD VALUE IF NOT EXISTS 'SITE_NEWS';
