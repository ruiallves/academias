-- A aprovação das famílias pelo clube.
--
-- Até aqui, um pai que se registasse pelo link das famílias (NIF + data de
-- nascimento do educando) entrava logo. Agora a conta nasce à espera: a
-- `Membership` de encarregado fica desligada (`isActive = false`) e marcada com
-- `approvalRequestedAt`, e só abre quando alguém do clube a aprova na página
-- Famílias.
--
-- Desligada, e não uma coluna nova que todos os leitores teriam de conhecer: a
-- `resolve_memberships`, os avisos, as contagens da plataforma, tudo o que já
-- lê `isActive` deixa o pedido de fora sem mudar uma linha. O que a coluna
-- acrescenta é saber **porquê** está desligada, para a app explicar "à espera
-- do clube" em vez de "esta conta não é de encarregado".
--
-- `approvedAt` distingue o pedido de uma conta nova (recusar apaga-a) do
-- pedido de quem já foi encarregado e foi desactivado (recusar só o arquiva).

ALTER TABLE "Membership"
  ADD COLUMN "approvalRequestedAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3);

-- Quem já é encarregado hoje foi aceite pelas regras de antes, e continua.
UPDATE "Membership" SET "approvedAt" = CURRENT_TIMESTAMP WHERE role = 'GUARDIAN';

CREATE INDEX "Membership_academyId_approvalRequestedAt_idx"
  ON "Membership" ("academyId", "approvalRequestedAt")
  WHERE "approvalRequestedAt" IS NOT NULL;

-- Esta conta tem um pedido de família à espera neste clube?
--
-- Só corre quando a conta não tem vínculo de família activo — é a diferença
-- entre o 403 "à espera de aprovação" e o 403 "não és encarregado". Não diz
-- mais nada: nem nomes, nem educandos, nem desde quando.
CREATE OR REPLACE FUNCTION app.family_approval_pending(p_auth_id text, p_academy_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM "User" u
    JOIN "Membership" m ON m."userId" = u.id
    WHERE u."authId" = p_auth_id
      AND m."academyId" = p_academy_id
      AND m.role = 'GUARDIAN'
      AND NOT m."isActive"
      AND m."approvalRequestedAt" IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION app.family_approval_pending(text, text) TO academia_app;
