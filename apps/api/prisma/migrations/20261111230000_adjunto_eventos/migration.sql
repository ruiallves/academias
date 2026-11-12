-- O Adjunto passa a marcar e desmarcar treinos, jogos e eventos do calendário.
--
-- Um valor a mais no tipo das propostas: `EVENT`. Só aditivo; a API antiga
-- nunca o escreve. `ADD VALUE` não corre dentro de uma transação no Postgres:
-- aplica-se à parte, com `prisma db execute`.

ALTER TYPE "AdjuntoProposalKind" ADD VALUE IF NOT EXISTS 'EVENT';
