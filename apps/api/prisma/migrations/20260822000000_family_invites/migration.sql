-- O link que traz as famílias para a app
--
-- Ver `docs/03-estado.md` e o serviço `family-invites.service.ts`.
--
-- ## As duas peças, e porque é que são duas
--
-- 1. `Athlete.taxId` — o NIF do atleta. É a prova de parentesco: um pai que chega
--    pelo link identifica o filho por **NIF + data de nascimento**, os dois, nunca
--    um só. O NIF sozinho é adivinhável por quem trabalhe num intervalo de nove
--    dígitos; com a data de nascimento a acompanhar, deixa de ser.
--
-- 2. `FamilyInvite` — a autorização para a academia aceitar auto-registo. Um link
--    por academia, reutilizável, partilhável no grupo de WhatsApp dos pais.
--
-- ## O que o link vale, dito com clareza
--
-- **Nada, sozinho.** Abre um formulário. Quem o tiver e não souber o NIF e a data
-- de nascimento de um atleta desta academia não fica ligado a ninguém. É por isso
-- que pode ser partilhado, e é por isso que o token está aqui em claro e não em
-- SHA-256 como o do `StaffInvite`: aquele decide acessos e mostra-se uma vez; este
-- abre uma porta com fechadura do outro lado, e a secretaria tem de o poder copiar
-- outra vez amanhã.
--
-- A defesa a sério contra quem tente adivinhar pares NIF+data está do lado da API:
-- limite de tentativas por IP e por link. Sem isso, isto seria um oráculo.

-- ---------------------------------------------------------------------------
-- NIF do atleta
-- ---------------------------------------------------------------------------

ALTER TABLE "Athlete" ADD COLUMN "taxId" TEXT;

-- Único **por academia** e não global: o mesmo NIF em duas academias diferentes é
-- a mesma criança em dois clubes, o que é normal. Duas vezes na mesma academia é
-- sempre engano — e um engano que faria um pai cair no educando errado.
-- Em Postgres, `NULL` não colide com `NULL`, por isso atletas sem NIF convivem.
CREATE UNIQUE INDEX "Athlete_academyId_taxId_key" ON "Athlete"("academyId", "taxId");

-- ---------------------------------------------------------------------------
-- O convite
-- ---------------------------------------------------------------------------

CREATE TABLE "FamilyInvite" (
  "id"          TEXT NOT NULL,
  "academyId"   TEXT NOT NULL,
  "token"       TEXT NOT NULL,
  "expiresAt"   TIMESTAMP(3),
  "usedCount"   INTEGER NOT NULL DEFAULT 0,
  "lastUsedAt"  TIMESTAMP(3),
  "createdById" TEXT,
  "revokedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FamilyInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FamilyInvite_token_key" ON "FamilyInvite"("token");
CREATE INDEX "FamilyInvite_academyId_revokedAt_idx" ON "FamilyInvite"("academyId", "revokedAt");

ALTER TABLE "FamilyInvite"
  ADD CONSTRAINT "FamilyInvite_academyId_fkey"   FOREIGN KEY ("academyId")   REFERENCES "Academy"("id")    ON DELETE CASCADE  ON UPDATE CASCADE,
  -- `SET NULL`: o link sobrevive a quem sair da secretaria. Fechá-lo por alguém
  -- ter mudado de emprego seria fechar a porta às famílias sem ninguém perceber.
  ADD CONSTRAINT "FamilyInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- RLS: tem `academyId`, isola-se como o resto do domínio
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON "FamilyInvite" TO academia_app;

ALTER TABLE "FamilyInvite" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FamilyInvite" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FamilyInvite";
CREATE POLICY tenant_isolation ON "FamilyInvite"
  USING ("academyId" = app.current_academy_id())
  WITH CHECK ("academyId" = app.current_academy_id());

-- ---------------------------------------------------------------------------
-- A escotilha: do token para a academia
-- ---------------------------------------------------------------------------

/*
 * Gémea de `app.resolve_invite`, e existe pela mesma razão: quem chega pelo link
 * ainda não tem sessão, logo não há contexto de tenant para a RLS filtrar — e sem
 * contexto não há sequer forma de descobrir a que academia o link pertence.
 *
 * Estreita de propósito. Recebe um token, devolve um `academyId` **ou nada**. Não
 * lê o convite, não diz quantos usos teve, não distingue "não existe" de "expirou"
 * — as três respostas são o mesmo silêncio, porque distingui-las só ajudaria quem
 * estivesse a sondar tokens.
 *
 * A partir do id devolvido, o serviço abre o contexto e o resto do trabalho corre
 * com RLS normal, como qualquer pedido de academia.
 */
CREATE OR REPLACE FUNCTION app.resolve_family_invite(p_token text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT "academyId"
  FROM "FamilyInvite"
  WHERE token = p_token
    AND "revokedAt" IS NULL
    -- Nulo é "sem prazo": uma escolha de quem o criou, e não um esquecimento.
    AND ("expiresAt" IS NULL OR "expiresAt" > now())
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.resolve_family_invite(text) TO academia_app;

/*
 * Encontrar o educando pelo NIF e pela data de nascimento.
 *
 * ## Porque é que isto é uma função e não uma query
 *
 * Porque corre **antes** de existir sessão: quem se está a registar não tem
 * membership nenhuma, logo a RLS de `Athlete` recusaria tudo. A alternativa era
 * abrir contexto de tenant a partir do token e consultar à vontade — e isso daria
 * ao mesmo caminho a capacidade de **listar** atletas, que é precisamente o que
 * não pode acontecer.
 *
 * Esta devolve **um** id, e só quando as duas provas batem certo. Não aceita
 * pesquisa por nome, não devolve listas, não confirma NIFs sem a data. Um atacante
 * com o link nas mãos e sem os dados da criança não tira daqui nada.
 *
 * O `p_academy_id` vem de `app.resolve_family_invite` — não é escolhido por quem
 * chama: um id de outra academia devolve vazio na mesma, porque o `WHERE` cruza os
 * dois.
 */
CREATE OR REPLACE FUNCTION app.match_athlete_for_family(
  p_academy_id text,
  p_tax_id     text,
  p_birthdate  date
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM "Athlete"
  WHERE "academyId" = p_academy_id
    AND "taxId" = p_tax_id
    AND birthdate = p_birthdate
    -- Quem já saiu não se reclama. Uma família que saiu do clube não volta a
    -- ganhar acesso por o NIF continuar na base.
    AND status <> 'LEFT'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.match_athlete_for_family(text, text, date) TO academia_app;
