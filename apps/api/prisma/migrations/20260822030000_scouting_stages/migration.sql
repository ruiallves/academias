-- Menos estados no funil
--
-- Nove estados eram três a mais. "Interessante", "Shortlist" e "Decisão" descrevem
-- graus de entusiasmo, não passos de um processo: ninguém sabia dizer quando é que
-- um prospecto passava de observado a interessante, e a diferença entre shortlist
-- e decisão era quem estava a olhar. Estados que não têm um critério claro de
-- entrada são estados que cada pessoa preenche à sua maneira — e o funil deixa de
-- significar nada.
--
-- Ficam seis, e cada um tem um facto por trás:
--
--   DISCOVERED  alguém falou dele
--   WATCHING    o clube decidiu acompanhar
--   OBSERVED    já foi visto por alguém nosso
--   TRIAL       veio treinar connosco
--   RECRUITED   assinou
--   REJECTED    o clube decidiu não avançar
--
-- ## O que acontece a quem já lá estava
--
-- `INTERESTING` e `SHORTLISTED` recuam para `OBSERVED` — os dois só existem depois
-- de alguém ter visto o miúdo, por isso não se perde informação nenhuma sobre o
-- que aconteceu. `DECISION` avança para `TRIAL`, que é o passo real de onde vinha.
--
-- As shortlists **não desaparecem**: continuam a ser listas de trabalho. O que
-- desaparece é a ideia de que estar numa lista é um estado do funil.

-- ---------------------------------------------------------------------------
-- Reescrever o tipo
-- ---------------------------------------------------------------------------
--
-- Postgres não deixa remover valores de um enum. Cria-se o tipo novo, converte-se
-- a coluna com o mapa acima, e troca-se o nome. `ProspectEvent.to`/`from` são
-- texto e guardam o histórico literal — não se reescrevem: "SHORTLISTED → OBSERVED"
-- é o que aconteceu na altura, e apagá-lo seria falsificar o histórico que esta
-- tabela existe para guardar.

CREATE TYPE "ProspectStage_new" AS ENUM (
  'DISCOVERED', 'WATCHING', 'OBSERVED', 'TRIAL', 'RECRUITED', 'REJECTED'
);

ALTER TABLE "Prospect" ALTER COLUMN "stage" DROP DEFAULT;

ALTER TABLE "Prospect"
  ALTER COLUMN "stage" TYPE "ProspectStage_new"
  USING (
    CASE "stage"::text
      WHEN 'INTERESTING'  THEN 'OBSERVED'
      WHEN 'SHORTLISTED'  THEN 'OBSERVED'
      WHEN 'DECISION'     THEN 'TRIAL'
      ELSE "stage"::text
    END
  )::"ProspectStage_new";

ALTER TABLE "Prospect" ALTER COLUMN "stage" SET DEFAULT 'DISCOVERED';

DROP TYPE "ProspectStage";
ALTER TYPE "ProspectStage_new" RENAME TO "ProspectStage";
