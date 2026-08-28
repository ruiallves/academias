-- O nome curto dos clubes, corrigido
--
-- ## O que estava errado
--
-- `shortName` era derivado do nome na criação, por uma função que cortava a
-- primeira palavra quando ela era "Academia", "Clube" ou "Associação", e depois
-- truncava a 24 caracteres. As duas coisas produziam nomes que não são de
-- ninguém, e esse é o nome que aparece no assunto dos emails, na página de
-- sócios, no separador da consola e no ecrã inicial do telemóvel dos pais:
--
--   Clube Desportivo de Loureiro  ->  Desportivo de Loureiro     (palavra cortada)
--   Futebol Clube Ferreirense     ->  Futebol Clube Ferreirens   (truncado a meio)
--   Grupo Desportivo de Chaves    ->  Grupo Desportivo de Chav   (truncado a meio)
--
-- A partir de agora o nome curto é o nome do clube, cortado só se passar de 32
-- caracteres e sempre num espaço — e o clube pode escrevê-lo nas Definições, que
-- é a única forma de isto ficar certo para nomes que não se conseguem adivinhar.
-- Ver `src/common/short-name.ts`.
--
-- ## Porque é que esta correcção é segura numa base com clientes
--
-- Porque até hoje **nada** escrevia `shortName` a não ser a criação: não havia
-- ecrã, endpoint nem importação que lhe tocasse. Ainda assim, só se corrigem as
-- linhas cujo valor actual é exactamente o que a função antiga produzia. Uma
-- linha que alguém tenha acertado à mão na base de dados fica como está — e vai
-- passar a ser editável no produto, por isso a partir daqui nunca mais se
-- reescreve o que um clube escolheu.

WITH calculado AS (
  SELECT
    id,
    -- O que a função antiga produzia, para reconhecer as linhas por corrigir.
    left(
      coalesce(
        nullif(btrim(regexp_replace(name, '^(academia|clube|club|associação|associacao)[[:space:]]+', '', 'i')), ''),
        name
      ),
      24
    ) AS antigo,
    regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g') AS limpo
  FROM "Academy"
),
alvo AS (
  SELECT
    id,
    antigo,
    CASE
      WHEN length(limpo) <= 32 THEN limpo
      -- Uma primeira palavra maior que o limite: não há espaço onde cortar.
      WHEN strpos(reverse(left(limpo, 33)), ' ') = 0 THEN left(limpo, 32)
      -- Corta no último espaço que cabe, para não partir uma palavra ao meio.
      ELSE btrim(left(limpo, 33 - strpos(reverse(left(limpo, 33)), ' ')))
    END AS novo
  FROM calculado
)
UPDATE "Academy" a
   SET "shortName" = alvo.novo,
       "updatedAt" = now()
  FROM alvo
 WHERE a.id = alvo.id
   AND a."shortName" = alvo.antigo
   AND a."shortName" <> alvo.novo;
