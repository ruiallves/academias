-- Contactos — quem já falámos, e em que pé está a conversa
--
-- Ver `docs/04-plataforma.md`.
--
-- ## De que lado da fronteira isto vive
--
-- Do nosso. Um `Contact` é uma pessoa de fora — um diretor de um clube que ainda
-- não é cliente — e não tem `academyId` obrigatório, não tem `Membership` e não
-- entra na RLS por tenant. Está com `PlatformAdmin` e `Plan` pela mesma razão que
-- elas estão: é da plataforma, não é de nenhuma academia.
--
-- ## Porque é que os REVOKE abaixo não são decoração
--
-- A migração de RLS (`20260816000100`) fez
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO academia_app;
--
-- ou seja, **qualquer tabela nova nasce com acesso concedido ao papel das
-- academias**. Sem os REVOKE, estas duas tabelas ficariam legíveis a partir de um
-- pedido de academia — e como não têm RLS, ficariam legíveis por inteiro. É o mesmo
-- cuidado que a migração `20260816000600` teve com as tabelas da plataforma, e a
-- razão pela qual isto está escrito em voz alta: é uma armadilha que só se vê a ler
-- a migração de RLS.

-- ---------------------------------------------------------------------------
-- O feed de agenda
-- ---------------------------------------------------------------------------
--
-- O Google Calendar busca o `.ics` sem sessão nenhuma — não há onde pôr um token
-- de Bearer numa subscrição de calendário. Logo o segredo é o próprio URL, e é por
-- isso que isto é uma coluna por administrador e não uma constante: revogar é
-- gerar outro, e afecta só quem revogou.

ALTER TABLE "PlatformAdmin" ADD COLUMN "calendarToken" TEXT;
CREATE UNIQUE INDEX "PlatformAdmin_calendarToken_key" ON "PlatformAdmin"("calendarToken");

-- ---------------------------------------------------------------------------
-- Contactos
-- ---------------------------------------------------------------------------

CREATE TYPE "ContactStatus" AS ENUM ('NOVO', 'CONTACTADO', 'SEM_RESPOSTA', 'REUNIAO', 'PROPOSTA', 'CLIENTE', 'PERDIDO');
CREATE TYPE "ContactChannel" AS ENUM ('CHAMADA', 'EMAIL', 'WHATSAPP', 'REUNIAO', 'MENSAGEM', 'OUTRO');

CREATE TABLE "Contact" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "phone"          TEXT,
  "email"          TEXT,
  "club"           TEXT,
  "role"           TEXT,
  "status"         "ContactStatus" NOT NULL DEFAULT 'NOVO',
  "ownerId"        TEXT,
  "academyId"      TEXT,
  "notes"          TEXT,
  "lastContactAt"  TIMESTAMP(3),
  "nextActionAt"   TIMESTAMP(3),
  "nextActionNote" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Contact_status_lastContactAt_idx" ON "Contact"("status", "lastContactAt");
CREATE INDEX "Contact_nextActionAt_idx" ON "Contact"("nextActionAt");
CREATE INDEX "Contact_ownerId_idx" ON "Contact"("ownerId");

-- `SET NULL` nos dois: um contacto sobrevive a quem saiu da equipa e sobrevive a
-- uma academia apagada. O que se perde é a ligação, não o histórico de o ter falado.
ALTER TABLE "Contact"
  ADD CONSTRAINT "Contact_ownerId_fkey"   FOREIGN KEY ("ownerId")   REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Contact_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id")       ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ContactTouch" (
  "id"         TEXT NOT NULL,
  "contactId"  TEXT NOT NULL,
  "channel"    "ContactChannel" NOT NULL,
  "note"       TEXT,
  "status"     "ContactStatus",
  "byName"     TEXT,
  "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactTouch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactTouch_contactId_happenedAt_idx" ON "ContactTouch"("contactId", "happenedAt");

-- `CASCADE` e não `SET NULL`: uma interação sem o contacto a que pertence não é
-- histórico, é lixo. Ao contrário do `AuditLog`, isto não é um registo de quem
-- mexeu em quê — é a conversa em si.
ALTER TABLE "ContactTouch"
  ADD CONSTRAINT "ContactTouch_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Fora do alcance do papel das academias
-- ---------------------------------------------------------------------------

REVOKE ALL ON "Contact"      FROM academia_app;
REVOKE ALL ON "ContactTouch" FROM academia_app;
