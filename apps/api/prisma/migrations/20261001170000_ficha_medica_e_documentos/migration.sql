-- A informação médica e os documentos de um atleta.
--
-- Duas tabelas novas, e nenhuma coluna mexida: nada do que existe muda.

-- 1. A informação médica -----------------------------------------------------
--
-- Dados de saúde de menores. Uma tabela à parte, e não colunas no atleta, para
-- não viajarem com a ficha: só saem por um endpoint que exige `clinical:read`.
-- Uma linha por atleta, criada na primeira vez que alguém escreve.

CREATE TABLE "AthleteMedicalInfo" (
  "athleteId"     TEXT NOT NULL,
  "academyId"     TEXT NOT NULL,
  "bloodType"     TEXT,
  "allergies"     TEXT,
  "medication"    TEXT,
  "notes"         TEXT,
  "updatedByName" TEXT,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AthleteMedicalInfo_pkey" PRIMARY KEY ("athleteId")
);

CREATE INDEX "AthleteMedicalInfo_academyId_idx" ON "AthleteMedicalInfo"("academyId");

ALTER TABLE "AthleteMedicalInfo"
  ADD CONSTRAINT "AthleteMedicalInfo_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AthleteMedicalInfo"
  ADD CONSTRAINT "AthleteMedicalInfo_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AthleteMedicalInfo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AthleteMedicalInfo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AthleteMedicalInfo";
CREATE POLICY tenant_isolation ON "AthleteMedicalInfo"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- 2. Os documentos ------------------------------------------------------------
--
-- O nome que o clube dá e os ficheiros que o compõem. Os ficheiros vivem no
-- bucket privado `documentos`, com chave `<clube>/<atleta>/<aleatório>.<ext>`.

CREATE TABLE "AthleteDocument" (
  "id"            TEXT NOT NULL,
  "academyId"     TEXT NOT NULL,
  "athleteId"     TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "files"         JSONB NOT NULL DEFAULT '[]',
  "createdByName" TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AthleteDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AthleteDocument_academyId_athleteId_createdAt_idx"
  ON "AthleteDocument"("academyId", "athleteId", "createdAt");

ALTER TABLE "AthleteDocument"
  ADD CONSTRAINT "AthleteDocument_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AthleteDocument"
  ADD CONSTRAINT "AthleteDocument_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AthleteDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AthleteDocument" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AthleteDocument";
CREATE POLICY tenant_isolation ON "AthleteDocument"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- 3. O espaço do clube passa a contar os documentos ---------------------------
--
-- A mesma função de `20260928100000_espaco_por_clube`, com o bucket
-- `documentos` junto dos que começam pelo id do clube. Sem isto os documentos
-- não contavam para o limite de espaço, e o limite deixava de ser um limite.

CREATE OR REPLACE FUNCTION app.storage_by_academy(p_academy_id text DEFAULT NULL)
RETURNS TABLE (academy_id text, categoria text, bytes bigint, ficheiros bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH objetos AS (
    SELECT o.bucket_id,
           o.name,
           split_part(o.name, '/', 1) AS p1,
           split_part(o.name, '/', 2) AS p2,
           COALESCE((o.metadata->>'size')::bigint, 0) AS tamanho
    FROM storage.objects o
  ),
  atribuidos AS (
    -- Os que começam pelo id do clube.
    SELECT ob.p1 AS academia, CASE ob.bucket_id
             WHEN 'clube-publico' THEN 'simbolo'
             WHEN 'scouting' THEN 'scouting'
             WHEN 'ai-videos' THEN 'video'
             WHEN 'documentos' THEN 'documentos'
             ELSE ob.bucket_id END AS cat, ob.tamanho
    FROM objetos ob
    WHERE ob.bucket_id IN ('clube-publico', 'scouting', 'ai-videos', 'documentos')
    UNION ALL
    SELECT a."academyId", 'fotografias', ob.tamanho
    FROM objetos ob JOIN "Athlete" a ON a.id = ob.p2
    WHERE ob.bucket_id = 'fotos' AND ob.p1 = 'atletas'
    UNION ALL
    SELECT m."academyId", 'fotografias', ob.tamanho
    FROM objetos ob JOIN "Member" m ON m.id = ob.p2
    WHERE ob.bucket_id = 'fotos' AND ob.p1 = 'socios'
    UNION ALL
    SELECT DISTINCT ON (ob.name, ms."academyId") ms."academyId", 'fotografias', ob.tamanho
    FROM objetos ob JOIN "Membership" ms ON ms."userId" = ob.p2
    WHERE ob.bucket_id = 'fotos' AND ob.p1 = 'staff'
      AND ms.role NOT IN ('GUARDIAN', 'ATHLETE')
    UNION ALL
    SELECT i."academyId", 'inventario', ob.tamanho
    FROM objetos ob JOIN "InventoryItem" i ON i.id = ob.p2
    WHERE ob.bucket_id = 'inventario' AND ob.p1 = 'artigos'
    UNION ALL
    SELECT e."academyId", 'exercicios', ob.tamanho
    FROM objetos ob JOIN "Exercise" e ON e.id = ob.p2
    WHERE ob.bucket_id = 'exercicios' AND ob.p1 = 'exercicios'
  )
  SELECT at.academia::text, at.cat::text, SUM(at.tamanho)::bigint, COUNT(*)::bigint
  FROM atribuidos at
  WHERE p_academy_id IS NULL OR at.academia = p_academy_id
  GROUP BY at.academia, at.cat;
END;
$$;

REVOKE ALL ON FUNCTION app.storage_by_academy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.storage_by_academy(text) TO academia_app;
