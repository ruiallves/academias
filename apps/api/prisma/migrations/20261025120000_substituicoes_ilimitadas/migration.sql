-- Substituições ilimitadas (volantes) por equipa.
--
-- Até aqui decidia-se pela modalidade: o Pós-jogo tratava o futsal e o
-- basquetebol como volantes e o futebol nunca, e o "Ao vivo" não deixava
-- ninguém voltar a entrar em modalidade nenhuma. No futebol de formação há
-- escalões em que quem sai pode voltar, por isso passa a ser da equipa.
--
-- As equipas de futsal e de basquetebol ficam com ela ligada, que é o que o
-- Pós-jogo já fazia. Aditiva: a API em produção não lê a coluna.

ALTER TABLE "Team" ADD COLUMN "unlimitedSubs" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Team" t
   SET "unlimitedSubs" = true
  FROM "Sport" s
 WHERE s.id = t."sportId"
   AND s.code IN ('futsal', 'basketball');
