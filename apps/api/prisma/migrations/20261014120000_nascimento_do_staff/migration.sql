-- A data de nascimento de quem trabalha no clube, para os aniversários do
-- calendário. Opcional: nenhuma conta que já existe fica inválida.
ALTER TABLE "User" ADD COLUMN "birthdate" DATE;
