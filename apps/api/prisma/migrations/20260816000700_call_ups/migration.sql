-- Convocatórias
--
-- ## O que faltava
--
-- `Match` e `MatchCallUp` já existiam desde a migração inicial. O que faltava era
-- o **tecto**: quantos atletas cabem numa convocatória.
--
-- Fica na equipa e não na academia, porque é uma regra do escalão e não do clube:
-- um Sub-11 de futebol convoca 14, um Sub-15 convoca 18, e a natação não convoca
-- ninguém. Uma definição única por academia obrigaria quem gere três modalidades a
-- escolher um número errado para duas delas.
--
-- O valor por omissão é 14 — futebol de formação, o caso mais comum neste produto.
-- Não é um limite técnico: o serviço recusa convocar acima dele, mas quem gere a
-- equipa muda-o na ficha dela.

ALTER TABLE "Team" ADD COLUMN "maxCallUps" INTEGER NOT NULL DEFAULT 14;

-- ---------------------------------------------------------------------------
-- Quando a convocatória foi fechada
-- ---------------------------------------------------------------------------
--
-- Nulo = ainda se está a montar. Preenchido = foi submetida, e as famílias foram
-- avisadas.
--
-- A distinção existe porque montar uma convocatória é um processo com hesitação —
-- tira-se um, põe-se outro, espera-se pela resposta do departamento clínico. Sem
-- este campo, cada clique enviaria uma notificação ao pai, e um pai que recebe
-- cinco avisos contraditórios numa tarde desliga as notificações para sempre.

ALTER TABLE "Match" ADD COLUMN "callUpsClosedAt" TIMESTAMP(3);

-- O índice (academyId, startsAt) em "Match" já vem da migração inicial. Não se
-- recria aqui: uma migração que falha a meio deixa a base num estado que ninguém
-- sabe descrever.

-- ---------------------------------------------------------------------------
-- O aviso que a família recebe
-- ---------------------------------------------------------------------------
--
-- Um tipo próprio e não `ANNOUNCEMENT_PUBLISHED`. A diferença importa do lado do
-- pai: um aviso da academia lê-se quando calhar; "o teu filho está convocado" tem
-- hora, sítio e uma decisão a tomar. Tipos distintos também deixam a família
-- desligar uns e manter outros, sem ser tudo ou nada.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'MATCH_CALLED_UP';
