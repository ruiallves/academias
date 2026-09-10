-- ---------------------------------------------------------------------------
-- A convocatória ganha logística, e a família ganha resposta
-- ---------------------------------------------------------------------------
--
-- ## O ponto de encontro vivia no navegador de quem imprimia
--
-- A folha de convocatória em PDF pergunta há muito o que a base não tinha: a
-- prova, a jornada, o ponto de encontro, a hora a que a malta se junta, a hora
-- de chegada ao recinto. Escrevia-se no diálogo de exportar e guardava-se no
-- `localStorage` **de quem exportava** — por equipa. Três consequências, todas
-- más: cada treinador tinha a sua versão, mudar de computador perdia-a, e o
-- pai — que é quem tem de estar no ponto de encontro à hora certa — nunca via
-- nada disto, porque a única forma de sair do produto era um papel impresso.
--
-- O comentário no topo de `CallUpSheetDialog` já previa este dia: *"Se um dia
-- forem parte do jogo — porque a app da família também os quer mostrar — sobem
-- à base sem esta folha mudar."* É o que se faz aqui.
--
-- As perguntas mudam de sítio: passam a ser feitas **ao submeter** a
-- convocatória, que é o momento em que alguém está de facto a decidir a
-- logística do dia. Exportar o PDF deixa de perguntar seja o que for e passa a
-- descarregar directamente o que já foi dito.
--
-- ## A hora, e não os minutos antes
--
-- O diálogo guardava "encontro 30 minutos antes" para o poder reutilizar entre
-- jogos com horas diferentes. Isso era uma consequência de a memória ser por
-- equipa; aqui a logística é **deste jogo**, e a resposta certa é uma hora
-- absoluta — `timestamptz`, como todo o resto do calendário. Um encontro no dia
-- anterior (deslocação longa, concentração) passa a ser exprimível, e antes não
-- era.
--
-- ## A resposta da família
--
-- `MatchCallUp.status` já tinha `CALLED | CONFIRMED | DECLINED` e nunca saía de
-- `CALLED`: não havia por onde responder. Agora há, e o que faltava era o
-- **porquê** e o **rasto**.
--
-- Assume-se sempre que o atleta vai. Um pai que não abre a app não está a
-- recusar nada — está a fazer o que noventa por cento faz, que é aparecer. Só
-- a recusa é um acto: exige motivo, e fica com autor e hora. É a diferença
-- entre "não confirmou" e "disse que não vem", e um treinador que monta uma
-- equipa precisa de distinguir as duas.
--
-- `confirmationRequired` é a excepção pedida: há jogos (uma deslocação com
-- autocarro alugado, uma final) em que o clube quer confirmação activa. Nasce
-- desligado porque obrigar toda a gente a carregar num botão em todos os jogos
-- é a forma mais rápida de ensinar as famílias a ignorar a app.

-- ---------------------------------------------------------------------------
-- A logística do jogo
-- ---------------------------------------------------------------------------

ALTER TABLE "Match"
  ADD COLUMN IF NOT EXISTS "roundLabel"    TEXT,
  ADD COLUMN IF NOT EXISTS "meetingPoint"  TEXT,
  ADD COLUMN IF NOT EXISTS "meetingAt"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "arrivalAt"     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "callUpNotes"   TEXT,
  ADD COLUMN IF NOT EXISTS "confirmationRequired" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- A resposta a uma convocatória
-- ---------------------------------------------------------------------------
--
-- `respondedById` aponta para a `Membership` de quem respondeu — o encarregado,
-- e um dia o próprio atleta na app dele. Não é o `User`: a mesma pessoa pode ter
-- vínculos diferentes, e o que interessa registar é em que qualidade respondeu.
-- `ON DELETE SET NULL` porque apagar um vínculo não apaga o facto de a resposta
-- ter sido dada.

ALTER TABLE "MatchCallUp"
  ADD COLUMN IF NOT EXISTS "declineReason" TEXT,
  ADD COLUMN IF NOT EXISTS "respondedAt"   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "respondedById" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MatchCallUp_respondedById_fkey'
  ) THEN
    ALTER TABLE "MatchCallUp"
      ADD CONSTRAINT "MatchCallUp_respondedById_fkey"
      FOREIGN KEY ("respondedById") REFERENCES "Membership"("id") ON DELETE SET NULL;
  END IF;
END $$;

-- Uma recusa sem motivo não é uma recusa — é um campo por preencher, e o
-- treinador fica sem saber se o miúdo está doente ou de castigo. A regra vive
-- aqui e não só no serviço: é a base que não deixa ficar um estado incoerente,
-- venha ele do produto ou de uma correcção à mão.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MatchCallUp_decline_has_reason'
  ) THEN
    ALTER TABLE "MatchCallUp"
      ADD CONSTRAINT "MatchCallUp_decline_has_reason"
      CHECK (status <> 'DECLINED' OR btrim(coalesce("declineReason", '')) <> '');
  END IF;
END $$;
