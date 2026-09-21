-- O histórico tem de ser à prova de reescrita.
--
-- A migração anterior deu só SELECT e INSERT, mas o schema public tem um
-- default privilege do Supabase que dá arwd a academia_app em cada tabela
-- nova. O GRANT restrito somava-se a esse, e a aplicação ficava capaz de
-- editar e apagar linhas do histórico. Retira-se aqui, à mão.
REVOKE UPDATE, DELETE, TRUNCATE ON "ProfileChange" FROM academia_app;
