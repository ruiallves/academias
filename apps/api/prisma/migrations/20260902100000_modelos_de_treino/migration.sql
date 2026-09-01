-- Modelos de treino — um plano guardado para se voltar a usar.
--
-- ## O problema
--
-- Um treinador monta o mesmo treino dezenas de vezes por época: o aquecimento
-- de sempre, o jogo de posse de sempre, o jogo formal no fim. Hoje monta-o de
-- novo em cada sessão, bloco a bloco, ou vai à sessão da semana passada copiar
-- à mão. O plano vive **na sessão** (ver `TrainingSession`) — e está certo que
-- viva, porque um treino planeado é o treino do calendário — mas isso deixa o
-- trabalho preso a uma data que já passou.
--
-- Um modelo é o mesmo plano sem data e sem equipa: aplica-se a uma sessão e
-- passa a ser o plano dela.
--
-- ## Porquê tabelas próprias e não uma bandeira na sessão
--
-- Uma `TrainingSession` com `isTemplate = true` obrigava a excluir modelos de
-- **todas** as leituras do produto — o calendário, as presenças, a app da
-- família, as contagens do menu, a actividade da plataforma. Um `WHERE` esquecido
-- num desses sítios põe um treino fantasma no calendário de um clube. Tabelas à
-- parte não podem ser esquecidas: não estão lá.
--
-- ## O nome é único por academia
--
-- É a resposta a "garante que esse treino já não existe". Um clube com três
-- modelos chamados "Terça" tem três modelos que ninguém sabe distinguir na lista
-- em que os vai escolher. O serviço apanha o conflito antes (para dar uma
-- mensagem em português) e o índice fica como rede: duas gravações ao mesmo
-- tempo passariam as duas pela verificação.

CREATE TABLE "SessionTemplate" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "createdById" TEXT,

  "visibility"  "LibraryVisibility" NOT NULL DEFAULT 'CLUB',

  "name"        TEXT NOT NULL,

  -- Os mesmos campos do plano de uma sessão, sem data, equipa nem local: é isso
  -- que faz dele um modelo em vez de uma cópia de um treino.
  "objective"        TEXT,
  "objectives"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sessionType"      TEXT,
  "intensity"        INTEGER,
  "expectedAthletes" INTEGER,
  "material"         TEXT,
  "planNotes"        TEXT,

  -- Quantas vezes foi aplicado, e quando pela última vez. Ordena a lista pelo
  -- que se usa mesmo, em vez de pelo que se criou primeiro.
  "useCount"   INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt" TIMESTAMP(3),

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "SessionTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SessionTemplateBlock" (
  "id"         TEXT NOT NULL,
  "academyId"  TEXT NOT NULL,
  "templateId" TEXT NOT NULL,

  "order"       INTEGER NOT NULL,
  "name"        TEXT NOT NULL,
  "durationMin" INTEGER NOT NULL,
  "category"    TEXT,
  "objective"   TEXT,
  "intensity"   INTEGER,
  "players"     TEXT,
  "notes"       TEXT,

  -- `SET NULL` e não `CASCADE`: apagar um exercício da biblioteca não pode
  -- desfazer o modelo. O bloco fica, com o nome que tinha, e sem ficha atrás.
  "exerciseId" TEXT,

  CONSTRAINT "SessionTemplateBlock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SessionTemplate_academyId_name_key" ON "SessionTemplate"("academyId", "name");
CREATE INDEX "SessionTemplate_academyId_visibility_idx" ON "SessionTemplate"("academyId", "visibility");
CREATE INDEX "SessionTemplate_createdById_idx" ON "SessionTemplate"("createdById");
CREATE INDEX "SessionTemplateBlock_templateId_order_idx" ON "SessionTemplateBlock"("templateId", "order");
CREATE INDEX "SessionTemplateBlock_academyId_idx" ON "SessionTemplateBlock"("academyId");
CREATE INDEX "SessionTemplateBlock_exerciseId_idx" ON "SessionTemplateBlock"("exerciseId");

ALTER TABLE "SessionTemplate"
  ADD CONSTRAINT "SessionTemplate_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionTemplate"
  ADD CONSTRAINT "SessionTemplate_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SessionTemplateBlock"
  ADD CONSTRAINT "SessionTemplateBlock_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionTemplateBlock"
  ADD CONSTRAINT "SessionTemplateBlock_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "SessionTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SessionTemplateBlock"
  ADD CONSTRAINT "SessionTemplateBlock_exerciseId_fkey"
  FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento
-- ---------------------------------------------------------------------------
--
-- O mesmo desenho de `Exercise` e `SessionBlock`: a coluna `academyId` está nas
-- duas tabelas — inclusive na dos blocos, que já a poderia ir buscar ao modelo —
-- para a política ser uma comparação directa e não um `EXISTS`. É a regra da
-- migração de RLS: a política mais simples é a que ninguém escreve mal.

ALTER TABLE "SessionTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionTemplate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SessionTemplate";
CREATE POLICY tenant_isolation ON "SessionTemplate"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SessionTemplateBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SessionTemplateBlock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SessionTemplateBlock";
CREATE POLICY tenant_isolation ON "SessionTemplateBlock"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON "SessionTemplate", "SessionTemplateBlock"
  TO academia_app;
