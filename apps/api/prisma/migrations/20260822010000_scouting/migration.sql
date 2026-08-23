-- Scouting — Fase 1
--
-- Prospectos, o funil, e as observações que o fazem andar.
--
-- ## Porque é que um prospecto não é um atleta com uma bandeira
--
-- Porque as regras são diferentes em tudo o que importa: não tem mensalidade, não
-- tem encarregado na plataforma, não tem presenças — e, decisivo, são dados de um
-- **menor que pertence a outro clube**. Uma tabela à parte é o que permite apagar
-- tudo isto de uma vez no dia em que o clube desiste de o seguir; uma coluna
-- `isProspect` no meio dos atletas espalhava esses dados por meia base de dados e
-- punha-os a passar por todas as queries que servem famílias.
--
-- ## Multi-desporto
--
-- Não há uma linha de futebol aqui. As posições vêm de `Sport.positions`, que já
-- existia, e os critérios de avaliação são linhas de `ScoutCriterion` por
-- modalidade. O scouting é a área onde é mais tentador esquecer isto — um
-- "Overall" e quatro categorias de futebol resolvem a demonstração e prendem o
-- produto a um desporto.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE "ProspectStage" AS ENUM (
  'DISCOVERED', 'WATCHING', 'OBSERVED', 'INTERESTING',
  'SHORTLISTED', 'TRIAL', 'DECISION', 'RECRUITED', 'REJECTED'
);

CREATE TYPE "ObservationContext" AS ENUM ('MATCH', 'TRAINING', 'TRIAL', 'VIDEO', 'OTHER');

CREATE TYPE "ScoutRecommendation" AS ENUM (
  'DROP', 'KEEP_WATCHING', 'OBSERVE_AGAIN', 'INVITE_TRAINING', 'SHORTLIST', 'RECRUIT'
);

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------

CREATE TABLE "Prospect" (
  "id"                 TEXT NOT NULL,
  "academyId"          TEXT NOT NULL,
  "sportId"            TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "birthdate"          DATE NOT NULL,
  "currentClub"        TEXT,
  "currentTeam"        TEXT,
  "position"           TEXT,
  "secondaryPositions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dominantSide"       "DominantSide",
  "stage"              "ProspectStage" NOT NULL DEFAULT 'DISCOVERED',
  "ownerId"            TEXT,
  "discoveredVia"      TEXT,
  "discoveredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Desnormalizado de propósito: a lista ordena-se e filtra-se por isto ("quem
  -- está há mais tempo sem ser visto?"), e derivá-lo por agregação a cada
  -- listagem era o caminho mais curto para uma página lenta.
  "lastObservedAt"     TIMESTAMP(3),
  "notes"              TEXT,
  "athleteId"          TEXT,
  "archivedAt"         TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Prospect_athleteId_key" ON "Prospect"("athleteId");
CREATE INDEX "Prospect_academyId_idx" ON "Prospect"("academyId");
CREATE INDEX "Prospect_academyId_stage_idx" ON "Prospect"("academyId", "stage");
CREATE INDEX "Prospect_academyId_lastObservedAt_idx" ON "Prospect"("academyId", "lastObservedAt");

CREATE TABLE "ProspectEvent" (
  "id"         TEXT NOT NULL,
  "prospectId" TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "from"       TEXT,
  "to"         TEXT,
  "note"       TEXT,
  "actorId"    TEXT,
  "at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProspectEvent_prospectId_at_idx" ON "ProspectEvent"("prospectId", "at");

CREATE TABLE "Observation" (
  "id"               TEXT NOT NULL,
  "academyId"        TEXT NOT NULL,
  "prospectId"       TEXT NOT NULL,
  "scoutId"          TEXT,
  "observedAt"       TIMESTAMP(3) NOT NULL,
  "context"          "ObservationContext" NOT NULL DEFAULT 'MATCH',
  "opponent"         TEXT,
  "competition"      TEXT,
  "venue"            TEXT,
  "minutesObserved"  INTEGER,
  "positionObserved" TEXT,
  "strengths"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "improvements"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"            TEXT,
  "recommendation"   "ScoutRecommendation" NOT NULL DEFAULT 'KEEP_WATCHING',
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Observation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Observation_academyId_idx" ON "Observation"("academyId");
CREATE INDEX "Observation_prospectId_observedAt_idx" ON "Observation"("prospectId", "observedAt");

CREATE TABLE "ScoutCriterion" (
  "id"         TEXT NOT NULL,
  "academyId"  TEXT NOT NULL,
  "sportId"    TEXT NOT NULL,
  "group"      TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "order"      INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "ScoutCriterion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ScoutCriterion_academyId_sportId_group_name_key"
  ON "ScoutCriterion"("academyId", "sportId", "group", "name");
CREATE INDEX "ScoutCriterion_academyId_sportId_idx" ON "ScoutCriterion"("academyId", "sportId");

CREATE TABLE "ObservationRating" (
  "id"            TEXT NOT NULL,
  "observationId" TEXT NOT NULL,
  "criterionId"   TEXT NOT NULL,
  -- 1 a 5. Não é 0 a 100: uma escala fina finge uma precisão que ninguém tem a
  -- olhar para um miúdo durante meia hora.
  "score"         INTEGER NOT NULL,
  CONSTRAINT "ObservationRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ObservationRating_observationId_criterionId_key"
  ON "ObservationRating"("observationId", "criterionId");
CREATE INDEX "ObservationRating_criterionId_idx" ON "ObservationRating"("criterionId");

-- ---------------------------------------------------------------------------
-- Chaves estrangeiras
-- ---------------------------------------------------------------------------
--
-- `SET NULL` em tudo o que aponta para `Membership`: um scout que sai da academia
-- não pode levar consigo as observações que escreveu. Perde-se o nome do autor, e
-- é uma perda menor do que perder o trabalho.

ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProspectEvent" ADD CONSTRAINT "ProspectEvent_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProspectEvent" ADD CONSTRAINT "ProspectEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Observation" ADD CONSTRAINT "Observation_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_prospectId_fkey"
  FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_scoutId_fkey"
  FOREIGN KEY ("scoutId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ScoutCriterion" ADD CONSTRAINT "ScoutCriterion_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScoutCriterion" ADD CONSTRAINT "ScoutCriterion_sportId_fkey"
  FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ObservationRating" ADD CONSTRAINT "ObservationRating_observationId_fkey"
  FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ObservationRating" ADD CONSTRAINT "ObservationRating_criterionId_fkey"
  FOREIGN KEY ("criterionId") REFERENCES "ScoutCriterion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Isolamento
-- ---------------------------------------------------------------------------
--
-- Três tabelas com `academyId` próprio e duas que herdam o tenant do pai. As
-- segundas custam uma subconsulta por linha, e é deliberado: desnormalizar
-- `academyId` para elas criaria uma coluna que pode divergir do pai — e uma
-- política que protege a academia errada em silêncio é pior do que uma junção.
--
-- Sem contexto, `app.current_academy_id()` é NULL e nenhuma linha passa. Falha
-- fechado, que é a única omissão aceitável — e aqui trata-se de dados de menores
-- que pertencem a outros clubes.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Prospect', 'Observation', 'ScoutCriterion'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("academyId" = app.current_academy_id())
        WITH CHECK ("academyId" = app.current_academy_id())
    $p$, t);
  END LOOP;
END
$$;

DO $$
DECLARE spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('ProspectEvent',     'prospectId',    'Prospect'),
      ('ObservationRating', 'observationId', 'Observation')
    ) AS s(child, fk, parent)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', spec.child);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', spec.child);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', spec.child);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (EXISTS (
          SELECT 1 FROM %I p
          WHERE p.id = %I.%I AND p."academyId" = app.current_academy_id()
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM %I p
          WHERE p.id = %I.%I AND p."academyId" = app.current_academy_id()
        ))
    $p$, spec.child, spec.parent, spec.child, spec.fk,
         spec.parent, spec.child, spec.fk);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "Prospect", "ProspectEvent", "Observation", "ObservationRating", "ScoutCriterion"
  TO academia_app;
