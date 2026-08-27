-- O registo dos emails que saem.
--
-- ## A pergunta que não tinha resposta
--
-- "Quantos emails foram enviados hoje?" — e a única forma de saber era abrir o
-- painel do fornecedor. Num plano gratuito com tecto diário, isso é a diferença
-- entre saber que se está a chegar ao limite e descobri-lo pelo convite que uma
-- academia jura que nunca recebeu.
--
-- ## Guarda-se a tentativa, não o envio
--
-- Uma linha com `ok = false` e o motivo vale mais do que linha nenhuma: é ela
-- que explica o convite que não chegou. O `MailClient` escreve aqui **depois**
-- de responder a quem chamou, e falha em silêncio se não conseguir — não se
-- perde um convite porque o registo não gravou.
--
-- ## O que não está aqui
--
-- O corpo da mensagem. O que se guarda é o mínimo para contar e para explicar:
-- o tipo, o destinatário, se saiu, porque não saiu, e quem entregou. O conteúdo
-- de um convite não precisa de uma segunda cópia na base de dados.

CREATE TABLE "MailLog" (
  "id"        TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "to"        TEXT NOT NULL,
  "ok"        BOOLEAN NOT NULL,
  "reason"    TEXT,
  "provider"  TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

-- Por dia é como isto é lido, sempre.
CREATE INDEX "MailLog_createdAt_idx" ON "MailLog"("createdAt");

-- Sem RLS, como `PushSubscription`: não é uma tabela de academia nenhuma — é do
-- servidor. Quem escreve é o `MailClient`, com a ligação da aplicação; quem lê é
-- o painel da plataforma, com a dele. Nenhum pedido de academia lhe toca.
GRANT SELECT, INSERT ON "MailLog" TO academia_app;
