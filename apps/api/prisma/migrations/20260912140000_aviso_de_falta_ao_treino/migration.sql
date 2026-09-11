-- ---------------------------------------------------------------------------
-- A família avisa que o atleta não vai ao treino
-- ---------------------------------------------------------------------------
--
-- ## O que faltava
--
-- Um jogo já se podia recusar: `MatchCallUp` ganhou `declineReason`,
-- `respondedAt` e `respondedById` na migração anterior. Um treino não — e é o
-- treino que acontece três vezes por semana. O pai que sabe na segunda que o
-- filho tem consulta na quarta não tinha por onde o dizer, e o treinador
-- descobria-o a contar cabeças no relvado.
--
-- ## Porque é uma tabela nova e não um `AttendanceRecord`
--
-- Porque são factos de tempos diferentes: o registo de presenças é o que
-- aconteceu, escrito pelo treinador depois; isto é o que a família diz que vai
-- acontecer, escrito antes. Juntá-los partia as duas pontas, e não de forma
-- subtil:
--
--   1. `saveAttendance` apaga a folha inteira e reescreve-a — *"a folha desta
--      gravação é a folha do treino"*. O aviso do pai desaparecia no instante
--      em que o treinador fechasse o registo.
--   2. `snapshotFor`, nos relatórios, conta **todos** os registos do atleta
--      para a assiduidade. Um aviso para a semana seguinte baixava a
--      assiduidade por um treino que ainda não tinha acontecido — e esse número
--      vai impresso para a família.
--
-- Separadas, cada tabela afirma uma coisa só. Encontram-se onde interessa: ao
-- abrir o registo de presenças, quem avisou aparece já marcado como falta
-- justificada com o motivo escrito, e o treinador confirma em vez de escrever.
--
-- ## Porque não tem estado
--
-- Um `MatchCallUp` existe antes da resposta. Num treino não há convocatória: vai
-- todo o plantel, e o silêncio é presença. A linha só nasce quando há o que
-- dizer, e é apagada se a família desmarcar — uma linha "afinal vai" seria um
-- aviso que não avisa nada.
--
-- ## Notas de forma
--
-- `TIMESTAMP(3)`, que é o que o Prisma mapeia para `DateTime`. A migração
-- anterior usou `TIMESTAMPTZ` em três colunas e é por isso que o
-- `npm run check:schema` acusa deriva desde então; não se acrescenta mais.
-- ---------------------------------------------------------------------------

CREATE TABLE "AbsenceNotice" (
  "id"          TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  "athleteId"   TEXT NOT NULL,
  "reason"      TEXT NOT NULL,
  "noticedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "noticedById" TEXT,
  CONSTRAINT "AbsenceNotice_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AbsenceNotice_athleteId_idx" ON "AbsenceNotice"("athleteId");

-- Um aviso por atleta e por treino. Avisar outra vez corrige o motivo; não
-- acumula linhas.
CREATE UNIQUE INDEX "AbsenceNotice_sessionId_athleteId_key" ON "AbsenceNotice"("sessionId", "athleteId");

ALTER TABLE "AbsenceNotice"
  ADD CONSTRAINT "AbsenceNotice_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "TrainingSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AbsenceNotice"
  ADD CONSTRAINT "AbsenceNotice_athleteId_fkey"
  FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- `ON DELETE SET NULL`: apagar um vínculo não apaga o facto de o aviso ter sido
-- dado. Mesmo desenho de `MatchCallUp.respondedById`.
ALTER TABLE "AbsenceNotice"
  ADD CONSTRAINT "AbsenceNotice_noticedById_fkey"
  FOREIGN KEY ("noticedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Um aviso sem motivo não é um aviso. A regra vive na base e não só no serviço,
-- como a da recusa de convocatória: é a base que não deixa ficar uma linha
-- incoerente, venha ela do produto ou de uma correcção à mão.
ALTER TABLE "AbsenceNotice"
  ADD CONSTRAINT "AbsenceNotice_has_reason"
  CHECK (btrim("reason") <> '');

-- ---------------------------------------------------------------------------
-- Isolamento: herda o clube do treino, como `AttendanceRecord`
-- ---------------------------------------------------------------------------
--
-- Sem `academyId` próprio, de propósito: a tabela pendura-se no treino e a
-- política vai buscar o clube por junção — o mesmo que `AttendanceRecord` e
-- `MatchCallUp` fazem desde a migração de RLS. Por isso também **não** entra em
-- `TENANT_SCOPED` no `prisma.service.ts`: a aplicação não sabe o caminho até ao
-- pai, e quem filtra é a política.

ALTER TABLE "AbsenceNotice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AbsenceNotice" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AbsenceNotice";
CREATE POLICY tenant_isolation ON "AbsenceNotice"
  USING (EXISTS (
    SELECT 1 FROM "TrainingSession" s
    WHERE s.id = "AbsenceNotice"."sessionId" AND s."academyId" = app.current_academy_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "TrainingSession" s
    WHERE s.id = "AbsenceNotice"."sessionId" AND s."academyId" = app.current_academy_id()
  ));

GRANT SELECT, INSERT, UPDATE, DELETE ON "AbsenceNotice" TO academia_app;
