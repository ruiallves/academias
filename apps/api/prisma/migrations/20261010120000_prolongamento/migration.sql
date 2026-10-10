-- O prolongamento de um jogo, por parte.
--
-- Uma lista de minutos, um por parte do prolongamento: `{15,15}` no futebol,
-- `{5}` ou `{5,5}` no basquetebol. Vazia quando não houve. Os minutos de quem
-- jogou contam com ela: quem jogou tudo num 90 + 2 × 15 tem 120.
ALTER TABLE "Match" ADD COLUMN "overtimeMinutes" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
