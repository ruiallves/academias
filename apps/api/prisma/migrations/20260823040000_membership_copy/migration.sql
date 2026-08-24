-- O clube escreve a sua própria página de adesão
--
-- A frase que abre ("Faz parte do clube."), a que explica, e os pontos que dizem o
-- que se ganha. Estavam em código — iguais em qualquer clube que usasse o produto,
-- que é a definição de uma frase que não convence ninguém.
--
-- Nulo significa "usa o que o produto traz por omissão". Um clube que ainda não
-- escreveu nada tem uma página completa, e não uma página em branco à espera dele.

ALTER TABLE "Academy" ADD COLUMN "membershipHeadline" TEXT;
ALTER TABLE "Academy" ADD COLUMN "membershipIntro"    TEXT;
ALTER TABLE "Academy" ADD COLUMN "membershipPoints"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
