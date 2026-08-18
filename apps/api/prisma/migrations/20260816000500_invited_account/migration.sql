-- Descobrir se quem foi convidado já tem conta
--
-- ## Porque é que isto não se consegue perguntar directamente
--
-- `User` tem a política `same_academy_users`: vejo-te se partilharmos academia. Ao
-- resgatar um convite isso falha nos dois sentidos que interessam:
--
--   - **sem contexto de tenant** — `app.current_academy_id()` é NULL e não aparece
--     ninguém, por isso quem já tem conta é tratado como conta nova;
--   - **com o contexto desta academia** — um treinador que trabalhe noutro clube e
--     ainda não tenha membership aqui também não aparece, e cair-se-ia a tentar
--     criar-lhe uma conta que já existe.
--
-- Nos dois casos o resultado é o mesmo e é mau: o servidor tenta criar conta nova
-- no Supabase, o Supabase recusa porque o email já existe, e a pessoa vê "não foi
-- possível criar a conta" sem perceber porquê.
--
-- ## A escotilha
--
-- Esta função não pergunta "este email tem conta?" — pergunta "o convite deste
-- token pertence a alguém que já tem conta?". A diferença é tudo: só responde a
-- quem já tem nas mãos um token válido, por convite, e devolve um `authId` opaco.
-- Não serve para enumerar utilizadores, que é o que uma função por email seria.

CREATE OR REPLACE FUNCTION app.invited_account(p_token_hash text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u."authId"
  FROM "StaffInvite" i
  JOIN "User" u ON lower(u.email) = lower(i.email)
  WHERE i."tokenHash" = p_token_hash
    AND i."acceptedAt" IS NULL
    AND i."revokedAt" IS NULL
    AND i."expiresAt" > now()
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.invited_account(text) TO academia_app;
