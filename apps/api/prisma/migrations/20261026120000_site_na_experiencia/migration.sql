-- ---------------------------------------------------------------------------
-- O site do clube também no período experimental.
--
-- Pedido do Rui a 26/10/2026: nos primeiros 30 dias um clube experimenta tudo,
-- incluindo o Connect Pro com o site, para ver como as coisas iam ficar.
--
-- Até aqui o site só existia com um plano que o incluísse
-- (`Plan.includesWebsite`). Passa a existir também enquanto a avaliação corre,
-- com as mesmas regras do painel (`estadoComercial` em
-- `apps/platform/src/lib/estado.ts`):
--
--   - `Academy.trialEndsAt` ainda no futuro;
--   - sem subscrição a pagar (ACTIVE ou PAST_DUE): quem já escolheu e paga um
--     plano tem o que o plano dá, mesmo antes de acabar a avaliação;
--   - clube não cancelado e não suspenso.
--
-- Quando a avaliação acaba sem o Connect Pro, o menu Website e o site público
-- desaparecem sozinhos, como num clube que desce de plano. O que o clube
-- montou fica guardado (SiteConfig, notícias, produtos) e volta se passar para
-- o Connect Pro.
--
-- Ligar um domínio próprio continua a exigir o plano (ver
-- `SiteDominioService.ligar`): o domínio regista-se e paga-se.
--
-- Só funções: nada nas tabelas. Pode aplicar-se antes ou depois do deploy.
-- ---------------------------------------------------------------------------

-- A regra antiga, com nome próprio: o site pelo plano, e só pelo plano.
CREATE OR REPLACE FUNCTION app.academy_website_by_plan(p_academy text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM "Subscription" s
      JOIN "Plan" p ON p.id = s."planId"
     WHERE s."academyId" = p_academy
       AND s.status <> 'CANCELLED'
       AND p."includesWebsite"
  );
$$;
GRANT EXECUTE ON FUNCTION app.academy_website_by_plan(text) TO academia_app;

-- O clube está em avaliação (os 30 dias), sem plano pago?
CREATE OR REPLACE FUNCTION app.academy_in_trial(p_academy text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM "Academy" a
     WHERE a.id = p_academy
       AND a."trialEndsAt" > now()
       AND a.status <> 'CANCELLED'
       AND a."suspendedAt" IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM "Subscription" s
          WHERE s."academyId" = a.id
            AND s.status IN ('ACTIVE', 'PAST_DUE')
       )
  );
$$;
GRANT EXECUTE ON FUNCTION app.academy_in_trial(text) TO academia_app;

-- Este clube tem o site? Pelo plano, ou porque ainda está a experimentar.
CREATE OR REPLACE FUNCTION app.academy_has_website(p_academy text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT app.academy_website_by_plan(p_academy) OR app.academy_in_trial(p_academy);
$$;
GRANT EXECUTE ON FUNCTION app.academy_has_website(text) TO academia_app;
