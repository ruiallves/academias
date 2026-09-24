-- Consultas: tipos do clube, notas da consulta e confirmação da família.
--
-- O tipo vem do catálogo `consultationTypes` (Fisioterapia, Consulta, Nutrição,
-- Exame à partida, e o clube muda-os nas Definições). `CONSULTATION` é o `kind`
-- de um tipo que não é nenhum dos que o domínio já distinguia.
--
-- `notes` são as notas de quem deu a consulta, à parte de `detail` (a nota que a
-- família lê). A confirmação copia a da convocatória: pede-se ou não, responde
-- o encarregado ou o atleta, e a recusa leva motivo.

ALTER TYPE "ClinicalKind" ADD VALUE IF NOT EXISTS 'CONSULTATION';

CREATE TYPE "ClinicalReply" AS ENUM ('CONFIRMED', 'DECLINED');

ALTER TABLE "ClinicalEntry"
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "typeId" TEXT,
  ADD COLUMN "confirmationRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "respondBy" "ResponderBy" NOT NULL DEFAULT 'GUARDIAN',
  ADD COLUMN "reply" "ClinicalReply",
  ADD COLUMN "declineReason" TEXT,
  ADD COLUMN "respondedAt" TIMESTAMP(3),
  ADD COLUMN "respondedById" TEXT;

ALTER TABLE "ClinicalEntry" ADD CONSTRAINT "ClinicalEntry_typeId_fkey"
  FOREIGN KEY ("typeId") REFERENCES "CatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClinicalEntry" ADD CONSTRAINT "ClinicalEntry_respondedById_fkey"
  FOREIGN KEY ("respondedById") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uma recusa diz porquê, como na convocatória.
ALTER TABLE "ClinicalEntry" ADD CONSTRAINT "ClinicalEntry_recusa_com_motivo"
  CHECK ("reply" IS DISTINCT FROM 'DECLINED' OR length(btrim(coalesce("declineReason", ''))) > 0);
