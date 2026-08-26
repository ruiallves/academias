-- Tickets: a caixa de entrada do site, à parte do funil de vendas.
--
-- ## Porquê
--
-- O formulário do site criava um `Contact` com estado NOVO e enfiava o assunto, o
-- número de atletas e a mensagem todos dentro de `notes`, como texto corrido.
-- Perdia o dado (um "Atletas: 120" dentro de uma string não se filtra nem se
-- conta) e misturava duas listas com donos diferentes: `Contact` é quem andamos a
-- trabalhar, com responsável e próximo passo no calendário; uma pergunta de um
-- curioso não tem nada disso.
--
-- O que liga as duas é `Ticket.contactId`: um ticket que é mesmo um negócio
-- converte-se num contacto e fica a apontar para ele.
--
-- ## Privilégios
--
-- `Ticket` e `TicketNote` são tabelas **só da plataforma** — nenhuma academia lhes
-- toca. A migração `20260816000100_rls` pôs um `ALTER DEFAULT PRIVILEGES` que dá
-- SELECT/INSERT/UPDATE/DELETE ao `academia_app` em cada tabela nova, por isso o
-- REVOKE no fim não é zelo a mais: sem ele, qualquer academia lia os pedidos de
-- todas as outras. Mesmo padrão de `PlatformAdminInvite`.

CREATE TYPE "TicketStatus" AS ENUM ('NOVO', 'ABERTO', 'RESPONDIDO', 'FECHADO');

CREATE TABLE "Ticket" (
  "id"         TEXT NOT NULL,
  "subject"    TEXT NOT NULL,
  "subjectId"  TEXT,
  "name"       TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "phone"      TEXT,
  "club"       TEXT,
  "athletes"   TEXT,
  "message"    TEXT,
  "status"     "TicketStatus" NOT NULL DEFAULT 'NOVO',
  "assigneeId" TEXT,
  "contactId"  TEXT,
  "ip"         TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId");
CREATE INDEX "Ticket_email_idx" ON "Ticket"("email");

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_assigneeId_fkey"
  FOREIGN KEY ("assigneeId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Ticket"
  ADD CONSTRAINT "Ticket_contactId_fkey"
  FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "TicketNote" (
  "id"        TEXT NOT NULL,
  "ticketId"  TEXT NOT NULL,
  "adminId"   TEXT,
  "body"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TicketNote_ticketId_createdAt_idx" ON "TicketNote"("ticketId", "createdAt");

ALTER TABLE "TicketNote"
  ADD CONSTRAINT "TicketNote_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TicketNote"
  ADD CONSTRAINT "TicketNote_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Recuperar o que já entrou pelo formulário.
--
-- Os contactos criados pelo site ficaram registados no `AuditLog` com a acção
-- `contact.create.site` — é por aí que se sabe quais deles vieram de lá e não
-- foram escritos à mão por alguém da equipa. O `notes` volta a ser desmontado nas
-- partes de que foi feito, que é o inverso exacto do que o `createFromSite`
-- fazia.
--
-- Os contactos ficam onde estão: quem já os anda a trabalhar não os perde de
-- vista a meio. O ticket nasce ligado ao contacto, e é isso que diz que os dois
-- são a mesma história.

INSERT INTO "Ticket" ("id", "subject", "name", "email", "phone", "club", "message", "status", "contactId", "createdAt", "updatedAt")
SELECT
  'tkt_' || substr(md5(c."id"), 1, 20),
  COALESCE(
    NULLIF(substring(c."notes" from 'Assunto: ([^\n]+)'), ''),
    'Outro assunto'
  ),
  c."name",
  COALESCE(c."email", ''),
  c."phone",
  c."club",
  -- Tudo o que vinha depois do bloco "Assunto:"/"Atletas:", que é a mensagem.
  NULLIF(regexp_replace(c."notes", '^Assunto: [^\n]*\n*(Atletas: [^\n]*\n*)?', ''), ''),
  -- Um contacto que já saiu do NOVO é um contacto que alguém tratou; o ticket
  -- correspondente nasce fechado para não reaparecer como trabalho por fazer.
  CASE WHEN c."status" = 'NOVO' THEN 'NOVO'::"TicketStatus" ELSE 'FECHADO'::"TicketStatus" END,
  c."id",
  c."createdAt",
  NOW()
FROM "Contact" c
WHERE c."email" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "AuditLog" a
    WHERE a."action" = 'contact.create.site' AND a."targetId" = c."id"
  );

-- ---------------------------------------------------------------------------
-- Só a plataforma. Ver a nota no topo.

REVOKE ALL ON "Ticket" FROM academia_app;
REVOKE ALL ON "TicketNote" FROM academia_app;
