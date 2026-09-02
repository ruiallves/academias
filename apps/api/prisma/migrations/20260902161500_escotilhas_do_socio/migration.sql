-- ---------------------------------------------------------------------------
-- As escotilhas do sócio
-- ---------------------------------------------------------------------------
--
-- Duas funções estreitas, pelo mesmo motivo das outras `app.resolve_*`: o
-- pedido chega antes de haver contexto de tenant, e a RLS — correctamente —
-- não deixa ler nada.
--
--   1. `resolve_user_by_auth`: um sócio sem vínculo de família não tem
--      `Membership` nenhuma, por isso `app.resolve_memberships` volta vazio e
--      não há de onde tirar o `User.id`. Esta devolve **só o id** — nem nome,
--      nem email: o resto lê-se depois, já dentro do tenant.
--
--   2. `resolve_member_invite`: do hash do token do convite para o par
--      (sócio, academia) — é o que permite abrir o convite sem sessão. Devolve
--      ids e mais nada; a ficha lê-se dentro de `runAs`, onde a RLS vale.

CREATE OR REPLACE FUNCTION app.resolve_user_by_auth(p_auth_id text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM "User" WHERE "authId" = p_auth_id LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app.resolve_member_invite(p_token_hash text)
RETURNS TABLE(member_id text, academy_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id, "academyId" FROM "Member" WHERE "inviteTokenHash" = p_token_hash LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_user_by_auth(text) TO academia_app;
GRANT EXECUTE ON FUNCTION app.resolve_member_invite(text) TO academia_app;
