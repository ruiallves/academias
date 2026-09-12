-- ---------------------------------------------------------------------------
-- A categoria de sócio escolhe: quota mensal ou anual
-- ---------------------------------------------------------------------------
--
-- ## Isto não é desfazer a `quotas_mensais`
--
-- A periodicidade por categoria já existiu (mensal, trimestral, anual, uma vez)
-- e foi removida por bons motivos, que estão escritos nessa migração: a quota
-- nascia no formato da categoria (`2026-09`, `2026-T3`, `2026`, `vitalicia`), a
-- ficha do sócio não sabia dizer "está em dia este mês", o ecrã de atrasos
-- mudava de unidade conforme a categoria, e a app não conseguia oferecer "paga
-- até Julho".
--
-- O que volta é mais estreito, e é por isso que não traz o problema de volta:
--
--   * só **mensal** ou **anual** — nada de trimestres nem de vitalícias;
--   * o período de uma quota continua a ser **sempre** `AAAA-MM`. Numa
--     categoria anual nasce **uma** quota por época, no mês em que a época
--     abre, com o rótulo a dizê-lo ("Quota anual 2026/27"). Não há formato
--     novo, e nenhum ecrã muda de unidade: muda o número de quotas por época.
--
-- ## O que acontece ao que já existe
--
-- Nada. Toda a gente fica `MONTHLY`, que é o que as categorias são hoje, e as
-- quotas já lançadas continuam a ser o que eram. Um clube que queira uma
-- categoria anual muda-a na ficha da categoria — e aí revê o valor, porque
-- 30 €/mês não é 30 €/ano.

CREATE TYPE "MemberFeeBilling" AS ENUM ('MONTHLY', 'ANNUAL');

ALTER TABLE "MemberTier"
  ADD COLUMN IF NOT EXISTS "billing" "MemberFeeBilling" NOT NULL DEFAULT 'MONTHLY';
