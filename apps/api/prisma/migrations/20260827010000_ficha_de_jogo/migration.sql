-- A ficha de jogo: cartões, titularidade, e quem da equipa técnica lá esteve.
--
-- ## O que faltava
--
-- `MatchAppearance` guardava minutos, golos e uma nota. Não guardava se o atleta
-- começou o jogo (a primeira pergunta que um treinador faz, e que não se deduz
-- dos minutos), nem cartões — que são a razão de alguém não poder jogar o jogo
-- seguinte, e portanto o dado com mais consequências práticas da ficha toda.
--
-- Os amarelos são um número e não um sim/não porque dois amarelos são uma
-- expulsão; o vermelho directo é uma coluna à parte porque, para a federação e
-- para o castigo que se segue, não é a mesma coisa.
--
-- ## `MatchStaff`
--
-- Um jogo não tem um responsável, tem uma equipa de trabalho. `Match.coachId`
-- responde a "de quem é este jogo"; isto responde a "quem lá esteve" — o
-- massagista, o delegado, o adjunto.
--
-- ## `statsEnteredAt`
--
-- Para a integração que há-de vir (ZeroZero, FPF). Um importador tem de saber
-- distinguir um jogo que ninguém tocou, e que pode escrever à vontade, de um que
-- o treinador já preencheu ao minuto. Sem esta coluna, a primeira sincronização
-- apagava o trabalho de toda a gente.

ALTER TABLE "MatchAppearance" ADD COLUMN "started"     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MatchAppearance" ADD COLUMN "assists"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MatchAppearance" ADD COLUMN "yellowCards" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MatchAppearance" ADD COLUMN "redCard"     BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Match" ADD COLUMN "statsEnteredAt" TIMESTAMP(3);

-- Os jogos que já têm ficha preenchida contam como preenchidos à mão: foram-no.
-- Sem isto, o primeiro importador a correr trataria trabalho real como espaço
-- livre.
UPDATE "Match" m SET "statsEnteredAt" = m."updatedAt"
WHERE EXISTS (SELECT 1 FROM "MatchAppearance" a WHERE a."matchId" = m."id");

CREATE TABLE "MatchStaff" (
  "id"           TEXT NOT NULL,
  "matchId"      TEXT NOT NULL,
  "membershipId" TEXT NOT NULL,
  "role"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MatchStaff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MatchStaff_matchId_membershipId_key" ON "MatchStaff"("matchId", "membershipId");
CREATE INDEX "MatchStaff_membershipId_idx" ON "MatchStaff"("membershipId");

ALTER TABLE "MatchStaff"
  ADD CONSTRAINT "MatchStaff_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MatchStaff"
  ADD CONSTRAINT "MatchStaff_membershipId_fkey"
  FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS.
--
-- `MatchStaff` não tem `academyId` — chega ao seu por `Match`. A política tem de
-- o ir buscar lá, e não pode ser dispensada por isso: sem ela, a tabela fica de
-- fora do isolamento e um clube lê a ficha técnica de outro.
--
-- É o mesmo padrão de `MatchCallUp` e `MatchAppearance`, que também vivem
-- penduradas no jogo.

ALTER TABLE "MatchStaff" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MatchStaff" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MatchStaff";
CREATE POLICY tenant_isolation ON "MatchStaff"
  USING (EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."id" = "MatchStaff"."matchId" AND m."academyId" = app.current_academy_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Match" m
    WHERE m."id" = "MatchStaff"."matchId" AND m."academyId" = app.current_academy_id()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON "MatchStaff" TO academia_app;
