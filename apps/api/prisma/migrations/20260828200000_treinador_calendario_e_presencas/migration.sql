-- O resto do que um treinador precisa: marcar, registar, inscrever, comunicar
--
-- ## A metade que faltava
--
-- A migração `20260828140000` devolveu avaliações e relatórios aos cargos de
-- treinador que nasceram com a semente errada (ver lá a explicação do bug). Ficou
-- de fora o resto — de propósito, porque alargar permissões numa base com
-- clientes não é decisão de uma migração — e o resultado prático apareceu logo:
-- um treinador com equipa atribuída que não consegue marcar um treino no
-- calendário da equipa dele.
--
-- É a mesma causa e os mesmos cargos. Isto fecha-os.
--
-- ## O critério
--
-- Só cargos de base COACH cujo conjunto é **exactamente** a semente errada mais
-- as quatro que a migração anterior lhes deu:
--
--   academy:read, athlete:read, attendance:read, calendar:read, family:read,
--   team:read, evaluation:read, evaluation:write, report:read, report:write
--
-- Um cargo com uma permissão a mais ou a menos foi tocado por alguém — o
-- "Treinadar Adjunto" do ad-fafe é um deles, tem comms:read e não tem
-- family:read — e aí a configuração é uma escolha. Não se mexe.
--
-- ## O que se dá, e o que fica de fora
--
-- O que a base COACH dá e que falta a estes cargos: marcar no calendário,
-- registar presenças, inscrever atletas, comunicar com os pais, e pedir jogadores
-- ao scouting. Tudo limitado às equipas da pessoa por `teamScopeFilter` — a
-- permissão abre a porta, o âmbito decide a que salas.
--
-- **`clinical:read` e `clinical:status` ficam de fora.** A base COACH traz-nas, e
-- com boa razão (saber que lesão é, para adaptar o treino), mas são categoria
-- especial no RGPD e conceder acesso a dados de saúde por migração é outra coisa
-- do que devolver um botão de marcar treino. Estão à vista no editor de cargos,
-- na secção "Clínico", e ligam-se num clique quando o clube decidir.

UPDATE "AcademyRole"
   SET permissions = ARRAY(
         SELECT DISTINCT p
           FROM unnest(
             permissions || ARRAY[
               'calendar:write',
               'attendance:write',
               'athlete:write',
               'comms:read',
               'comms:write',
               'scouting:request'
             ]
           ) AS p
       ),
       "updatedAt" = now()
 WHERE "baseRole" = 'COACH'
   AND (
     SELECT array_agg(p ORDER BY p) FROM unnest(permissions) AS p
   ) = ARRAY[
     'academy:read', 'athlete:read', 'attendance:read', 'calendar:read',
     'evaluation:read', 'evaluation:write', 'family:read', 'report:read',
     'report:write', 'team:read'
   ];
