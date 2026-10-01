-- As Novidades passam a ser Comunicados: além de uma versão com novidades, o
-- painel manda aos clubes uma mensagem livre (assunto e texto).
--
-- `kind` diz qual das duas é. As que já existem são todas novidades. Uma
-- mensagem não tem versão: a coluna continua obrigatória e fica vazia nela.
ALTER TABLE "Release" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'NOVIDADES';
ALTER TABLE "Release" ADD CONSTRAINT "Release_kind_check" CHECK ("kind" IN ('NOVIDADES', 'MENSAGEM'));
