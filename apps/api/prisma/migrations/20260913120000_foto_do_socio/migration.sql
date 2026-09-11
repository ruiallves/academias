-- ---------------------------------------------------------------------------
-- A fotografia do sócio.
--
-- O cartão de sócio digital tinha nome, número e categoria — e nenhuma cara.
-- Um cartão sem fotografia identifica um número, não uma pessoa: quem está na
-- portaria vê um telemóvel com um nome escrito e não tem como saber se é de
-- quem o mostra.
--
-- A coluna é uma **chave** no bucket privado `fotos`, no mesmo desenho das
-- fotografias de atletas (`Athlete.photoKey`) e de staff (`User.photoKey`):
-- o ficheiro vai do browser directamente para o armazenamento com um endereço
-- assinado para uma chave escolhida pela API, e a API grava a chave depois de
-- confirmar que o ficheiro chegou. O que sai para os ecrãs é um link assinado
-- com prazo — nunca a chave, nunca um endereço permanente.
--
-- Quem a põe: a secretaria, na ficha; ou o próprio sócio, na app. As duas
-- portas escrevem a mesma coluna.
-- ---------------------------------------------------------------------------

ALTER TABLE "Member" ADD COLUMN "photoKey" TEXT;
