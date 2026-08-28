-- Tirar alguém de uma equipa deixava-o nos treinos futuros dela.
--
-- ## O que estava a acontecer
--
-- `setTeams` apagava a linha de `TeamStaff` e não tocava em mais nada. O
-- `TrainingSession.coachId` continuava a apontar para a pessoa, e o calendário
-- desenhava o nome dela nos treinos de uma equipa onde ela já não trabalha.
--
-- Quem acabou de remover um treinador via o nome dele no ecrã a seguir, sem nada
-- que o explicasse — e sem forma de o corrigir, porque a página de onde se
-- removeu já dizia que ele tinha saído.
--
-- ## Só o que ainda não aconteceu
--
-- Um treino de 15 de Agosto **foi** dado por quem lá está escrito, e foi essa
-- pessoa que lhe fechou as presenças. Apagar isso era reescrever o passado para
-- arrumar o presente. Esta migração limpa apenas os treinos e eventos **futuros**
-- de quem já não pertence à equipa; o histórico fica exactamente como está.
--
-- O código deixou de criar mais destes — ver `AcademyService.setTeams`.

UPDATE "TrainingSession" s
   SET "coachId" = NULL
 WHERE s."coachId" IS NOT NULL
   AND s."startsAt" > now()
   AND NOT EXISTS (
     SELECT 1 FROM "TeamStaff" ts
      WHERE ts."teamId" = s."teamId" AND ts."membershipId" = s."coachId"
   );

UPDATE "CalendarEvent" e
   SET "coachId" = NULL
 WHERE e."coachId" IS NOT NULL
   AND e."teamId" IS NOT NULL
   AND e."startsAt" > now()
   AND NOT EXISTS (
     SELECT 1 FROM "TeamStaff" ts
      WHERE ts."teamId" = e."teamId" AND ts."membershipId" = e."coachId"
   );
