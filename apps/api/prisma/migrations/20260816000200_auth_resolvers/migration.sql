-- Resolver o tenant antes de haver contexto de tenant
--
-- ## O ovo e a galinha
--
-- A tabela `Academy` tem RLS: `USING (id = app.current_academy_id())`. Mas para
-- pôr o contexto é preciso saber o id da academia, e para saber o id é preciso
-- lê-la pelo slug do subdomínio — que a RLS bloqueia. O pedido nunca arrancava.
--
-- A solução é a mesma do webhook de pagamentos: uma função `SECURITY DEFINER`
-- deliberadamente estreita. Esta só sabe traduzir um slug num id — não devolve o
-- nome, nem a cor, nem nada que se possa usar para enumerar academias com
-- proveito. Depois de ter o id, o servidor abre o contexto e tudo o resto passa
-- pela RLS normalmente.
--
-- A alternativa seria dar ao servidor uma ligação sem RLS "para o arranque", e
-- essa ligação acabaria a ser usada para tudo.

CREATE OR REPLACE FUNCTION app.resolve_academy_by_slug(p_slug text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM "Academy" WHERE slug = p_slug LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_academy_by_slug(text) TO academia_app;

/*
 * Identidade mínima de um utilizador do Supabase Auth, para o guard de
 * autenticação arrancar.
 *
 * Devolve as academias onde a pessoa tem membership activa. É o suficiente para
 * decidir a que tenant o pedido pertence quando não vem por subdomínio — e para
 * o ecrã de "escolher academia", quando alguém trabalha em duas.
 *
 * Continua a não revelar nada de dentro de nenhuma academia: só ids e papéis de
 * quem pergunta por si próprio.
 */
CREATE OR REPLACE FUNCTION app.resolve_memberships(p_auth_id text)
RETURNS TABLE (membership_id text, academy_id text, academy_slug text, academy_name text, role "Role", user_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT m.id, m."academyId", a.slug, a."shortName", m.role, u.id
  FROM "User" u
  JOIN "Membership" m ON m."userId" = u.id AND m."isActive"
  JOIN "Academy" a ON a.id = m."academyId"
  WHERE u."authId" = p_auth_id;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_memberships(text) TO academia_app;
