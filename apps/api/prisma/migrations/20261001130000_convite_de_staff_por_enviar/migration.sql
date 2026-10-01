-- Um convite de staff pode ficar guardado sem ser enviado.
--
-- `sentAt` nulo é "por enviar": a pessoa está na lista do clube, com o cargo e
-- as equipas escolhidos, e ainda não recebeu email nem existe link nenhum. É o
-- que deixa adicionar o staff todo (à mão ou por ficheiro) e convidar depois,
-- como já se faz com os atletas.
--
-- Os que já existiam foram todos enviados ao criar: ficam com a data em que
-- foram criados.
--
-- O valor por omissão é "agora", e não nulo, de propósito: o código que ainda
-- não conhece a coluna cria convites que envia logo, e sem isto esses apareciam
-- como "por enviar" entre a migração e o deploy. Quem guarda sem enviar escreve
-- o nulo às claras.
ALTER TABLE "StaffInvite" ADD COLUMN "sentAt" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "StaffInvite" SET "sentAt" = "createdAt";
