-- O Adjunto passa a planear treinos (sessão, blocos e exercícios novos com desenho).
--
-- Um valor a mais no tipo das propostas. Só aditivo; a API antiga nunca o
-- escreve. `ADD VALUE` não corre dentro de uma transação: aplica-se à parte,
-- com `prisma db execute`, e marca-se com `prisma migrate resolve --applied`.

ALTER TYPE "AdjuntoProposalKind" ADD VALUE IF NOT EXISTS 'TRAINING_PLAN';
