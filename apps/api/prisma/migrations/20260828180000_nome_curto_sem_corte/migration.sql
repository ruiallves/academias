-- O nome curto deixa de ser cortado
--
-- ## O que ainda estava errado
--
-- A correcção anterior (`20260828090000_nome_curto_do_clube`) tirou o pior: o
-- corte da primeira palavra e o `slice` cego a 24 caracteres, que dava "Futebol
-- Clube Ferreirens". Mas deixou um limite de 32, cortado num espaço.
--
-- Escolher um número é escolher que clubes ficam de fora dele, e ficaram três:
--
--   Associação Desportiva Oliveirense (33)         -> Associação Desportiva
--   Clube Recreativo e Cultural do Forte da Casa (44)
--                                                 -> Clube Recreativo e Cultural do
--   ACRD Nespereira                               -> ACRDN
--
-- O segundo nem acaba numa palavra que se leia, e este é o nome que aparece no
-- assunto dos emails, na página de sócios e no telemóvel dos pais.
--
-- Um clube chama-se pelo nome todo. Onde não couber no ecrã, trunca o CSS — com
-- reticências, no sítio apertado, sem estragar o dado que está gravado.
--
-- ## O critério
--
-- Só linhas onde o nome curto é **um prefixo do nome** e mais curto que ele: a
-- assinatura de um corte. Um nome curto que seja outra coisa qualquer foi
-- escrito por alguém e não se toca — a partir da versão anterior existe campo
-- para isso nas Definições.
--
-- `acrdnespereira` ("ACRDN" para "ACRD Nespereira") não é prefixo — o quinto
-- caractere é um espaço no nome e um "N" no curto — e por isso **não é
-- corrigido aqui**. Fica de fora de propósito: não veio de nenhum corte que este
-- código faça, e mexer nele seria adivinhar.

UPDATE "Academy"
   SET "shortName" = regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'),
       "updatedAt" = now()
 WHERE "shortName" <> regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')
   AND regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g') LIKE "shortName" || '%';
