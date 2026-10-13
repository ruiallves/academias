-- O plano Connect Pro: tudo o que está no Connect, mais o site do clube.
--
-- Até aqui o plano de um clube não ligava nem desligava nada: servia a
-- faturação e o painel. O site do clube é a primeira coisa que depende dele,
-- e por isso o plano ganha uma marca (`includesWebsite`) e a base ganha uma
-- função estreita que responde "este clube tem o site?". As tabelas dos planos
-- continuam fechadas ao `academia_app` (ver `20260816000600_platform`): a
-- função é SECURITY DEFINER e só devolve o sim ou não.

ALTER TABLE "Plan" ADD COLUMN "includesWebsite" BOOLEAN NOT NULL DEFAULT false;

-- O preço é o de partida e muda-se aqui ou por clube no painel (preço acordado).
INSERT INTO "Plan" (id, name, tagline, "amountCents", "perAthleteCents", "includedAthletes", "trialDays",
                    features, excludes, "isRecommended", "order", "isActive", "includesWebsite", "updatedAt")
VALUES (
  'plan_connect_pro',
  'Connect Pro',
  'Tudo o que está no Connect, mais o site do clube com domínio próprio.',
  2999, 0, 0, 30,
  ARRAY[
    'Tudo o que está no Connect',
    'Website próprio com domínio .pt incluído',
    'Notícias, equipas, calendário e contactos',
    'Loja online e gestão de encomendas',
    'Bilheteira digital com códigos QR',
    'Alojamento, SSL e manutenção técnica'
  ],
  ARRAY[]::text[],
  false, 3, true, true, now()
)
ON CONFLICT (id) DO UPDATE SET "includesWebsite" = true;

-- ---------------------------------------------------------------------------
-- Este clube tem o site?
--
-- Pelo plano da subscrição, enquanto ela não estiver cancelada. Um clube que
-- desce de plano perde o site sem ninguém o ter de desligar à mão; um clube
-- suspenso por falta de pagamento já está fechado por outro lado.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.academy_has_website(p_academy text) RETURNS boolean
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
GRANT EXECUTE ON FUNCTION app.academy_has_website(text) TO academia_app;

-- O domínio só resolve para clubes com o site no plano (e publicado).
CREATE OR REPLACE FUNCTION app.resolve_site_by_domain(p_host text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.id
    FROM "Academy" a
    JOIN "SiteConfig" s ON s."academyId" = a.id
   WHERE a."siteDomain" = regexp_replace(lower(p_host), '^www\.', '')
     AND a.status <> 'CANCELLED'
     AND s.published
     AND app.academy_has_website(a.id)
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION app.resolve_site_by_domain(text) TO academia_app;
