-- Avaliações completas e relatórios de atleta
--
-- Ver `docs/03-estado.md`.
--
-- ## As duas peças
--
-- 1. A `Evaluation` ganha **pontos fortes** e **a trabalhar**. Cinco pontuações
--    dizem onde o atleta está; não dizem o que fazer com isso. Um pai que lê
--    "Técnica 3" fica na mesma — e o treinador, que sabe a resposta, escreve-a uma
--    vez em vez de a repetir ao telefone a vinte famílias.
--
-- 2. `AthleteReport` — o texto livre sobre um atleta, com **visibilidade**. Metade
--    do que um clube escreve sobre um miúdo não é para os pais lerem (o parecer
--    para a direção, a nota de que talvez suba de escalão); a outra metade é
--    precisamente para eles.
--
-- ## Porque é que `visibility` nasce em INTERNAL
--
-- Porque dos dois enganos possíveis, um é barato e o outro não tem volta. Um
-- relatório interno que a família não chegou a ver corrige-se com um clique;
-- um parecer interno que apareceu no telemóvel do pai já foi lido.

-- ---------------------------------------------------------------------------
-- Avaliação: o que está bem, e o que se vai trabalhar
-- ---------------------------------------------------------------------------

ALTER TABLE "Evaluation"
  ADD COLUMN "strengths" TEXT,
  ADD COLUMN "focus"     TEXT;

-- ---------------------------------------------------------------------------
-- Relatórios
-- ---------------------------------------------------------------------------

CREATE TYPE "ReportVisibility" AS ENUM ('INTERNAL', 'FAMILY');
CREATE TYPE "ReportStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- Um tipo de notificação próprio: a avaliação é o boletim do período, o relatório
-- é um texto sobre o percurso, e um pai que recebe os dois quer saber qual chegou.
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'REPORT_SHARED';

CREATE TABLE "AthleteReport" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "athleteId"   TEXT NOT NULL,
  "authorId"    TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "period"      TEXT,
  "body"        TEXT NOT NULL,
  "visibility"  "ReportVisibility" NOT NULL DEFAULT 'INTERNAL',
  "status"      "ReportStatus"     NOT NULL DEFAULT 'DRAFT',
  "snapshot"    JSONB,
  "publishedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AthleteReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AthleteReport_academyId_athleteId_createdAt_idx" ON "AthleteReport"("academyId", "athleteId", "createdAt");
CREATE INDEX "AthleteReport_academyId_status_visibility_idx" ON "AthleteReport"("academyId", "status", "visibility");

ALTER TABLE "AthleteReport"
  ADD CONSTRAINT "AthleteReport_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id")    ON DELETE CASCADE  ON UPDATE CASCADE,
  ADD CONSTRAINT "AthleteReport_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id")    ON DELETE CASCADE  ON UPDATE CASCADE,
  -- `Restrict` como na `Evaluation`: um relatório sem autor é um texto que ninguém
  -- assume, e é sobre uma criança.
  ADD CONSTRAINT "AthleteReport_authorId_fkey" FOREIGN KEY ("authorId")  REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: tem `academyId`, isola-se como o resto do domínio
-- ---------------------------------------------------------------------------
--
-- A visibilidade **não** se defende aqui. A RLS separa academias; separar o que a
-- família pode ler dentro da sua academia é trabalho do serviço, que é quem sabe
-- de que atletas aquela membership é encarregada. Uma política que tentasse as duas
-- coisas passaria a depender do papel de quem pergunta, e a RLS deste produto tem
-- uma pergunta só — de que academia é este pedido.

GRANT SELECT, INSERT, UPDATE, DELETE ON "AthleteReport" TO academia_app;

ALTER TABLE "AthleteReport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AthleteReport" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AthleteReport";
CREATE POLICY tenant_isolation ON "AthleteReport"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());
