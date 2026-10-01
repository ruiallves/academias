-- Os objetivos do jogo, no plano: definem-se antes e avaliam-se na análise.
-- Só acrescenta uma coluna com valor por omissão.
ALTER TABLE "MatchPlan" ADD COLUMN "objectives" JSONB NOT NULL DEFAULT '[]';
