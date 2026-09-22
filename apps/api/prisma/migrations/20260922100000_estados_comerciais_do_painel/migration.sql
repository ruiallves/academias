-- Os estados comerciais do painel, contados onde eles vivem
--
-- ## O que estava errado
--
-- O cartão "Academias a pagar" dizia **1 a pagar, 0 em avaliação, 18 a montar**
-- num negócio em que ninguém paga ainda e estão todos a experimentar. Os três
-- números saíam de `Academy.status`, e `Academy.status` não responde a esta
-- pergunta.
--
-- Uma academia nasce em `SETUP` (ver `createAcademy`) e **nunca sai de lá
-- sozinha**: a única escrita nessa coluna é o botão de desactivar/reactivar
-- (`setAcademyActive`). Daí os três números: `trial` é sempre 0 porque nada
-- escreve `TRIAL`; `setup` é toda a gente; e o `1` em `ACTIVE` é um clube que
-- passou por uma desactivação e voltou depois do trial ter acabado, sem que
-- ninguém tenha decidido que ele paga.
--
-- O mesmo engano tinha outra vítima silenciosa: o aviso "Trial acaba em X dias"
-- dependia de `status = 'TRIAL'` e por isso **nunca apareceu**. Corrigido em
-- `alertsFrom`, do lado do TypeScript.
--
-- ## Onde é que o estado comercial vive
--
-- Em dois sítios, e é preciso os dois:
--
--  - `Subscription.status` diz se o clube paga. É o que o MRR já usa, e é por
--    isso que "a pagar" passa a sair daqui: os dois números da mesma linha do
--    painel têm de concordar por construção, não por coincidência.
--  - `Academy.trialEndsAt` diz se a avaliação ainda corre. É preciso porque a
--    esmagadora maioria dos clubes **não tem subscrição nenhuma**: "sem plano" é
--    a opção por omissão ao criar (ver `NewAcademyDialog`), e o clube abre com 30
--    dias a contar e sem linha em `Subscription`. Contar só subscrições deixava
--    esses mesmos 18 clubes a aparecer como zero.
--
-- `Academy.status` fica com o que é dele: o clube está aberto ou fechado.
--
-- ## Os três números são uma partição
--
-- Lêem-se numa linha só, e uma linha só lê-se como um todo que soma. Sobre os
-- clubes não cancelados:
--
--   a pagar        subscrição ACTIVE
--   em avaliação   não paga e o trial ainda corre
--   por decidir    não paga e o trial já acabou
--
-- mais `past_due` à parte, que tem alerta próprio. Somados dão o total de
-- clubes não cancelados, sem sobreposições.
--
-- ## "Por decidir" substitui "a montar"
--
-- Porque "a montar" era a etiqueta de `SETUP` e descrevia o que ninguém
-- perguntava. Um clube com o período experimental acabado e sem plano é a única
-- lista desta página que gera trabalho: é a quem se liga. Chamar-lhe "a montar"
-- escondia-o entre clubes que acabaram de abrir.
--
-- ## Porquê `CREATE OR REPLACE` e não `DROP`
--
-- Porque um `DROP FUNCTION` leva as permissões atrás, e esta função renasceria
-- aberta a `academia_app` — a ligação com que corre qualquer pedido de uma
-- academia, que não pode ver todas as outras. A assinatura fica igual à do
-- original de propósito, para o `REPLACE` ser possível. O `REVOKE` do fim é
-- cinto e suspensórios, e é de graça.

CREATE OR REPLACE FUNCTION app.platform_overview()
RETURNS TABLE (
  academies       int,
  setup           int,
  trial           int,
  active          int,
  past_due        int,
  cancelled       int,
  athletes        int,
  guardians       int,
  staff           int,
  mrr_cents       bigint,
  new_this_month  int,
  churn_this_month int
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    (SELECT count(*) FROM "Academy")::int,

    -- `setup` passou a ser "por decidir": não paga e já não está a experimentar.
    -- O nome da coluna fica para o `CREATE OR REPLACE` continuar a ser possível;
    -- o que ela quer dizer está aqui e no painel.
    (SELECT count(*) FROM "Academy" a
      LEFT JOIN "Subscription" s ON s."academyId" = a.id
     WHERE a.status <> 'CANCELLED'
       AND COALESCE(s.status::text, 'TRIALING') NOT IN ('ACTIVE', 'PAST_DUE')
       AND (a."trialEndsAt" IS NULL OR a."trialEndsAt" <= now()))::int,

    -- Em avaliação: o trial ainda corre e ninguém está a pagar. Sem subscrição
    -- conta na mesma, que é o caso da maioria.
    (SELECT count(*) FROM "Academy" a
      LEFT JOIN "Subscription" s ON s."academyId" = a.id
     WHERE a.status <> 'CANCELLED'
       AND COALESCE(s.status::text, 'TRIALING') NOT IN ('ACTIVE', 'PAST_DUE')
       AND a."trialEndsAt" > now())::int,

    -- A pagar: a mesma condição do MRR, para os dois números da linha nunca se
    -- desmentirem.
    (SELECT count(*) FROM "Academy" a
      JOIN "Subscription" s ON s."academyId" = a.id
     WHERE a.status <> 'CANCELLED' AND s.status = 'ACTIVE')::int,

    (SELECT count(*) FROM "Academy" a
      JOIN "Subscription" s ON s."academyId" = a.id
     WHERE a.status <> 'CANCELLED' AND s.status = 'PAST_DUE')::int,

    -- Cancelada continua a ser o clube fechado, e não a subscrição: é o número
    -- que o cartão "Academias" mostra ao lado do total.
    (SELECT count(*) FROM "Academy" WHERE status = 'CANCELLED')::int,

    (SELECT count(*) FROM "Athlete" WHERE status <> 'LEFT')::int,
    (SELECT count(DISTINCT m.id) FROM "Membership" m WHERE m.role = 'GUARDIAN' AND m."isActive")::int,
    (SELECT count(*) FROM "Membership" WHERE role NOT IN ('GUARDIAN','ATHLETE') AND "isActive")::int,
    -- MRR: só o que está mesmo a pagar. Trials e cancelados não contam — um MRR
    -- que inclui trials é um número que se acredita e depois não aparece no banco.
    -- O preço acordado com o clube manda; sem ele, a tabela do plano.
    COALESCE((
      SELECT sum(COALESCE(
        s."priceCents",
        p."amountCents" + p."perAthleteCents" * GREATEST(0, ath.n - p."includedAthletes")
      ))
      FROM "Subscription" s
      JOIN "Plan" p ON p.id = s."planId"
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS n FROM "Athlete" a WHERE a."academyId" = s."academyId" AND a.status <> 'LEFT'
      ) ath ON true
      WHERE s.status = 'ACTIVE'
    ), 0)::bigint,
    (SELECT count(*) FROM "Academy" WHERE "createdAt" >= date_trunc('month', now()))::int,
    (SELECT count(*) FROM "Subscription" WHERE "cancelledAt" >= date_trunc('month', now()))::int;
$$;

REVOKE ALL ON FUNCTION app.platform_overview() FROM PUBLIC, academia_app;
