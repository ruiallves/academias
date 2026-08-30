-- A ficha de sócio criada à mão deixa de exigir tudo.
--
-- ## Porquê
--
-- Quem inscreve um sócio ao balcão tem à frente o que a pessoa lhe disse — o
-- nome e um contacto — e raramente o cartão de cidadão, a morada completa e o
-- NIF. Exigir a ficha inteira não fazia fichas completas: fazia a secretaria
-- inventar dados para o formulário deixar gravar, e um NIF inventado é pior do
-- que um NIF em falta, porque ninguém sabe que está errado.
--
-- A **inscrição pública** continua a pedir tudo (`MemberSignupDto`) — quem se
-- inscreve pelo site preenche a ficha dele, com calma e com os documentos à
-- mão. A importação também. O que muda é só o caminho manual.
--
-- ## Porque é que isto tem de ser nulo e não vazio
--
-- Por causa do `taxId`: tem restrição única por academia, e duas fichas com
-- string vazia colidiriam à segunda. Em Postgres vários NULL convivem no mesmo
-- índice único — que é exactamente o que "este dado ainda não se sabe" precisa.
-- Vale o mesmo para o resto: vazio diz "está preenchido com nada", nulo diz "por
-- preencher", e é a segunda coisa que a ficha tem de conseguir mostrar.

ALTER TABLE "Member" ALTER COLUMN "email" DROP NOT NULL;
ALTER TABLE "Member" ALTER COLUMN "birthdate" DROP NOT NULL;
ALTER TABLE "Member" ALTER COLUMN "address" DROP NOT NULL;
ALTER TABLE "Member" ALTER COLUMN "postalCode" DROP NOT NULL;
ALTER TABLE "Member" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "Member" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "Member" ALTER COLUMN "documentNumber" DROP NOT NULL;
ALTER TABLE "Member" ALTER COLUMN "taxId" DROP NOT NULL;
