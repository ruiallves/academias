-- O Assistente IA nasce desligado e liga-se clube a clube no painel da
-- plataforma (12/11/2026). Até aqui nascia ligado e só a falta da chave da
-- OpenAI em produção o escondia: no dia em que a chave entrasse, os clubes
-- todos passavam a vê-lo de uma vez.
--
-- 1. Os clubes novos nascem sem ele.
-- 2. Os que já existem ficam desligados. Ninguém o usou em produção (a API
--    de produção não tem a chave), por isso não se tira nada a ninguém. O
--    Academia Life Club, o clube de testes da Academias, fica ligado para os
--    testes continuarem; desliga-se no painel se for preciso.
--
-- Não parte nada: a coluna já existe e a API de agora e a antiga leem-na igual.

ALTER TABLE "Academy" ALTER COLUMN "adjuntoEnabled" SET DEFAULT false;

UPDATE "Academy" SET "adjuntoEnabled" = false WHERE "id" <> 'acd_lifeclub';
