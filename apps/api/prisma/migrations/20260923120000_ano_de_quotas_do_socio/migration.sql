-- O ano de quotas passa a ser de cada sócio, e uma anuidade pode partir-se.
--
-- ## O que mudou, e porquê
--
-- A abertura anual era do clube: toda a gente era cobrada na mesma janela
-- (`Academy.memberAnnualStartMonth/Day`). Um clube explicou porque é que isso
-- não lhes serve: quem adere a 22 de Setembro quer o ano a correr de 22 de
-- Setembro, e só a 22 de Setembro do ano seguinte é que volta a ser avisado.
-- Com a janela do clube, quem entrava a meio comprava um ano que já ia a meio.
--
-- E a anuidade passa a poder ser partida: o sócio que quer pagar meio ano de
-- uma vez fica com duas quotas, cada uma com o seu intervalo e o seu valor
-- proporcional. Para isso a quota tem de saber o que cobre — o `period`
-- sozinho já não chega, porque duas partes do mesmo ano começam em meses
-- diferentes e nenhuma delas dura doze meses.
--
-- ## O que esta migração NÃO faz
--
-- Não mexe em nenhum sócio existente. `annualStartDay/Month` nulos querem dizer
-- "usa a abertura do clube", que é precisamente o comportamento de sempre: quem
-- já lá estava continua a ser cobrado na janela do clube até alguém lhe mudar a
-- data na ficha. A abertura do clube fica onde está e passa a ser o valor por
-- omissão.

-- ---------------------------------------------------------------------------
-- O ano de cada sócio
-- ---------------------------------------------------------------------------

ALTER TABLE "Member"
  ADD COLUMN "annualStartDay"   INTEGER,
  ADD COLUMN "annualStartMonth" INTEGER;

-- ---------------------------------------------------------------------------
-- O que cada quota cobre
-- ---------------------------------------------------------------------------

ALTER TABLE "MemberFee"
  ADD COLUMN "coversFrom" DATE,
  ADD COLUMN "coversTo"   DATE,
  ADD COLUMN "noticedAt"  TIMESTAMP(3);

/*
 * As quotas que já existem já foram anunciadas.
 *
 * Sem este carimbo, a varredura que passou a avisar as quotas cujo período
 * chegou olhava para o histórico inteiro do clube e mandava uma notificação por
 * cada quota antiga de cada sócio, na primeira passagem depois do deploy. Tem
 * de correr antes de o servidor novo subir, e é por isso que está aqui e não em
 * código.
 */
UPDATE "MemberFee" SET "noticedAt" = "createdAt" WHERE "noticedAt" IS NULL;

/*
 * As anuidades que já existem ganham o intervalo que sempre tiveram: um ano a
 * contar do dia de abertura do clube, no mês do período, menos um dia.
 *
 * ## Duas condições, e a segunda veio dos dados
 *
 * O **rótulo** ("Quota anual …", escrito pelo `novaQuota`) diz o que a quota era
 * quando nasceu. Só ele não chega: numa verificação à base antes de correr isto
 * apareceram dez quotas com esse rótulo em sócios cuja categoria é hoje
 * **mensal** — alguém trocou a categoria depois de a quota ter sido lançada.
 * Dar-lhes um intervalo punha a consola a oferecer "Dividir" numa quota de um
 * sócio que paga ao mês, que é uma porta para lado nenhum.
 *
 * Por isso exige-se também que a **categoria de hoje seja anual e esteja viva**,
 * que é exactamente como o servidor decide se um sócio é anual
 * (ver `billing` em `situacaoDeQuotas`). As que ficam de fora não perdem nada:
 * para um sócio mensal a cobertura nunca é lida, e se a categoria voltar a ser
 * anual o `coberturaDaQuota` deduz o ano a partir do período, como sempre fez.
 *
 * O dia é limitado a 28: um clube que abra a 31 e um período que caia em
 * Fevereiro dariam uma data que não existe. Nenhum clube usa isso hoje (a
 * omissão é 1), e quem usar acerta a data na ficha.
 */
UPDATE "MemberFee" f
SET "coversFrom" = d.inicio,
    "coversTo"   = (d.inicio + INTERVAL '1 year' - INTERVAL '1 day')::date
FROM (
  SELECT f2.id,
         make_date(
           split_part(f2.period, '-', 1)::int,
           split_part(f2.period, '-', 2)::int,
           LEAST(GREATEST(a."memberAnnualStartDay", 1), 28)
         ) AS inicio
  FROM "MemberFee" f2
  JOIN "Academy" a    ON a.id = f2."academyId"
  JOIN "Member" m     ON m.id = f2."memberId"
  JOIN "MemberTier" t ON t.id = m."tierId"
  WHERE f2.label LIKE 'Quota anual%'
    AND f2.period ~ '^[0-9]{4}-[0-9]{2}$'
    AND split_part(f2.period, '-', 2)::int BETWEEN 1 AND 12
    AND t.billing = 'ANNUAL'
    AND t."archivedAt" IS NULL
) d
WHERE f.id = d.id;

/*
 * Pelo intervalo é que se procura uma sobreposição ao lançar uma anuidade nova
 * (ver `assertSemSobreposicao`), e é por ele que a app ordena o que o sócio tem
 * a pagar.
 */
CREATE INDEX "MemberFee_memberId_coversFrom_idx" ON "MemberFee"("memberId", "coversFrom");
