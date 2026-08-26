-- Alinhar a base com o `schema.prisma`.
--
-- Quatro diferenças, apanhadas pelo `npm run check:schema` mal ele existiu.
-- Nenhuma vinha da mudança do escalão: estavam todas lá antes, caladas, porque
-- nada as procurava.
--
-- Duas eram do **schema** e não da base — índices que existiam na base, criados
-- por migrações a sério, e que o `schema.prisma` não declarava
-- (`Membership_customRoleId_idx`, de `20260822000000_academy_roles`;
-- `AcademyRole_departmentId_idx`, de `20260826230000_departamentos`). O
-- `migrate diff` propunha largá-los; largá-los era o caminho errado, porque os
-- dois servem consultas que o produto faz — os cargos de um departamento, e
-- quantas pessoas têm um cargo. Resolveram-se a declará-los no schema, sem
-- tocar na base.
--
-- As duas que ficam são estas.

-- ---------------------------------------------------------------------------
-- 1. A coluna do departamento antigo, em `AcademyRole`.
--
-- `20260826230000_departamentos` criou a tabela `Department`, converteu os
-- valores do enum em linhas e ligou `AcademyRole.departmentId` — mas nunca
-- largou a coluna `department` que ficou para trás. O `schema.prisma` deixou de
-- a declarar nesse dia; a base ficou com ela mais um mês.
--
-- Verificado antes de largar: dos cargos existentes, os três que tinham
-- `department` preenchido (DIRECTION, TECHNICAL, CLINICAL) apontam todos para o
-- `departmentId` correspondente, e não existe nenhum `OPERATIONS` — que é o
-- único valor do enum que o `CASE` daquela migração não convertia, e o único
-- que teria perdido informação aqui.

ALTER TABLE "AcademyRole" DROP COLUMN "department";

-- ---------------------------------------------------------------------------
-- 2. O índice de jogos por equipa e data.
--
-- Declarado no `schema.prisma` (`@@index([teamId, startsAt])` em `Match`) e
-- nunca criado: `20260821000100_cancelled_match_frees_slot` escreveu à mão o
-- índice **único parcial** — o que impede dois jogos não cancelados no mesmo
-- horário — e o índice normal de leitura ficou pelo caminho.
--
-- Serve o calendário e a lista de jogos de uma equipa, que é a consulta mais
-- frequente do ecrã de Convocatórias.

CREATE INDEX IF NOT EXISTS "Match_teamId_startsAt_idx" ON "Match"("teamId", "startsAt");
