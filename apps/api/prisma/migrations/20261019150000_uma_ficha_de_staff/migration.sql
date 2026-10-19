-- Uma ficha de staff por pessoa e por clube.
--
-- A chave de "Membership" é (clube, pessoa, papel-base), para a mesma pessoa
-- poder ser treinador e pai e sócio no mesmo clube: são áreas diferentes da
-- app. Mas deixava também duas fichas de staff, uma de direção e outra de
-- treinador, e com duas a API escolhia uma pela ordem em que a base as
-- devolvia. No Santa Maria FC um coordenador passou a entrar como treinador
-- (19/10/2026); a Juventude AC tinha o mesmo com a diretora.
--
-- Os vários cargos de staff de uma pessoa vivem numa ficha só: o principal
-- ("customRoleId") e os secundários ("MembershipRole"). Um segundo convite de
-- staff passa a juntar-se à ficha que existe (`invites/ficha-unica.ts`), e este
-- índice garante que nenhum outro caminho cria a segunda.
--
-- As duas fichas duplicadas que havia foram juntadas a 19/10/2026 antes deste
-- índice; sem isso ele não se cria.
--
-- Aplicar DEPOIS de a API nova estar no ar. A API nova não depende do índice;
-- a antiga, ao aceitar o segundo convite de staff de alguém, tentaria criar a
-- segunda ficha, o índice recusava-a e a pessoa ficava com um erro em vez de
-- entrar.

CREATE UNIQUE INDEX "Membership_uma_ficha_de_staff"
  ON "Membership" ("academyId", "userId")
  WHERE role NOT IN ('GUARDIAN', 'ATHLETE');
