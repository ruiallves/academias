-- Encomendas: referência única e mudanças de estado registadas (15/11/2026).
--
-- 1. `SiteOrder.reference`: o número da encomenda (n.º 42) é seguido por
--    clube, e dois clubes têm cada um a sua n.º 1. A referência é única em
--    toda a plataforma ("ENC-7K2F-9QXA"), sem 0/O nem 1/I para se ditar ao
--    telefone, e é o que se procura quando alguém liga. As encomendas que já
--    existem ganham uma aqui; as novas nascem com ela (`referenciaNova`).
--
-- 2. `SiteOrderEvent`: o clube passa a poder mudar uma encomenda para
--    qualquer passo do percurso, para a frente e para trás (marcou pronta por
--    engano, o cliente afinal não levantou). Voltar atrás apaga as datas dos
--    passos seguintes, e sem um registo à parte perdia-se quem mudou o quê e
--    quando. Cada mudança fica aqui, com o autor.
--
-- Aditiva e segura antes do deploy: a API antiga não lê nenhuma das duas, e
-- cria encomendas sem referência; a coluna tem por omissão uma referência
-- gerada pela base (`app.nova_referencia_encomenda()`), por isso essas
-- encomendas nascem com ela na mesma.

-- 1. A referência -------------------------------------------------------------

-- Oito caracteres do alfabeto sem ambiguidade (o mesmo dos identificadores de
-- pagamento), tirados de bytes aleatórios do gen_random_uuid.
CREATE OR REPLACE FUNCTION app.nova_referencia_encomenda() RETURNS TEXT
LANGUAGE sql VOLATILE AS $$
  SELECT 'ENC-' || substr(s, 1, 4) || '-' || substr(s, 5, 4)
  FROM (
    SELECT string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (get_byte(b, i) % 32) + 1, 1), '' ORDER BY i) AS s
    FROM (SELECT decode(replace(gen_random_uuid()::text, '-', ''), 'hex') AS b) x, generate_series(0, 7) AS i
  ) y
$$;
GRANT EXECUTE ON FUNCTION app.nova_referencia_encomenda() TO academia_app;

ALTER TABLE "SiteOrder" ADD COLUMN IF NOT EXISTS "reference" TEXT;
UPDATE "SiteOrder" SET "reference" = app.nova_referencia_encomenda() WHERE "reference" IS NULL;
ALTER TABLE "SiteOrder" ALTER COLUMN "reference" SET DEFAULT app.nova_referencia_encomenda();
ALTER TABLE "SiteOrder" ALTER COLUMN "reference" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "SiteOrder_reference_key" ON "SiteOrder"("reference");

-- 2. O registo das mudanças ---------------------------------------------------

CREATE TABLE IF NOT EXISTS "SiteOrderEvent" (
    "id" TEXT NOT NULL,
    "academyId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "fromStatus" "SiteOrderStatus",
    "toStatus" "SiteOrderStatus" NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteOrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SiteOrderEvent_orderId_createdAt_idx" ON "SiteOrderEvent"("orderId", "createdAt");
CREATE INDEX IF NOT EXISTS "SiteOrderEvent_academyId_idx" ON "SiteOrderEvent"("academyId");

ALTER TABLE "SiteOrderEvent" DROP CONSTRAINT IF EXISTS "SiteOrderEvent_academyId_fkey";
ALTER TABLE "SiteOrderEvent" ADD CONSTRAINT "SiteOrderEvent_academyId_fkey" FOREIGN KEY ("academyId") REFERENCES "Academy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SiteOrderEvent" DROP CONSTRAINT IF EXISTS "SiteOrderEvent_orderId_fkey";
ALTER TABLE "SiteOrderEvent" ADD CONSTRAINT "SiteOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SiteOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: cada clube só vê o registo das suas encomendas, como na encomenda.
ALTER TABLE "SiteOrderEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SiteOrderEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SiteOrderEvent";
CREATE POLICY tenant_isolation ON "SiteOrderEvent"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- Só se acrescenta: o registo não se corrige nem se apaga pela API. O REVOKE
-- não é zelo a mais: os privilégios por omissão do esquema dão tudo a
-- academia_app em cada tabela nova, e sem ele o DELETE passava (visto no
-- ensaio de 15/11/2026; o mesmo que `20260920163000_historico_so_escreve`).
GRANT SELECT, INSERT ON "SiteOrderEvent" TO academia_app;
REVOKE UPDATE, DELETE, TRUNCATE ON "SiteOrderEvent" FROM academia_app;
