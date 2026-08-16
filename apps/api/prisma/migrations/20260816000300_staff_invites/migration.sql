-- Convites de staff
--
-- ## O que um convite é
--
-- Uma linha que diz "esta pessoa, com este email, pode passar a ter este papel
-- nesta academia, com estas equipas, até esta data". O link que a pessoa recebe
-- não contém nada disto — contém só um token aleatório que aponta para cá.
--
-- ## Porque é que se guarda o hash e não o token
--
-- Mesmo raciocínio de nunca guardar passwords. O token em claro existe uma vez, no
-- link que quem convida copia. Aqui fica o SHA-256. Se esta tabela vazar, os
-- convites pendentes não são resgatáveis por quem a leu — teria de inverter um
-- SHA-256 de 32 bytes aleatórios.
--
-- ## O ovo e a galinha, outra vez
--
-- Resgatar um convite é um pedido **sem autenticação e sem subdomínio de
-- confiança**: a pessoa ainda não tem conta. Mas a tabela tem RLS por `academyId`,
-- e para pôr o contexto do tenant é preciso saber a academia — que só se sabe
-- lendo o convite. Mesma solução de `resolve_academy_by_slug`: uma função
-- SECURITY DEFINER deliberadamente estreita, que dado um hash devolve só o id da
-- academia. Não devolve o email, nem o papel, nem as equipas — isso lê-se depois,
-- já com o contexto aberto e com a RLS a valer.

CREATE TABLE "StaffInvite" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "tokenHash"   TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "role"        "Role" NOT NULL,
  "title"       TEXT,
  "department"  "StaffDepartment",
  "teamIds"     TEXT[] DEFAULT ARRAY[]::TEXT[],
  "invitedById" TEXT,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "acceptedAt"  TIMESTAMP(3),
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "StaffInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StaffInvite_tokenHash_key" ON "StaffInvite"("tokenHash");
CREATE INDEX "StaffInvite_academyId_idx" ON "StaffInvite"("academyId");
CREATE INDEX "StaffInvite_academyId_email_idx" ON "StaffInvite"("academyId", "email");

ALTER TABLE "StaffInvite"
  ADD CONSTRAINT "StaffInvite_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- O autor pode sair da academia sem que o convite desapareça do histórico.
ALTER TABLE "StaffInvite"
  ADD CONSTRAINT "StaffInvite_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento entre academias
-- ---------------------------------------------------------------------------

ALTER TABLE "StaffInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffInvite" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StaffInvite";
CREATE POLICY tenant_isolation ON "StaffInvite"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON "StaffInvite" TO academia_app;

-- ---------------------------------------------------------------------------
-- Escotilha para o resgate
-- ---------------------------------------------------------------------------

/*
 * Dado o hash de um token, devolve a academia a que o convite pertence.
 *
 * Só isto. Um atacante que adivinhasse um hash ficaria a saber que existe uma
 * academia — que já é pública, está no subdomínio. Para saber o que quer que seja
 * do convite tem de o resgatar, e para isso precisa do token em claro.
 *
 * Só resolve convites que ainda valem: por resgatar, por revogar e dentro da
 * validade. Um convite gasto deixa de abrir o contexto do tenant, e não há
 * segundo caminho para lá chegar.
 */
CREATE OR REPLACE FUNCTION app.resolve_invite(p_token_hash text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT "academyId"
  FROM "StaffInvite"
  WHERE "tokenHash" = p_token_hash
    AND "acceptedAt" IS NULL
    AND "revokedAt" IS NULL
    AND "expiresAt" > now()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_invite(text) TO academia_app;

/*
 * Um email só pode ter uma membership por papel em cada academia — já é garantido
 * por `Membership_academyId_userId_role_key`. Aqui garante-se o equivalente do
 * lado dos convites: não vale a pena ter dois convites vivos para a mesma pessoa
 * com o mesmo papel, porque o segundo tornaria o primeiro num link órfão que
 * continuava a funcionar.
 */
CREATE UNIQUE INDEX "StaffInvite_pending_unique"
  ON "StaffInvite"("academyId", lower("email"), "role")
  WHERE "acceptedAt" IS NULL AND "revokedAt" IS NULL;
