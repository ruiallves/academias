-- Uma referência para cada artigo que ainda não tem.
--
-- ## Porquê
--
-- O registo de artigos passou a gerar a referência quando o clube não escreve
-- nenhuma — `ET-0001`, prefixo da família e sequência, que é o que se usa em
-- armazém e em retalho. Os artigos criados antes disso ficaram sem nada, e um
-- módulo onde metade tem referência e metade não é pior do que qualquer dos
-- extremos: deixa de se poder dizer "procura pela referência".
--
-- ## O prefixo sai da categoria, ou do nome
--
-- "Equipamento de treino" → `ET`; "Material médico" → `MM`; "Bolas" → `BOL`. As
-- preposições não contam, senão "Material de treino" dava `MDT` e o D não
-- significava nada. Uma palavra só dá três letras — duas seriam ambíguas de mais
-- num armazém com dez famílias.
--
-- ## O que **não** se toca
--
-- Referências escritas à mão. `TS-AQ` é a referência que o clube usa nas
-- etiquetas e nas encomendas; reescrevê-la para `ET-0004` seria o programa a
-- decidir sobre uma coisa que é do clube. Só se preenche o que está vazio.
--
-- A numeração continua a partir do maior número já usado naquele prefixo, e não
-- de uma contagem: contar daria repetidos ao primeiro artigo arquivado.

WITH palavras AS (
  SELECT i.id,
         i."academyId",
         i."createdAt",
         array(
           SELECT p
             FROM unnest(regexp_split_to_array(
                    translate(lower(COALESCE(c.label, i.name)),
                              'áàâãäçéèêëíìîïñóòôõöúùûü',
                              'aaaaaceeeeiiiinooooouuuu'),
                    '[^a-z0-9]+')) AS p
            WHERE p <> '' AND p NOT IN ('de','do','da','dos','das','e','a','o','para','em')
         ) AS w
    FROM "InventoryItem" i
    LEFT JOIN "CatalogItem" c ON c.id = i."categoryId"
   WHERE i.sku IS NULL OR btrim(i.sku) = ''
),
comPrefixo AS (
  SELECT id, "academyId", "createdAt",
         CASE
           WHEN cardinality(w) = 0 THEN 'ART'
           WHEN cardinality(w) = 1 THEN upper(substr(w[1], 1, 3))
           ELSE upper(substr(w[1],1,1) || substr(w[2],1,1) || COALESCE(substr(w[3],1,1), ''))
         END AS prefixo
    FROM palavras
),
numerado AS (
  SELECT p.id, p.prefixo,
         COALESCE((
           SELECT max((regexp_match(x.sku, '-(\d+)$'))[1]::int)
             FROM "InventoryItem" x
            WHERE x."academyId" = p."academyId"
              AND x.sku LIKE p.prefixo || '-%'
              AND x.sku ~ '-\d+$'
         ), 0) AS base,
         row_number() OVER (PARTITION BY p."academyId", p.prefixo ORDER BY p."createdAt", p.id) AS rn
    FROM comPrefixo p
)
UPDATE "InventoryItem" it
   SET sku = n.prefixo || '-' || lpad((n.base + n.rn)::text, 4, '0'),
       "updatedAt" = now()
  FROM numerado n
 WHERE it.id = n.id;

-- E cada tamanho herda a do artigo com o sufixo — `ET-0001-M`. É a convenção do
-- retalho para variantes, e é o que uma etiqueta precisa: identificar a peça
-- exacta sem ter de cruzar duas colunas.
UPDATE "InventoryVariant" v
   SET sku = i.sku || '-' || upper(regexp_replace(btrim(v.label), '\s+', '', 'g')),
       "updatedAt" = now()
  FROM "InventoryItem" i
 WHERE i.id = v."itemId"
   AND i.sku IS NOT NULL
   AND (v.sku IS NULL OR btrim(v.sku) = '')
   AND btrim(v.label) <> '';
