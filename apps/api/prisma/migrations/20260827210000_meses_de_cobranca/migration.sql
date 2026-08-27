-- O calendário de cobrança passa a ser do clube.
--
-- ## O que estava partido
--
-- `SubscriptionPlan.months` decidia em que meses uma mensalidade é emitida, e
-- nascia com um valor por omissão que exclui Agosto. Ninguém o escolheu, nada no
-- produto o mostrava, e nenhum ecrã o deixava mudar.
--
-- O efeito, num clube que começou a usar isto em Agosto: inscreve-se um atleta,
-- define-se o preço da equipa, e ele **não aparece em Mensalidades**. Sem erro,
-- sem aviso, sem linha nenhuma — porque a geração conta-o em `foraDoMes` e
-- segue. Passaram-se horas a procurar um bug que não existia: o produto estava a
-- cumprir uma regra que o clube nunca deu.
--
-- ## Porque é que sobe para a academia
--
-- Porque a pergunta é do clube e não do plano: "cobramos onze meses, de Setembro
-- a Julho". Estando por plano, cada equipa e cada acordo individual trazia a sua
-- cópia da regra — e um atleta com preço individual escapava ao calendário que a
-- direcção tinha configurado para a equipa, sem ninguém perceber porquê.
--
-- O valor por omissão é **o mesmo de sempre**, para nenhum clube mudar de
-- comportamento por causa desta migração. O que muda é passar a ser visível e
-- editável em Definições → Pagamentos.
--
-- `SubscriptionPlan.months` fica na tabela mas deixa de ser lido: é histórico do
-- que cada plano dizia, e o dia em que um plano precisar mesmo de calendário
-- próprio (uma inscrição trimestral) é aí que volta a ser consultado. Ver a nota
-- em `gerarCobrancas`.

ALTER TABLE "Academy"
  ADD COLUMN "billingMonths" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12];

-- Um clube que já tenha um plano com um calendário diferente do valor por
-- omissão fica com esse — é a regra que ele estava mesmo a usar, e não a que o
-- valor por omissão diz. Só se aplica quando todos os planos activos concordam;
-- se divergirem, fica o valor por omissão e a direcção decide no ecrã.
UPDATE "Academy" a
SET "billingMonths" = sub.months
FROM (
  SELECT DISTINCT ON (p."academyId") p."academyId", p.months
  FROM "SubscriptionPlan" p
  WHERE p."isActive"
  ORDER BY p."academyId", p.id
) sub
WHERE sub."academyId" = a.id
  AND NOT EXISTS (
    SELECT 1 FROM "SubscriptionPlan" q
    WHERE q."academyId" = a.id AND q."isActive" AND q.months::text <> sub.months::text
  );
