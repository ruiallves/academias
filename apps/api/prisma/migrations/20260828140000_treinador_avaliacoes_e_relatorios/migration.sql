-- Avaliações e relatórios de volta aos cargos de treinador que nasceram vazios
--
-- ## O que aconteceu
--
-- Um cargo novo criado **dentro de um departamento** era semeado a partir de
-- `ROLE_PERMISSIONS.STAFF` — o mínimo — em vez das permissões do departamento.
-- Quem carrega em "Novo cargo" dentro da Equipa Técnica nunca troca o selector
-- de departamento, e a cópia só acontecia ao trocá-lo. Está corrigido no ecrã
-- (ver o comentário em `RoleDialog.tsx`), mas os cargos criados antes disso
-- ficaram como nasceram.
--
-- O efeito: um "Treinador GR" ou um "Preparador Físico" sem avaliações nem
-- relatórios — não os via nem os gerava, nem sequer para os seus atletas. E
-- ninguém lhos tinha tirado: nunca lá estiveram.
--
-- ## O critério, e porque é apertado
--
-- Só se corrigem cargos de base COACH cujo conjunto de permissões é **exactamente**
-- a semente de STAFF, nem uma a mais nem uma a menos:
--
--   academy:read, athlete:read, attendance:read, calendar:read, family:read, team:read
--
-- Essa assinatura só pode ter vindo do bug: seis permissões certas, todas de
-- leitura, iguais em cargos de clubes diferentes. Um cargo com uma permissão a
-- mais ou a menos foi tocado por alguém, e aí a configuração é uma escolha — não
-- se mexe. É o que distingue esta correcção da dos sócios: ali a permissão era
-- invisível e ninguém a podia ter escolhido; aqui avaliações e relatórios sempre
-- estiveram no editor, e um clube pode legitimamente tê-los desligado.
--
-- ## O que se dá, e o que não se dá
--
-- Só o que foi pedido: ver e gerar avaliações e relatórios. Estes mesmos cargos
-- também estão sem `calendar:write`, `attendance:write`, `athlete:write` e
-- `comms:write` pela mesmíssima razão — mas dar permissões a mais numa base com
-- clientes é uma decisão de quem tem os clubes, não desta migração.
--
-- O âmbito não vem daqui: a base COACH continua a limitar tudo às equipas da
-- pessoa, por `teamScopeFilter` e `athleteScopeFilter`. Um treinador com
-- `evaluation:read` vê as avaliações dos atletas dele e de mais ninguém.

UPDATE "AcademyRole"
   SET permissions = ARRAY(
         SELECT DISTINCT p
           FROM unnest(permissions || ARRAY['evaluation:read', 'evaluation:write', 'report:read', 'report:write']) AS p
       ),
       "updatedAt" = now()
 WHERE "baseRole" = 'COACH'
   AND (
     SELECT array_agg(p ORDER BY p) FROM unnest(permissions) AS p
   ) = ARRAY['academy:read', 'athlete:read', 'attendance:read', 'calendar:read', 'family:read', 'team:read'];
