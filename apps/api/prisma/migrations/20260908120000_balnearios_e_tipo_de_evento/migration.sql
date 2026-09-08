-- ---------------------------------------------------------------------------
-- Vários balneários por evento, e o tipo vindo do catálogo
-- ---------------------------------------------------------------------------
--
-- ## Os balneários eram um
--
-- `dressingRoom` (texto) guardava **um** balneário. Um clube que leve duas
-- equipas ao mesmo jogo, ou que use o balneário 2 e o 3 num treino de guarda-
-- redes com o plantel, não tinha como o dizer — escrevia-o no título ou não o
-- dizia de todo. Passam a ser uma lista.
--
-- ## O singular fica, e não é indecisão
--
-- A coluna antiga **não se larga aqui**. Largar uma coluna que o código em
-- produção ainda lê põe a aplicação a devolver 500 no segundo em que a
-- migração corre e antes de o novo build entrar em serviço — foi exactamente
-- isso que aconteceu com `GuardianLink.isPayer` a 03/09, e o registo de
-- famílias esteve em baixo por causa disso.
--
-- Por isso: primeiro a coluna nova ao lado, com o conteúdo copiado; o servidor
-- escreve **nas duas** (o singular leva o primeiro da lista) enquanto houver
-- código antigo a ler; e a coluna antiga larga-se numa migração futura, depois
-- de o deploy estar feito. É expand-and-contract, e a parte "contract" é uma
-- decisão para outro dia.
--
-- ## O tipo de evento
--
-- `CalendarEventKind` continua a ser o enum que decide **em que tabela** o
-- evento vive: TRAINING abre folha de presenças (`TrainingSession`), MATCH abre
-- convocatória (`Match`), o resto é `CalendarEvent`. Isso é estrutura, e não se
-- toca.
--
-- O que faltava era o **vocabulário do clube**: o catálogo "Tipos de evento"
-- existe desde sempre nas Definições, é semeado com Treino/Jogo/Torneio/Evento
-- e nunca foi lido por ninguém — quem criasse "Estágio" ou "Reunião de pais"
-- via-os na lista das Definições e não os encontrava no calendário. `typeId`
-- liga as duas pontas: o evento guarda que tipo do catálogo é, e o enum
-- continua a dizer o que ele faz.
--
-- `SetNull` porque arquivar um tipo do catálogo não pode apagar os eventos que
-- já se marcaram com ele.

-- ---------------------------------------------------------------------------
-- Balneários
-- ---------------------------------------------------------------------------

ALTER TABLE "CalendarEvent" ADD COLUMN "dressingRooms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "TrainingSession" ADD COLUMN "dressingRooms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- O jogo nunca teve balneário, e o diálogo do calendário **oferecia-o** num
-- jogo em casa: escolhia-se, e o servidor deitava-o fora sem dizer nada. Agora
-- tem onde o guardar.
ALTER TABLE "Match" ADD COLUMN "dressingRooms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- O que já estava escrito passa para a lista. Um balneário vazio ou em branco
-- não vira uma entrada vazia na lista — vira lista vazia, que é o que ele é.
UPDATE "CalendarEvent"
   SET "dressingRooms" = ARRAY["dressingRoom"]
 WHERE "dressingRoom" IS NOT NULL AND btrim("dressingRoom") <> '';

UPDATE "TrainingSession"
   SET "dressingRooms" = ARRAY["dressingRoom"]
 WHERE "dressingRoom" IS NOT NULL AND btrim("dressingRoom") <> '';

-- ---------------------------------------------------------------------------
-- Tipo de evento, do catálogo do clube
-- ---------------------------------------------------------------------------

ALTER TABLE "CalendarEvent" ADD COLUMN "typeId" TEXT;

CREATE INDEX "CalendarEvent_typeId_idx" ON "CalendarEvent"("typeId");

ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_typeId_fkey"
  FOREIGN KEY ("typeId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Os eventos genéricos que já existem apanham o tipo do catálogo com o mesmo
-- nome, quando houver um. É melhor do que deixá-los sem tipo: um "Torneio"
-- marcado no mês passado passa a aparecer como Torneio na lista nova, em vez
-- de cair no genérico só porque a coluna nasceu depois dele.
UPDATE "CalendarEvent" e
   SET "typeId" = c.id
  FROM "CatalogItem" c
 WHERE c."academyId" = e."academyId"
   AND c.kind = 'eventTypes'
   AND c."archivedAt" IS NULL
   AND lower(c.label) = CASE e.kind
         WHEN 'TOURNAMENT' THEN 'torneio'
         WHEN 'OTHER' THEN 'evento'
         ELSE NULL
       END;
