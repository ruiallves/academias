-- O site do clube: o domínio e o layout no clube, a configuração do site, e
-- as listas que o clube publica (notícias, patrocinadores, produtos, bilhetes
-- por jogo). Tudo novo e tudo opcional: nenhum clube muda de comportamento até
-- publicar o site. Ver `docs/08-site-do-clube.md`.

-- ---------------------------------------------------------------------------
-- O clube
-- ---------------------------------------------------------------------------

-- O domínio próprio do clube, sem `www.` e em minúsculas ("adfafe.pt"). Único:
-- um domínio é de um clube só, e é por ele que o site sabe de quem é o pedido.
ALTER TABLE "Academy" ADD COLUMN "siteDomain" TEXT;
CREATE UNIQUE INDEX "Academy_siteDomain_key" ON "Academy"("siteDomain");
-- Quando o registo do domínio tem de ser renovado. Só informativo, para o painel avisar.
ALTER TABLE "Academy" ADD COLUMN "siteDomainRenewsAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- A configuração do site: uma linha por clube
--
-- `published` a falso é o estado de todos os clubes: os endpoints públicos
-- respondem 404 a um clube que não publicou. Ninguém ganha um site público por
-- esta migração existir.
-- ---------------------------------------------------------------------------

CREATE TABLE "SiteConfig" (
  "academyId"  TEXT NOT NULL,
  "published"  BOOLEAN NOT NULL DEFAULT false,
  "layout"     TEXT NOT NULL DEFAULT 'classico',
  -- Lema, apresentação, história, fundação, morada, contactos e redes.
  "identity"   JSONB NOT NULL DEFAULT '{}',
  -- Por equipa: { visivel, plantel }. Sem entrada = aparece, sem plantel.
  "teams"      JSONB NOT NULL DEFAULT '{}',
  -- Os recintos vistos de cima (ver `packages/ui/src/estadio.tsx`).
  "venues"     JSONB NOT NULL DEFAULT '[]',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("academyId")
);
ALTER TABLE "SiteConfig"
  ADD CONSTRAINT "SiteConfig_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Notícias
-- ---------------------------------------------------------------------------

CREATE TABLE "SiteNews" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "summary"     TEXT NOT NULL DEFAULT '',
  "body"        TEXT NOT NULL DEFAULT '',
  "category"    TEXT NOT NULL DEFAULT 'Clube',
  "imageUrl"    TEXT,
  "featured"    BOOLEAN NOT NULL DEFAULT false,
  -- Nulo = rascunho. Posto ao publicar pela primeira vez.
  "publishedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteNews_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteNews_academyId_publishedAt_idx" ON "SiteNews"("academyId", "publishedAt");
ALTER TABLE "SiteNews"
  ADD CONSTRAINT "SiteNews_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Patrocinadores
-- ---------------------------------------------------------------------------

CREATE TABLE "SiteSponsor" (
  "id"        TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "url"       TEXT,
  "logoUrl"   TEXT,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteSponsor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteSponsor_academyId_position_idx" ON "SiteSponsor"("academyId", "position");
ALTER TABLE "SiteSponsor"
  ADD CONSTRAINT "SiteSponsor_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Produtos da loja
-- ---------------------------------------------------------------------------

CREATE TABLE "SiteProduct" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "category"    TEXT NOT NULL DEFAULT 'Equipamento',
  -- Em cêntimos, como o resto do dinheiro da plataforma.
  "priceCents"  INTEGER NOT NULL,
  "imageUrl"    TEXT,
  "description" TEXT NOT NULL DEFAULT '',
  -- "S, M, L, XL": vazio num produto sem tamanhos.
  "sizes"       TEXT NOT NULL DEFAULT '',
  "soldOut"     BOOLEAN NOT NULL DEFAULT false,
  "visible"     BOOLEAN NOT NULL DEFAULT true,
  "position"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteProduct_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteProduct_academyId_position_idx" ON "SiteProduct"("academyId", "position");
ALTER TABLE "SiteProduct"
  ADD CONSTRAINT "SiteProduct_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- A bilheteira de cada jogo
--
-- A venda em si (encomendas, pagamento, bilhetes com QR) ainda não existe:
-- isto é a configuração que o site mostra. `types` é a lista de tipos de
-- bilhete, cada um com nome, preço em cêntimos e bancada.
-- ---------------------------------------------------------------------------

CREATE TABLE "SiteMatchTickets" (
  "matchId"   TEXT NOT NULL,
  "academyId" TEXT NOT NULL,
  "open"      BOOLEAN NOT NULL DEFAULT false,
  "venueId"   TEXT,
  "capacity"  INTEGER,
  "note"      TEXT NOT NULL DEFAULT '',
  "types"     JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteMatchTickets_pkey" PRIMARY KEY ("matchId")
);
CREATE INDEX "SiteMatchTickets_academyId_idx" ON "SiteMatchTickets"("academyId");
ALTER TABLE "SiteMatchTickets"
  ADD CONSTRAINT "SiteMatchTickets_academyId_fkey"
  FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteMatchTickets"
  ADD CONSTRAINT "SiteMatchTickets_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: cada clube só vê o que é seu, como em todas as tabelas do clube
-- ---------------------------------------------------------------------------

ALTER TABLE "SiteConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteConfig";
CREATE POLICY tenant_isolation ON "SiteConfig"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SiteNews" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteNews" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteNews";
CREATE POLICY tenant_isolation ON "SiteNews"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SiteSponsor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteSponsor" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteSponsor";
CREATE POLICY tenant_isolation ON "SiteSponsor"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SiteProduct" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteProduct" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteProduct";
CREATE POLICY tenant_isolation ON "SiteProduct"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

ALTER TABLE "SiteMatchTickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteMatchTickets" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteMatchTickets";
CREATE POLICY tenant_isolation ON "SiteMatchTickets"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- ---------------------------------------------------------------------------
-- De que clube é um pedido ao site, sem sessão
--
-- Como `resolve_academy_by_slug`: uma função estreita, SECURITY DEFINER, que
-- só sabe devolver o id. Aceita o domínio com ou sem `www.`, e só responde por
-- clubes que publicaram o site e não estão cancelados.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app.resolve_site_by_domain(p_host text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT a.id
    FROM "Academy" a
    JOIN "SiteConfig" s ON s."academyId" = a.id
   WHERE a."siteDomain" = regexp_replace(lower(p_host), '^www\.', '')
     AND a.status <> 'CANCELLED'
     AND s.published
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION app.resolve_site_by_domain(text) TO academia_app;
