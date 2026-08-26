-- Uma academia cancelada deixa de abrir
--
-- ## O que faltava
--
-- `AcademyStatus.CANCELLED` existia e não fazia nada: o resolvedor de slug
-- devolvia o id na mesma, e quem tivesse membership continuava a entrar na
-- consola. Cancelar era uma etiqueta no painel, não uma porta fechada.
--
-- ## Porque é que se fecha aqui e não no serviço
--
-- Porque este resolvedor é o funil por onde **tudo** passa: o guard de
-- autenticação, a landing do clube, a página de adesão a sócio, os convites.
-- Fechá-lo num sítio fecha os quatro de uma vez, sem uma consulta a mais em cada
-- pedido — e sem depender de alguém se lembrar de repetir o `if`.
--
-- `PAST_DUE` continua a entrar, de propósito: um pagamento falhado resolve-se
-- com um telefonema, e trancar o clube fora do produto a meio de uma época é a
-- forma mais rápida de o perder de vez. É `CANCELLED` que fecha, e só ele.

CREATE OR REPLACE FUNCTION app.resolve_academy_by_slug(p_slug text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM "Academy" WHERE slug = p_slug AND status <> 'CANCELLED' LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_academy_by_slug(text) TO academia_app;
