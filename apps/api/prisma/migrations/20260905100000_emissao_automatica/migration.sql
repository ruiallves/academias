-- As mensalidades do mês emitem-se sozinhas.
--
-- ## O que mudou
--
-- Até aqui, no dia 1 não acontecia nada: a emissão tinha três portas — o botão
-- "Gerar mensalidades", gravar o calendário de cobrança, e definir um preço — e
-- todas exigiam alguém a carregar. Um presidente que se esquecesse duas semanas
-- deixava as famílias duas semanas sem mensalidade na app e sem aviso, com o
-- vencimento do clube a passar pelo meio.
--
-- Agora o servidor varre os clubes de hora a hora e garante o período corrente.
-- A varredura é inofensiva por construção: `gerarCobrancas` só cria o que falta
-- e nunca reescreve o que existe, por isso a primeira passagem do mês emite e
-- as seguintes não fazem nada.
--
-- ## Porque é que isto precisa de uma função
--
-- A varredura corre fora de qualquer pedido — não há academia no contexto — e a
-- RLS não deixa `academia_app` ler `Academy` sem `app.academy_id`. É a mesma
-- situação do webhook de pagamentos e da reconciliação, e a resposta é a mesma:
-- uma escotilha estreita que só sabe devolver **ids de academias**, nem nomes
-- nem contactos nem nada mais. Com o id na mão, tudo o resto corre dentro de
-- `runAs`, com a RLS de sempre.
--
-- ## Quem entra
--
-- Todos menos os cancelados. Não é `status = 'ACTIVE'` de propósito: no estado
-- real da base há dezoito clubes em `SETUP` — com atletas, famílias e
-- pagamentos a sério — e um só em `ACTIVE`. `SETUP` diz que o onboarding ficou
-- por fechar, não que o clube não está a ser usado; filtrar por `ACTIVE` seria
-- entregar a funcionalidade a um clube e negá-la a dezoito. Um clube
-- `CANCELLED` é o único que não deve receber cobranças novas.

CREATE OR REPLACE FUNCTION app.academies_for_billing()
RETURNS TABLE (academy_id text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM "Academy"
  WHERE status <> 'CANCELLED'
  ORDER BY "createdAt";
$$;

REVOKE ALL ON FUNCTION app.academies_for_billing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.academies_for_billing() TO academia_app;
