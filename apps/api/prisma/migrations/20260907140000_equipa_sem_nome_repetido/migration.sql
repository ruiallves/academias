-- Uma equipa por nome, dentro da mesma modalidade e da mesma época.
--
-- ## Porque é que isto é um índice e não só uma verificação no código
--
-- Porque a verificação no código já existia num dos dois caminhos e não chegou.
-- O `POST /api/teams` — por onde o importador de atletas cria as equipas que
-- julga não existirem — não verificava nada, e um clube ficou com oito equipas
-- em triplicado em dois dias. Mesmo com a verificação nos dois sítios, duas
-- importações em simultâneo passariam ambas pelo `findFirst` antes de qualquer
-- uma escrever. Só a base sabe recusar isso.
--
-- ## A chave, e o que ela deixa passar de propósito
--
-- (academia, época, modalidade, nome). Um "Sub-11" no futebol e outro no futsal
-- são equipas diferentes — treinos, jogos e plantéis diferentes — e um clube com
-- as duas modalidades tem de os poder chamar assim. O "Sub-11" da época que vem
-- também é outra equipa.
--
-- `lower(btrim(...))`: "Sub-11", "sub-11 " e "SUB-11" são o mesmo nome escrito
-- por três pessoas diferentes, e nenhuma delas quis criar uma equipa nova.
--
-- Os duplicados que existiam foram apagados antes desta migração (16 equipas,
-- todas sem atletas, staff, treinos ou jogos).

CREATE UNIQUE INDEX "Team_academyId_seasonId_sportId_name_key"
  ON "Team" ("academyId", "seasonId", "sportId", lower(btrim("name")));
