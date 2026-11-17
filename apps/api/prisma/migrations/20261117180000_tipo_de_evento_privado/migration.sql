-- Tipos de evento privados: os eventos de um tipo privado só aparecem ao staff.
--
-- Uma coluna nova com omissão falso: nenhum tipo existente muda, e a API
-- antiga continua a funcionar (não a lê nem a escreve). Ver
-- `CatalogItem.staffOnly` e `veEventosPrivados`.
ALTER TABLE "CatalogItem" ADD COLUMN "staffOnly" BOOLEAN NOT NULL DEFAULT false;
