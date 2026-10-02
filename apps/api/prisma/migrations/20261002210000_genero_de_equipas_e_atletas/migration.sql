-- O género das equipas e o sexo dos atletas. Duas colunas novas, as duas
-- opcionais; nada do que existe muda.
--
-- A plataforma não distinguia equipas masculinas de femininas nem atletas de
-- atletas. A Certificação FPF precisa de saber (uma equipa feminina, ou 20
-- praticantes femininas, é condição das 5 estrelas), e estava a perguntá-lo ao
-- clube à mão, que é perguntar o que devia estar na ficha.
--
-- Ficam vazias por omissão: há modalidades onde a pergunta não se põe, e a
-- plataforma não adivinha o sexo de ninguém pelo nome.

CREATE TYPE "AthleteSex" AS ENUM ('FEMALE', 'MALE');
CREATE TYPE "TeamGender" AS ENUM ('MALE', 'FEMALE', 'MIXED');

ALTER TABLE "Athlete" ADD COLUMN "sex" "AthleteSex";
ALTER TABLE "Team" ADD COLUMN "gender" "TeamGender";

-- As equipas que já o dizem no nome ("Sub-15 Feminino", "Seniores Masculinos").
-- É a mesma regra de `generoPeloNome` em `teams.dto.ts`, que serve as equipas
-- criadas daqui em diante. O resto fica por indicar, e o clube escolhe.
UPDATE "Team" SET "gender" = 'FEMALE' WHERE "name" ~* 'femin';
UPDATE "Team" SET "gender" = 'MALE' WHERE "gender" IS NULL AND "name" ~* 'masc';
