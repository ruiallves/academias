-- Isolamento entre academias — Row Level Security
--
-- ## A armadilha que isto resolve
--
-- O `DATABASE_URL` que o Supabase dá por omissão liga-se como `postgres`, que é
-- superutilizador **e dono das tabelas**. Um superutilizador ignora RLS, e um dono
-- ignora-a também a menos que a tabela tenha `FORCE ROW LEVEL SECURITY`. Ou seja:
-- escrever políticas e ligar o Prisma com o URL por omissão dá uma sensação de
-- segurança e nenhuma segurança — as políticas existem e nunca correm.
--
-- Por isso esta migração faz três coisas, e as três são precisas:
--
--   1. cria um papel `academia_app` sem BYPASSRLS, para o Prisma usar;
--   2. liga RLS **e FORCE RLS** em todas as tabelas de domínio;
--   3. faz as políticas depender de `app.current_academy_id()`, que lê uma
--      variável de sessão posta pelo servidor a cada pedido.
--
-- ## Como o contexto chega aqui
--
-- `PrismaService.forAcademy()` abre uma transação e corre `SET LOCAL app.academy_id`.
-- `SET LOCAL` morre no fim da transação, o que é o que torna isto seguro com um
-- pool de ligações: a ligação seguinte não herda o tenant da anterior.
--
-- ## O que acontece sem contexto
--
-- `current_setting('app.academy_id', true)` devolve NULL, e `"academyId" = NULL`
-- é NULL — nenhuma linha passa. **Falha fechado**, que é a única omissão aceitável.

-- ---------------------------------------------------------------------------
-- Papel da aplicação
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'academia_app') THEN
    -- NOBYPASSRLS é a razão de este papel existir. Sem ele, tudo abaixo é decoração.
    CREATE ROLE academia_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO academia_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO academia_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO academia_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO academia_app;

-- ---------------------------------------------------------------------------
-- Contexto do pedido
-- ---------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS app;
GRANT USAGE ON SCHEMA app TO academia_app;

CREATE OR REPLACE FUNCTION app.current_academy_id() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.academy_id', true), '');
$$;

/*
 * Escotilha estreita para o webhook de pagamentos.
 *
 * Um webhook da euPago chega sem saber de que academia é — é precisamente o
 * pagamento que identifica o tenant. Esta função corre com os privilégios do dono
 * (SECURITY DEFINER) e só sabe fazer uma coisa: dada uma referência de pagamento,
 * devolver o id da academia. Não devolve o pagamento, nem o valor, nem nada mais.
 *
 * É a alternativa a dar ao servidor uma ligação sem RLS "para o caso de".
 */
CREATE OR REPLACE FUNCTION app.resolve_payment_academy(p_provider text, p_ref text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT c."academyId"
  FROM "Payment" p
  JOIN "Charge" c ON c.id = p."chargeId"
  WHERE p.provider = p_provider AND p."providerRef" = p_ref
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.current_academy_id() TO academia_app;
GRANT EXECUTE ON FUNCTION app.resolve_payment_academy(text, text) TO academia_app;

-- ---------------------------------------------------------------------------
-- Políticas — tabelas com `academyId` próprio
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'Sport', 'Season', 'Membership', 'Athlete', 'Team', 'TrainingSession',
    'SubscriptionPlan', 'Charge', 'Announcement', 'Notification', 'Evaluation',
    'ClinicalEntry', 'Match'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE: sem isto, o dono da tabela continuaria a ignorar as políticas.
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING ("academyId" = app.current_academy_id())
        WITH CHECK ("academyId" = app.current_academy_id())
    $p$, t);
  END LOOP;
END
$$;

-- A própria academia: vê-se a si mesma e a mais nenhuma.
ALTER TABLE "Academy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Academy" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Academy";
CREATE POLICY tenant_isolation ON "Academy"
  USING (id = app.current_academy_id())
  WITH CHECK (id = app.current_academy_id());

-- ---------------------------------------------------------------------------
-- Políticas — tabelas-filhas, que herdam o tenant do pai
-- ---------------------------------------------------------------------------
--
-- Custam uma subconsulta por linha. É deliberado: a alternativa é desnormalizar
-- `academyId` para todas elas, e uma coluna duplicada que possa divergir do pai é
-- pior do que uma junção — se divergir, a política passa a proteger a academia
-- errada, em silêncio.

DO $$
DECLARE
  spec record;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('GuardianLink',     'athleteId', 'Athlete'),
      ('TeamMembership',   'teamId',    'Team'),
      ('TeamStaff',        'teamId',    'Team'),
      ('AttendanceRecord', 'sessionId', 'TrainingSession'),
      ('Enrollment',       'athleteId', 'Athlete'),
      ('MatchCallUp',      'matchId',   'Match'),
      ('MatchAppearance',  'matchId',   'Match')
    ) AS s(child, fk, parent)
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', spec.child);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', spec.child);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', spec.child);
    EXECUTE format($p$
      CREATE POLICY tenant_isolation ON %I
        USING (EXISTS (
          SELECT 1 FROM %I p
          WHERE p.id = %I.%I AND p."academyId" = app.current_academy_id()
        ))
        WITH CHECK (EXISTS (
          SELECT 1 FROM %I p
          WHERE p.id = %I.%I AND p."academyId" = app.current_academy_id()
        ))
    $p$, spec.child, spec.parent, spec.child, spec.fk,
         spec.parent, spec.child, spec.fk);
  END LOOP;
END
$$;

-- Payment liga-se à academia através de Charge.
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Payment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Payment";
CREATE POLICY tenant_isolation ON "Payment"
  USING (EXISTS (
    SELECT 1 FROM "Charge" c
    WHERE c.id = "Payment"."chargeId" AND c."academyId" = app.current_academy_id()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "Charge" c
    WHERE c.id = "Payment"."chargeId" AND c."academyId" = app.current_academy_id()
  ));

-- ---------------------------------------------------------------------------
-- Tabelas deliberadamente globais
-- ---------------------------------------------------------------------------
--
--   User             uma pessoa pode pertencer a várias academias; é a Membership
--                    que a liga a cada uma, e essa tem RLS.
--   PushSubscription pertence ao User, não à academia — o mesmo telemóvel recebe
--                    notificações de duas academias se a família tiver filhos em
--                    ambas.
--   WebhookEvent     chega antes de se saber o tenant. É por isso que existe
--                    `app.resolve_payment_academy`.
--
-- Não levam política de academia. O acesso a elas é limitado no serviço.

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS same_academy_users ON "User";
-- Um utilizador é visível se partilhar academia com o contexto actual.
CREATE POLICY same_academy_users ON "User"
  USING (EXISTS (
    SELECT 1 FROM "Membership" m
    WHERE m."userId" = "User".id AND m."academyId" = app.current_academy_id()
  ))
  WITH CHECK (true);
