-- Criar o utilizador de quem aceita um convite
--
-- ## O problema, que é o mesmo de sempre com outra roupa
--
-- A política de `User` é `same_academy_users`: um utilizador vê-se se partilhar
-- academia com o contexto actual. Faz sentido — e torna impossível criar o
-- primeiro registo de alguém.
--
-- Ao aceitar um convite a ordem obrigatória é: criar o `User`, depois a
-- `Membership` que o liga à academia. Mas o `User` só passa a ser visível **depois**
-- da Membership existir, e qualquer `INSERT ... RETURNING` precisa de ler a linha
-- que acabou de escrever. O Prisma usa sempre `RETURNING`. Resultado:
--
--     new row violates row-level security policy for table "User"
--
-- E não é um falso alarme do Prisma: um `INSERT` sem `RETURNING` passa, com
-- `RETURNING` falha. A política está a fazer o que foi escrita para fazer.
--
-- ## A saída
--
-- A mesma de `resolve_academy_by_slug` e `resolve_payment_academy`: uma função
-- `SECURITY DEFINER` deliberadamente estreita. Esta só sabe criar (ou actualizar)
-- **um** utilizador e devolver o id. Não lê utilizadores, não os lista, não aceita
-- filtros. Quem a chamar sem um convite válido nas mãos não ganha nada com ela:
-- para lá chegar é preciso já ter passado por `app.resolve_invite`, que exige o
-- token em claro.
--
-- A alternativa era dar ao servidor uma ligação sem RLS para o resgate — e essa
-- ligação acabaria, como sempre acabam, a ser usada para tudo.

CREATE OR REPLACE FUNCTION app.upsert_invited_user(
  p_id      text,
  p_auth_id text,
  p_email   text,
  p_name    text,
  p_phone   text
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id text;
BEGIN
  INSERT INTO "User" (id, "authId", email, name, phone, "updatedAt")
  VALUES (p_id, p_auth_id, p_email, p_name, p_phone, now())
  ON CONFLICT ("authId") DO UPDATE
    SET email       = EXCLUDED.email,
        name        = EXCLUDED.name,
        -- Um telemóvel em branco não apaga o que já lá estava: quem já tinha conta
        -- pode aceitar um convite sem voltar a escrever o contacto.
        phone       = COALESCE(EXCLUDED.phone, "User".phone),
        "updatedAt" = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION app.upsert_invited_user(text, text, text, text, text) TO academia_app;
