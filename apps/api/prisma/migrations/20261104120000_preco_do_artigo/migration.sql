-- O preço base de um artigo do armazém, em cêntimos, com IVA. Nulo = sem preço.
ALTER TABLE "InventoryItem" ADD COLUMN "priceCents" INTEGER;
