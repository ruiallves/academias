-- Os planos passam a descrever-se, e o cargo de abertura passa a ser escrito
--
-- ## Os planos
--
-- Eram três (Arranque, Clube, Academia) com preço por atleta e mais nada — só um
-- nome e um número. O painel mostrava-os assim, e quem abre um clube tinha de
-- saber de cor o que cada um traz.
--
-- Passam a ser dois — Consola e Connect — e a trazer consigo o que dizem: a
-- frase, a lista do que inclui, e a lista do que **não** inclui. Esta última não
-- é pessimismo: um plano que só lista o que traz obriga quem compara a descobrir
-- a ausência depois de assinar.
--
-- As colunas antigas (`perAthleteCents`, `includedAthletes`) ficam. Não custam
-- nada a zero e o dia em que o preço voltar a crescer com o número de atletas
-- não obriga a outra migração.

ALTER TABLE "Plan" ADD COLUMN "tagline"       TEXT;
ALTER TABLE "Plan" ADD COLUMN "features"      TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Plan" ADD COLUMN "excludes"      TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Plan" ADD COLUMN "isRecommended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Plan" ADD COLUMN "order"         INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Os dois planos
-- ---------------------------------------------------------------------------
--
-- Escritos aqui e não só no seed porque as academias que já existem apontam para
-- os planos antigos: mudar-lhes o nome e o conteúdo no sítio é o que faz o
-- painel passar a dizer a verdade sem ninguém ter de mexer em subscrições.
--
-- `plan_clube` vira `Consola` e `plan_academia` vira `Connect` porque são os que
-- têm subscrições vivas; `plan_arranque` é desactivado (não apagado — apagá-lo
-- rebentaria a chave externa de quem quer que ainda lá esteja).

UPDATE "Plan" SET
  name = 'Consola',
  tagline = 'O clube por dentro. Tudo o que a direção e os treinadores precisam.',
  "amountCents" = 1499,
  "perAthleteCents" = 0,
  "includedAthletes" = 0,
  "isRecommended" = false,
  "order" = 1,
  "isActive" = true,
  features = ARRAY[
    'Atletas, equipas, escalões e staff',
    'Papéis e permissões à medida do clube',
    'Calendário, treinos, presenças e convocatórias',
    'Avaliações e relatórios de atleta',
    'Departamento clínico: lesões, consultas e disponibilidade',
    'Scouting: prospectos, observações, vídeo e shortlists',
    'Comunicação segmentada e notificações',
    'Importação de atletas por Excel'
  ],
  excludes = ARRAY[
    'App das famílias',
    'Mensalidades e pagamentos',
    'Página pública de adesão a sócio'
  ],
  "updatedAt" = now()
WHERE id = 'plan_clube';

UPDATE "Plan" SET
  name = 'Connect',
  tagline = 'O clube, as famílias e o dinheiro. A plataforma inteira.',
  "amountCents" = 1999,
  "perAthleteCents" = 0,
  "includedAthletes" = 0,
  "isRecommended" = true,
  "order" = 2,
  "isActive" = true,
  features = ARRAY[
    'Tudo o que está na Consola',
    'App das famílias com a marca do clube (PWA)',
    'Convocatórias, presenças e avaliações no telemóvel dos pais',
    'Mensalidades: MB WAY, Multibanco e cartão',
    'Confirmação automática e estado sempre actualizado',
    'Página pública de adesão a sócio',
    'Gestão de sócios e quotas',
    'Notificações push para as famílias'
  ],
  excludes = ARRAY[]::TEXT[],
  "updatedAt" = now()
WHERE id = 'plan_academia';

-- O terceiro sai de circulação sem desaparecer: quem estiver nele continua a
-- apontar para uma linha que existe, e ninguém novo o pode escolher.
UPDATE "Plan" SET "isActive" = false, "order" = 99, "updatedAt" = now()
WHERE id = 'plan_arranque';
