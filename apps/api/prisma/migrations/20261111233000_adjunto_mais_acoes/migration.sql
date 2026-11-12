-- O Adjunto passa a inscrever atletas e a publicar comunicados.
--
-- Dois valores a mais no tipo das propostas. Só aditivo; a API antiga nunca
-- os escreve. `ADD VALUE` não corre dentro de uma transação: aplica-se à
-- parte, com `prisma db execute`.

ALTER TYPE "AdjuntoProposalKind" ADD VALUE IF NOT EXISTS 'ATHLETE';
ALTER TYPE "AdjuntoProposalKind" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT';
