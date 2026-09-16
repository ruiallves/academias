-- ---------------------------------------------------------------------------
-- O mês em que o período anual abre passa a ser do clube
-- ---------------------------------------------------------------------------
--
-- A `inicio_do_periodo_anual` pôs o mês de abertura na categoria. Era
-- flexibilidade a mais para uma coisa que um clube decide uma vez, em
-- assembleia: o ano de quotas começa a 1 de Janeiro, ou a 1 de Agosto, para
-- toda a gente. Duas categorias anuais em janelas diferentes eram um convite a
-- dois livros — e a pergunta "em que mês abre?" tinha de se responder em cada
-- categoria, quando a resposta é uma só.
--
-- Passa para `Academy.memberAnnualStartMonth`, e vale para todas as categorias
-- anuais do clube. A regra não muda: começa no dia 1 desse mês e acaba um ano
-- depois menos um dia.
--
-- O arranque: cada clube fica com o mês que as suas categorias anuais tinham
-- (eram todas 8, o Agosto de sempre); sem categorias anuais, 8.

ALTER TABLE "Academy"
  ADD COLUMN IF NOT EXISTS "memberAnnualStartMonth" INTEGER NOT NULL DEFAULT 8;

UPDATE "Academy" a
   SET "memberAnnualStartMonth" = COALESCE(
         (SELECT MIN(t."annualStartMonth") FROM "MemberTier" t
           WHERE t."academyId" = a.id AND t.billing = 'ANNUAL' AND t."archivedAt" IS NULL),
         8
       );

ALTER TABLE "MemberTier" DROP COLUMN IF EXISTS "annualStartMonth";
