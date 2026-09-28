-- As imagens dos exercícios passam de 8 MB para 20 MB.
--
-- A consola reduz a imagem antes de a carregar (2400 px, ver
-- `reduzirImagemDeTreino`), por isso o normal é perto de 1 MB; os 20 MB são a
-- rede para o que o browser não consiga reduzir. O limite vive no balde do
-- Supabase, e `ensureBucket` só o aplica ao criar: o balde que já existe muda
-- aqui.
--
-- Protegido para a base descartável dos testes (PGlite), onde não há esquema
-- `storage`.
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    UPDATE storage.buckets SET file_size_limit = 20971520 WHERE id = 'exercicios';
  END IF;
END
$$;
