-- Os minutos com substituições ilimitadas.
--
-- Com elas, um jogador entra e sai várias vezes, e uma entrada e uma saída
-- (onMinute/offMinute) não chegam para contar os minutos. Guardam-se os
-- intervalos em campo, alternados: entrou, saiu, entrou, saiu.
--
-- Aditiva: a API em produção não lê a coluna. Tem de estar aplicada ANTES do
-- deploy da API nova, que já a lê.

ALTER TABLE "MatchAppearance" ADD COLUMN "stints" INTEGER[] NOT NULL DEFAULT '{}';
