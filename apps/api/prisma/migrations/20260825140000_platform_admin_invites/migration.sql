-- Convites para a plataforma — o único caminho para criar um `PlatformAdmin`.
--
-- Mesmo desenho dos convites de staff: token em claro só no link, hash na base,
-- uso único, expira. Ver `docs/03-estado.md` para o porquê deste padrão.
--
-- ## Porque é que o REVOKE abaixo não é decoração
--
-- A migração de RLS (`20260816000100`) fez
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO academia_app;
--
-- ou seja, qualquer tabela nova nasce com acesso concedido ao papel das
-- academias. Sem o REVOKE, esta tabela — que não tem `academyId`, não tem RLS, e
-- guarda o hash de convites para a nossa própria administração — ficaria legível
-- por inteiro a partir de um pedido de uma academia qualquer. Mesmo cuidado que
-- `20260816000600` (PlatformAdmin, Plan, ...) e `20260821000200` (Contact) já
-- tiveram, e a mesma razão para o dizer em voz alta aqui.

CREATE TABLE "PlatformAdminInvite" (
  "id"          TEXT NOT NULL,
  "tokenHash"   TEXT NOT NULL,
  "email"       TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "role"        "PlatformRole" NOT NULL,
  "invitedById" TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3) NOT NULL,
  "redeemedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlatformAdminInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformAdminInvite_tokenHash_key" ON "PlatformAdminInvite"("tokenHash");

ALTER TABLE "PlatformAdminInvite"
  ADD CONSTRAINT "PlatformAdminInvite_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A armadilha da concessão por omissão, fechada.
REVOKE ALL ON "PlatformAdminInvite" FROM academia_app;
