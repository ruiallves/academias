-- O armazém é de quem o gere.
--
-- ## O que muda
--
-- `inventory:read` sai dos cargos com base de **coordenador**. Fica com a
-- primeira pessoa que entra no clube, com a presidência e com a direção — que é
-- quem responde pelo material — e mais ninguém por omissão.
--
-- A migração `20260831140000_inventario` deu-a a três bases (presidência,
-- direção e coordenação) por analogia com o resto das leituras da operação. Foi
-- decisão minha e estava errada: um coordenador desportivo monta plantéis e
-- planeia treinos, e saber quantas t-shirts há na prateleira não faz parte
-- disso. O clube que quiser dá-lha num cargo, que é precisamente para isso que
-- os cargos existem.
--
-- ## Porque é que **tirar** uma permissão pode ser uma migração
--
-- A regra da casa diz que alargar permissões numa base com clientes não é
-- decisão de uma migração, e tirar é ainda mais delicado: pode estar a desfazer
-- uma escolha do clube.
--
-- Aqui não está. Esta permissão nasceu há horas, na migração acima, e nenhum
-- clube teve tempo nem sítio para a conceder ou retirar a um coordenador — o
-- editor de cargos nem chegou a mostrá-la a ninguém. O que se desfaz é a minha
-- distribuição, não uma decisão de quem quer que seja.
--
-- Quem já a tiver recebido **de propósito** num cargo — impossível hoje, mas a
-- condição fica escrita — não é abrangido: só se mexe em cargos de coordenação.

UPDATE "AcademyRole"
   SET permissions = array_remove(permissions, 'inventory:read'),
       "updatedAt" = now()
 WHERE "baseRole" = 'COORDINATOR'
   AND permissions @> ARRAY['inventory:read'];

UPDATE "Department"
   SET permissions = array_remove(permissions, 'inventory:read'),
       "updatedAt" = now()
 WHERE "baseRole" = 'COORDINATOR'
   AND permissions @> ARRAY['inventory:read'];

-- `inventory:write` nunca chegou à coordenação (a migração anterior só a deu a
-- presidência e direção), mas a rede fica: uma permissão de escrita sem a de
-- leitura seria um cargo que altera stock num ecrã que não consegue abrir.
UPDATE "AcademyRole"
   SET permissions = array_remove(permissions, 'inventory:write'),
       "updatedAt" = now()
 WHERE "baseRole" = 'COORDINATOR'
   AND permissions @> ARRAY['inventory:write'];

UPDATE "Department"
   SET permissions = array_remove(permissions, 'inventory:write'),
       "updatedAt" = now()
 WHERE "baseRole" = 'COORDINATOR'
   AND permissions @> ARRAY['inventory:write'];
