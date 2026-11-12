-- O assistente passa a criar um exercício sozinho na biblioteca da Área
-- técnica (com o desenho), sem o pôr num treino.
--
-- Um valor a mais no tipo das propostas. Só aditivo; aplica-se à parte com
-- `prisma db execute --schema prisma/schema.prisma --file …` e marca-se com
-- `prisma migrate resolve --applied`.

ALTER TYPE "AdjuntoProposalKind" ADD VALUE IF NOT EXISTS 'EXERCISE';
