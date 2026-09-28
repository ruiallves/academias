-- O espaço de ficheiros de cada clube: um limite, e a forma de o medir.
--
-- O limite por omissão é 5 GB (5120 MB), como dizem os Termos de Serviço. A
-- plataforma pode aumentá-lo a um clube, normalmente com a mensalidade dele.

ALTER TABLE "Academy" ADD COLUMN "storageLimitMb" INTEGER NOT NULL DEFAULT 5120;

/*
 * Os ficheiros de cada clube, no armazenamento do Supabase.
 *
 * ## Porque é que se mede aqui e não se guarda
 *
 * Porque `storage.objects` já é a verdade: tem cada ficheiro e o tamanho dele,
 * e apagar um ficheiro tira-o de lá. Um contador nosso teria de ser mexido em
 * cada carregamento e em cada apagar, em sete sítios, e o dia em que um se
 * esquecesse o número deixava de bater certo.
 *
 * ## De que clube é cada ficheiro
 *
 * Pelo caminho. Uns começam pelo id do clube (o símbolo, o scouting, os vídeos
 * da Academias AI); os outros pelo dono, e o dono diz o clube:
 *   fotos        atletas/<atleta>, socios/<sócio>, staff/<utilizador>
 *   inventario   artigos/<artigo>
 *   exercicios   exercicios/<exercício>
 * A fotografia de uma pessoa do staff é da conta, não do clube: conta em cada
 * clube onde ela trabalha, que é onde ela aparece.
 *
 * `plpgsql` e não `sql` para a função se criar mesmo onde o esquema `storage`
 * não existe (a base descartável dos testes, em PGlite): o corpo só é lido
 * quando corre.
 */
CREATE OR REPLACE FUNCTION app.storage_by_academy(p_academy_id text DEFAULT NULL)
RETURNS TABLE (academy_id text, categoria text, bytes bigint, ficheiros bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH objetos AS (
    SELECT o.bucket_id,
           o.name,
           split_part(o.name, '/', 1) AS p1,
           split_part(o.name, '/', 2) AS p2,
           COALESCE((o.metadata->>'size')::bigint, 0) AS tamanho
    FROM storage.objects o
  ),
  atribuidos AS (
    -- Os que começam pelo id do clube.
    SELECT ob.p1 AS academia, CASE ob.bucket_id
             WHEN 'clube-publico' THEN 'simbolo'
             WHEN 'scouting' THEN 'scouting'
             WHEN 'ai-videos' THEN 'video'
             ELSE ob.bucket_id END AS cat, ob.tamanho
    FROM objetos ob
    WHERE ob.bucket_id IN ('clube-publico', 'scouting', 'ai-videos')
    UNION ALL
    SELECT a."academyId", 'fotografias', ob.tamanho
    FROM objetos ob JOIN "Athlete" a ON a.id = ob.p2
    WHERE ob.bucket_id = 'fotos' AND ob.p1 = 'atletas'
    UNION ALL
    SELECT m."academyId", 'fotografias', ob.tamanho
    FROM objetos ob JOIN "Member" m ON m.id = ob.p2
    WHERE ob.bucket_id = 'fotos' AND ob.p1 = 'socios'
    UNION ALL
    SELECT DISTINCT ON (ob.name, ms."academyId") ms."academyId", 'fotografias', ob.tamanho
    FROM objetos ob JOIN "Membership" ms ON ms."userId" = ob.p2
    WHERE ob.bucket_id = 'fotos' AND ob.p1 = 'staff'
      AND ms.role NOT IN ('GUARDIAN', 'ATHLETE')
    UNION ALL
    SELECT i."academyId", 'inventario', ob.tamanho
    FROM objetos ob JOIN "InventoryItem" i ON i.id = ob.p2
    WHERE ob.bucket_id = 'inventario' AND ob.p1 = 'artigos'
    UNION ALL
    SELECT e."academyId", 'exercicios', ob.tamanho
    FROM objetos ob JOIN "Exercise" e ON e.id = ob.p2
    WHERE ob.bucket_id = 'exercicios' AND ob.p1 = 'exercicios'
  )
  SELECT at.academia::text, at.cat::text, SUM(at.tamanho)::bigint, COUNT(*)::bigint
  FROM atribuidos at
  WHERE p_academy_id IS NULL OR at.academia = p_academy_id
  GROUP BY at.academia, at.cat;
END;
$$;

REVOKE ALL ON FUNCTION app.storage_by_academy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.storage_by_academy(text) TO academia_app;
