-- ---------------------------------------------------------------------------
-- O cargo de quem pede para experimentar
-- ---------------------------------------------------------------------------
--
-- O formulário do site pergunta o nome, o clube e quantos atletas — e não
-- perguntava a coisa que decide como a conversa começa: **quem é esta pessoa no
-- clube**. Um presidente que pede para experimentar e um treinador que pede
-- para experimentar são dois pedidos diferentes: o primeiro pode decidir, o
-- segundo vai ter de convencer alguém. Sem isso, quem responde ao pedido
-- descobre-o ao telefone, cinco minutos depois de já ter escolhido o tom.
--
-- Opcional na base, e escrito à mão no formulário: os cargos de um clube não
-- cabem numa lista fechada — "Vice-presidente para o futebol de formação" é um
-- cargo a sério. O formulário sugere os comuns e aceita o que vier.
--
-- `Ticket` é tabela da plataforma: sem política de tenant e sem GRANT ao
-- `academia_app`, como as outras. Acrescentar uma coluna não muda nada disso.

ALTER TABLE "Ticket" ADD COLUMN "role" TEXT;
