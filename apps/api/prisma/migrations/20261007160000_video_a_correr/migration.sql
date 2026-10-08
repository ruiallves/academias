-- ---------------------------------------------------------------------------
-- Academias AI — o vídeo a correr.
--
-- A detecção demorava uma barra inteira: quarenta minutos a duas horas sem um
-- píxel para ver. O worker produz as caixas frame a frame desde o primeiro
-- segundo; só as largava no fim. Passa a largá-las aos troços de dez segundos
-- de vídeo, e a consola desenha-as em cima do vídeo enquanto a máquina ainda
-- vai a meio.
--
-- Uma tabela e não o Storage: a consola pergunta "o que há de novo desde o
-- troço N" de três em três segundos, e pelo Storage isso era um link assinado
-- por troço e por pedido. Dado transitório — a purga do vídeo apaga-o; o
-- resultado final continua a ir para o Storage (`PlayerTrack.dataKey`).
-- ---------------------------------------------------------------------------

CREATE TABLE "AILiveSegment" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "fromMs" INTEGER NOT NULL,
    "toMs" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AILiveSegment_pkey" PRIMARY KEY ("id")
);

-- A pergunta da consola é "desta análise, os troços depois do N": único e ordenado.
CREATE UNIQUE INDEX "AILiveSegment_analysisId_index_key" ON "AILiveSegment"("analysisId", "index");
CREATE INDEX "AILiveSegment_academyId_idx" ON "AILiveSegment"("academyId");

ALTER TABLE "AILiveSegment" ADD CONSTRAINT "AILiveSegment_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AILiveSegment" ADD CONSTRAINT "AILiveSegment_analysisId_fkey"
  FOREIGN KEY ("analysisId") REFERENCES "AIAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS, como em todas as tabelas de tenant da AI: posições de menores em campo
-- não atravessam clubes por engano de filtro.
ALTER TABLE "AILiveSegment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AILiveSegment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AILiveSegment";
CREATE POLICY tenant_isolation ON "AILiveSegment"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());
