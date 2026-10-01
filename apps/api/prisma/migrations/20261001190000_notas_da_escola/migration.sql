-- As notas da escola de um atleta: o encarregado submete na app, o clube lê na
-- ficha. Uma tabela nova; nada do que existe muda.
--
-- Uma linha por atleta, ano lectivo, período e disciplina. `subjectKey` é a
-- disciplina sem acentos nem maiúsculas, e é ela que entra na chave única:
-- submeter outra vez a mesma disciplina corrige a nota em vez de a duplicar.

CREATE TABLE "SchoolGrade" (
  "id"              TEXT NOT NULL,
  "academyId"       TEXT NOT NULL,
  "athleteId"       TEXT NOT NULL,
  "schoolYear"      TEXT NOT NULL,
  "period"          TEXT NOT NULL,
  "subject"         TEXT NOT NULL,
  "subjectKey"      TEXT NOT NULL,
  "grade"           INTEGER NOT NULL,
  "scale"           INTEGER NOT NULL,
  "submittedByName" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SchoolGrade_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SchoolGrade_athleteId_schoolYear_period_subjectKey_key"
  ON "SchoolGrade"("athleteId", "schoolYear", "period", "subjectKey");
CREATE INDEX "SchoolGrade_academyId_athleteId_idx" ON "SchoolGrade"("academyId", "athleteId");

ALTER TABLE "SchoolGrade"
  ADD CONSTRAINT "SchoolGrade_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SchoolGrade"
  ADD CONSTRAINT "SchoolGrade_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SchoolGrade" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SchoolGrade" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SchoolGrade";
CREATE POLICY tenant_isolation ON "SchoolGrade"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());
