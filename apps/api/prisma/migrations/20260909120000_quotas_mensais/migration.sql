-- ---------------------------------------------------------------------------
-- Quotas de sócio são mensais — e só mensais.
--
-- A categoria tinha uma periodicidade (`MemberTier.period`: mensal,
-- trimestral, anual, uma vez), e a quota nascia no formato dela: `2026-09`,
-- `2026-T3`, `2026`, `vitalicia`. Parecia flexível; na prática partia tudo o
-- que se apoiava em "o mês": a ficha do sócio não conseguia dizer "está em dia
-- este mês", o ecrã de lançar quotas em atraso tinha de mudar de unidade
-- conforme a categoria (e para cinco das sete categorias do Life Club, anuais,
-- só deixava escolher o ano), e a app do sócio não tinha como oferecer "paga
-- até Julho".
--
-- O clube pensa em mensalidades — é a palavra que usa. O preço da categoria
-- passa a ser **por mês**, o período da quota é sempre `AAAA-MM`, e a coluna
-- vai-se embora em vez de ficar a `MONTHLY` para sempre como coluna-zombie.
--
-- O que já existe: as categorias anuais passam a mensais com o mesmo
-- `feeCents` — o clube revê o valor na ficha da categoria (30 €/ano não é
-- 30 €/mês). As quotas já lançadas com período anual ficam como histórico:
-- o rótulo diz o que eram, e a situação do sócio ignora-as ao procurar o mês
-- corrente.
-- ---------------------------------------------------------------------------

ALTER TABLE "MemberTier" DROP COLUMN "period";
DROP TYPE "MemberFeePeriod";

-- ---------------------------------------------------------------------------
-- O código QR do cartão de sócio fica desligado por omissão.
--
-- A app mostrava-o a todos os clubes desde o primeiro dia, e nenhum tem ainda
-- portaria a lê-lo. Um código que ninguém lê é um ecrã a mais. A opção
-- continua nas definições, para o clube que o quiser.
-- ---------------------------------------------------------------------------

ALTER TABLE "Academy" ALTER COLUMN "memberCardQrEnabled" SET DEFAULT false;
UPDATE "Academy" SET "memberCardQrEnabled" = false;
