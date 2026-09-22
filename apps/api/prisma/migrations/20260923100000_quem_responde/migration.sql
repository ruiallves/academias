-- Quem responde por um atleta: a família ou o próprio.
--
-- ## A avaria
--
-- A resposta a uma convocatória e o aviso de falta ao treino autorizavam-se com
-- uma pergunta só: "este atleta é meu?". Um atleta com conta própria tem-se a si
-- no âmbito, e por isso podia confirmar ou recusar a sua própria convocatória.
-- Num escalão de formação quem decide se o miúdo vai ao jogo é o encarregado de
-- educação, e o produto estava a deixar o miúdo decidir.
--
-- ## A regra nova
--
-- Cada convocatória e cada treino dizem **quem responde**: `GUARDIAN` (por
-- omissão, o encarregado) ou `ATHLETE` (o próprio, para escalões mais velhos).
-- É um ou outro, nunca os dois: com duas bocas a responder pela mesma pessoa, a
-- última resposta ganha e o treinador deixa de saber de quem foi.
--
-- Fica no jogo e no treino, e não na equipa, porque é onde o clube decide hoje:
-- quem submete a convocatória escolhe ali, e quem marca o treino escolhe ali. Se
-- um dia se repetir escalão a escalão, a definição sobe para a equipa e estas
-- colunas passam a ser o valor herdado.

CREATE TYPE "ResponderBy" AS ENUM ('GUARDIAN', 'ATHLETE');

ALTER TABLE "Match"
  ADD COLUMN IF NOT EXISTS "respondBy" "ResponderBy" NOT NULL DEFAULT 'GUARDIAN';

ALTER TABLE "TrainingSession"
  ADD COLUMN IF NOT EXISTS "respondBy" "ResponderBy" NOT NULL DEFAULT 'GUARDIAN';
