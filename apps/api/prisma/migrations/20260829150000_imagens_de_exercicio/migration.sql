-- Fotografias nos exercícios da biblioteca.
--
-- Guardam-se as chaves, nunca URLs — a mesma regra das fotos de atletas: um URL
-- guardado é um endereço permanente, e estas imagens vivem num bucket privado
-- servido por links assinados com prazo. Ver `photos.service.ts`.

ALTER TABLE "Exercise" ADD COLUMN "imageKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
