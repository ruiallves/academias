-- A mesma pessoa, vários cargos.
--
-- ## O que faltava
--
-- Um presidente que também treina os Sub-13 é o caso normal de um clube
-- pequeno, não a excepção — e até aqui tinha de escolher: ou via as contas ou
-- convocava a equipa. Quem tentava resolvê-lo criava um cargo "Presidente e
-- treinador" com as permissões somadas à mão, e ao fim de uma época havia oito
-- cargos que eram combinações de três.
--
-- ## O principal fica onde estava
--
-- `Membership.customRoleId` continua a ser o cargo **principal**: é ele que dá o
-- `baseRole` — e com ele o âmbito e a patente —, é ele que se lê na lista de
-- staff e na ficha técnica de um jogo. Esta tabela são os que se acrescentam.
--
-- Podia ter sido tudo aqui, com uma coluna `isPrimary`. Não foi por uma razão
-- prática: o principal é lido em dezena e meia de sítios, todos à espera de
-- **um**, e trocá-los todos por um `find(isPrimary)` era arriscar que um deles
-- passasse a mostrar o cargo errado — para arrumar o que já estava arrumado.
--
-- ## O que muda no acesso
--
-- Só permissões e menus. `contextFor` passa a somar as permissões e os `navKeys`
-- de todos os cargos; o âmbito, o `baseRole` e a patente continuam a vir do
-- principal. Um presidente que treina continua a ver a academia toda, porque é
-- isso que "presidente" quer dizer — não fica preso às equipas dele por também
-- ser treinador.
--
-- A soma é a união, nunca a interseção: acrescentar um cargo só pode dar acesso,
-- nunca tirar. As retiradas por pessoa (`Membership.revokes`) continuam a ganhar
-- a tudo, como sempre ganharam.

CREATE TABLE "MembershipRole" (
  "membershipId" TEXT NOT NULL,
  "roleId"       TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MembershipRole_pkey" PRIMARY KEY ("membershipId", "roleId")
);

CREATE INDEX "MembershipRole_roleId_idx" ON "MembershipRole"("roleId");

-- Cascata dos dois lados. Apagar a pessoa leva os cargos secundários dela;
-- apagar o cargo tira-o de quem o vestia. Nem um nem outro pode deixar linhas a
-- apontar para nada — um acesso órfão é um acesso que ninguém consegue explicar.
ALTER TABLE "MembershipRole"
  ADD CONSTRAINT "MembershipRole_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MembershipRole"
  ADD CONSTRAINT "MembershipRole_roleId_fkey"
  FOREIGN KEY ("roleId") REFERENCES "AcademyRole"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Os cargos secundários com que alguém entra pelo convite. Ids em coluna de
-- texto e não uma tabela: um convite dura dias e morre no resgate, e uma cascata
-- a mais para isso não se paga. Validam-se duas vezes — ao convidar e ao
-- resgatar —, porque no meio o cargo pode ter sido arquivado.
ALTER TABLE "StaffInvite" ADD COLUMN "extraRoleIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- ---------------------------------------------------------------------------
-- RLS — herda o tenant da Membership, como TeamStaff herda o da Team
-- ---------------------------------------------------------------------------

ALTER TABLE "MembershipRole" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MembershipRole" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MembershipRole";
CREATE POLICY tenant_isolation ON "MembershipRole"
  USING (EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m.id = "MembershipRole"."membershipId" AND m."academyId" = app.current_academy_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m.id = "MembershipRole"."membershipId" AND m."academyId" = app.current_academy_id()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON "MembershipRole" TO academia_app;
