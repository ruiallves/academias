-- Fotografias no artigo, e a localização fora.
--
-- ## A localização sai
--
-- Entrou como "opcional, para o dia em que interessar saber onde está". Não
-- interessou a ninguém: um campo que ninguém preenche não é uma funcionalidade
-- adormecida, é ruído no formulário de criação — mais uma pergunta entre quem
-- está a registar material e o botão de guardar. E um armazém de clube tem, na
-- prática, um sítio só.
--
-- Sai a coluna do artigo, a do movimento e o catálogo `inventoryLocations`. Se
-- um dia fizer falta — clubes com dois pavilhões —, volta com a pergunta certa
-- já feita, em vez de ter ficado meia feita à espera.
--
-- ## As fotografias entram
--
-- Chaves e nunca URLs, como o resto do produto: um endereço assinado expira, e
-- guardar um expirado é guardar uma imagem partida. Resolve o que a descrição
-- não resolve — duas t-shirts pretas de épocas diferentes distinguem-se numa
-- foto, não em palavras.

ALTER TABLE "InventoryItem" DROP CONSTRAINT IF EXISTS "InventoryItem_locationId_fkey";
ALTER TABLE "InventoryItem" DROP COLUMN IF EXISTS "locationId";

ALTER TABLE "InventoryMovement" DROP CONSTRAINT IF EXISTS "InventoryMovement_locationId_fkey";
ALTER TABLE "InventoryMovement" DROP COLUMN IF EXISTS "locationId";

ALTER TABLE "InventoryItem" ADD COLUMN "imageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- O catálogo de localizações desaparece com a coluna que o usava. Nunca chegou a
-- ser semeado (ver `SEED`), por isso quase de certeza não há linhas — mas um
-- clube pode ter criado as suas à mão, e essas ficariam órfãs num menu de
-- definições que já não leva a lado nenhum.
DELETE FROM "CatalogItem" WHERE kind = 'inventoryLocations';
