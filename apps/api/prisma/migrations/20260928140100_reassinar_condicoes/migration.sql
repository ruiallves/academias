-- Quem já assinou as condições volta a assiná-las, agora com a declaração.
--
-- À parte da migração do esquema de propósito: esta só deve correr quando o
-- código que pede a identificação e gera o PDF estiver no ar. Aplicada antes,
-- a ordem reemitida aparecia na consola com o botão antigo, de um clique, e
-- podia ser assinada sem declaração — e esta migração não volta a correr.
--
--
-- Uma ordem assinada antes disto não tem declaração. Para cada clube cuja
-- última ordem assinada está nesse caso — e que não tenha já outra por assinar —
-- reemite-se uma cópia por assinar: as mesmas condições, os Termos de Serviço em
-- vigor, e o dia de cobrança da assinatura original. A ordem antiga fica como
-- está: é a história, e é dela que os avisos continuam a sair até à nova
-- assinatura.

INSERT INTO "SubscriptionOrder" (
  "id", "academyId", "planId", "planName", "billingPeriod", "listMonthlyCents",
  "discountPct", "amountCents", "startsOn", "minimumMonths", "renewalNote", "notes",
  "termsDocumentId", "termsVersion", "status", "sentToEmail", "sentToName",
  "billingAnchorAt", "createdAt", "updatedAt"
)
SELECT
  'ord_' || md5(random()::text || o."id"),
  o."academyId", o."planId", o."planName", o."billingPeriod", o."listMonthlyCents",
  o."discountPct", o."amountCents", o."startsOn", o."minimumMonths", o."renewalNote", o."notes",
  COALESCE(t."id", o."termsDocumentId"), COALESCE(t."version", o."termsVersion"),
  'PENDING', o."signerEmail", o."signerName",
  COALESCE(o."billingAnchorAt", o."signedAt"), now(), now()
FROM (
  SELECT DISTINCT ON ("academyId") *
  FROM "SubscriptionOrder"
  WHERE "status" = 'SIGNED' AND "signedAt" IS NOT NULL
  ORDER BY "academyId", "signedAt" DESC
) o
LEFT JOIN LATERAL (
  SELECT "id", "version" FROM "LegalDocument"
  WHERE "type" = 'TERMS_OF_SERVICE' AND "status" = 'PUBLISHED' AND "effectiveAt" <= now()
  ORDER BY "effectiveAt" DESC, "publishedAt" DESC
  LIMIT 1
) t ON true
WHERE NOT EXISTS (SELECT 1 FROM "SubscriptionDeclaration" d WHERE d."orderId" = o."id")
  AND NOT EXISTS (
    SELECT 1 FROM "SubscriptionOrder" p WHERE p."academyId" = o."academyId" AND p."status" = 'PENDING'
  );
