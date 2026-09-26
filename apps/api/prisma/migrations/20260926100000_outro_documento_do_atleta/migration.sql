-- Outro documento de identificação do atleta, para quem não tem NIF.
--
-- Há clubes com atletas estrangeiros sem NIF português. Até aqui o NIF era
-- obrigatório em toda a inscrição, e era também a prova com que a família
-- reclamava o filho na app. Passa a valer o NIF **ou** outro documento: o clube
-- guarda o nome do documento (só para si) e o número; a família identifica o
-- filho pelo número e pela data de nascimento, como fazia com o NIF.
--
-- Não mexe em nenhum atleta existente: as duas colunas nascem nulas.

ALTER TABLE "Athlete"
  ADD COLUMN "idDocLabel"  TEXT,
  ADD COLUMN "idDocNumber" TEXT;

-- Único por academia, como o NIF: dois atletas com o mesmo documento é sempre
-- engano, e faria um pai cair no educando errado.
CREATE UNIQUE INDEX "Athlete_academyId_idDocNumber_key" ON "Athlete"("academyId", "idDocNumber");

/*
 * Encontrar o educando pelo outro documento e pela data de nascimento.
 *
 * O gémeo de `app.match_athlete_for_family` (migração
 * `20260822000000_family_invites`), com as mesmas regras: corre antes de haver
 * sessão, devolve **um** id ou nada, nunca lista nem confirma um número sem a
 * data, e ignora quem já saiu.
 */
CREATE OR REPLACE FUNCTION app.match_athlete_by_document(
  p_academy_id text,
  p_doc_number text,
  p_birthdate  date
)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id
  FROM "Athlete"
  WHERE "academyId" = p_academy_id
    AND "idDocNumber" = p_doc_number
    AND birthdate = p_birthdate
    AND status <> 'LEFT'
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION app.match_athlete_by_document(text, text, date) TO academia_app;
