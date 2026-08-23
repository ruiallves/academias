-- Balneário
--
-- Separado de `venue` porque são duas perguntas diferentes. O local diz onde é o
-- treino; o balneário diz onde a equipa se muda. Num pavilhão com quatro
-- balneários e três equipas a treinar à mesma hora, é a segunda que causa
-- discussões — e era a única que o produto não sabia responder.
--
-- Nulo é aceitável e comum: uma academia que treina num campo sem balneários
-- atribuídos não tem nada para preencher, e obrigá-la a inventar um seria pior do
-- que a coluna vazia.

ALTER TABLE "TrainingSession" ADD COLUMN "dressingRoom" TEXT;
ALTER TABLE "CalendarEvent"   ADD COLUMN "dressingRoom" TEXT;
