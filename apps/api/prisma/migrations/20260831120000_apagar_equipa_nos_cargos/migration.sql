-- Apagar uma equipa chega aos cargos que já existiam.
--
-- ## O que estava partido
--
-- `team:delete` nasceu com a funcionalidade de apagar equipas e foi acrescentada
-- ao mapa-base em código — mas os cargos guardam **permissões resolvidas**, uma
-- fotografia tirada no dia em que o cargo foi criado. Nenhum cargo criado antes
-- dessa data a recebeu.
--
-- O resultado: 24 dos 26 cargos de topo da base ficaram sem ela. O presidente de
-- um clube a sério abria a ficha de uma equipa e não via o botão — enquanto na
-- academia de demonstração, cujas contas não têm cargo nenhum atribuído e por
-- isso caem no mapa do código, tudo funcionava. A mesma pessoa, dois
-- comportamentos, e a diferença era só a data em que o cargo nasceu.
--
-- A migração `20260829130000_area_tecnica_nos_cargos` já tinha resolvido
-- exactamente isto para `training:*` e deixado a regra escrita. `team:delete`
-- passou ao lado dela: a migração que a acompanhou (`20260830150000_apagar_clube`)
-- tratou do registo de auditoria e esqueceu os cargos.
--
-- ## Porque é que isto pode ser uma migração
--
-- A regra da casa é que alargar permissões numa base com clientes não é decisão
-- de uma migração. A excepção — a mesma da migração da área técnica — é uma
-- permissão que **nasceu agora**: nenhum cargo a teve alguma vez, logo nenhum
-- clube pôde decidir tirá-la. Não há escolha de ninguém a atropelar.
--
-- ## O critério, e o travão a mais
--
-- `OWNER` e `DIRECTOR`, que é onde o código a põe (`WRITE_ALL`) — o coordenador
-- está deliberadamente fora, lá e aqui.
--
-- E, ao contrário da migração da área técnica, exige-se também `team:write`.
-- Apagar uma equipa leva treinos, jogos e convocatórias atrás; um cargo de
-- direção a quem o clube tenha retirado a edição de equipas não é um cargo a
-- quem se deva entregar a destruição delas em silêncio. Ler é barato, apagar não
-- tem volta.
--
-- `academy:delete` — apagar o clube inteiro — fica **de fora** de propósito.
-- Nasceu ao mesmo tempo e sofre do mesmo problema, mas dar a 24 cargos o poder
-- de apagar a academia toda sem ninguém o ter pedido é precisamente o tipo de
-- decisão que uma migração não deve tomar sozinha.

UPDATE "AcademyRole"
   SET permissions = ARRAY(
         SELECT DISTINCT p
           FROM unnest(permissions || ARRAY['team:delete']) AS p
       ),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND permissions @> ARRAY['team:write']
   AND NOT permissions @> ARRAY['team:delete'];

-- Os departamentos são o ponto de partida dos cargos novos: sem isto, cada cargo
-- de direção criado amanhã nascia outra vez sem o botão.
UPDATE "Department"
   SET permissions = ARRAY(
         SELECT DISTINCT p
           FROM unnest(permissions || ARRAY['team:delete']) AS p
       ),
       "updatedAt" = now()
 WHERE "baseRole" IN ('OWNER', 'DIRECTOR')
   AND permissions @> ARRAY['team:write']
   AND NOT permissions @> ARRAY['team:delete'];
