-- ---------------------------------------------------------------------------
-- O clube diz quando começa o período de uma categoria anual
-- ---------------------------------------------------------------------------
--
-- A `quota_mensal_ou_anual` trouxe a categoria anual com uma quota por época, e
-- fixou a época no código: de Agosto a Julho, para todos os clubes. Parecia a
-- escolha óbvia num produto de clubes desportivos, e é exactamente a que não
-- serve: uns clubes cobram ao ano civil (1 de Janeiro a 31 de Dezembro), outros
-- à época, outros a partir do mês em que a assembleia o decidiu. Quem sabe é o
-- clube.
--
-- `annualStartMonth` é o mês em que o período abre (1–12), por categoria. O
-- período começa no dia 1 desse mês e acaba um ano depois menos um dia — o
-- último dia do mês anterior, no ano seguinte: Janeiro dá "1 de Janeiro a 31 de
-- Dezembro", Agosto dá "1 de Agosto a 31 de Julho". Nada muda no formato das
-- quotas: o período de uma quota anual continua a ser `AAAA-MM`, o mês em que
-- abre. O que muda é qual.
--
-- Vem também a correcção de um erro que a janela fixa escondia: o prazo de uma
-- quota anual era o fim do mês em que a época abria, e quem entrava em Março
-- ficava "fora de prazo" no dia em que a quota nascia. Ver `prazoDaQuota`.
--
-- O que já existe fica em Agosto, que é o que era.

ALTER TABLE "MemberTier"
  ADD COLUMN IF NOT EXISTS "annualStartMonth" INTEGER NOT NULL DEFAULT 8;
