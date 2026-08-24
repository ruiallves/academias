-- Fotografias de atletas e de staff
--
-- ## Chave, não URL
--
-- O que fica na base é a **chave** do ficheiro no armazenamento privado; o que a
-- API devolve é um link assinado com prazo, gerado a cada leitura.
--
-- A diferença não é de estilo. Um URL guardado é um endereço permanente: quem o
-- apanhar — num log, num ecrã partilhado, no histórico de um browser — abre a
-- fotografia de uma criança para sempre. Um link assinado expira, e a autorização
-- é decidida no momento do pedido, por quem está a pedir.
--
-- `photoUrl` fica onde estava, para o caso de uma academia trazer fotografias
-- alojadas noutro sítio. Quando as duas existem, a chave ganha: é a que passou pela
-- nossa validação.

ALTER TABLE "Athlete" ADD COLUMN "photoKey" TEXT;
ALTER TABLE "User"    ADD COLUMN "photoKey" TEXT;
