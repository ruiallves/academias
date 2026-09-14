-- ---------------------------------------------------------------------------
-- Um número de sócio apagado fica aberto — não volta à fila.
--
-- O próximo número saía de `MAX(number)` sobre as fichas vivas. Isso responde
-- bem a um buraco no meio: apagar o 2 de 1-2-3 deixa o máximo em 3, e a adesão
-- seguinte é a 4. Mas engana-se no topo — apagar o 3 põe o máximo em 2, e a
-- adesão seguinte herda o número de quem acabou de sair. É o caso mais fácil de
-- provocar sem dar por isso: cria-se uma ficha de teste (que fica com o número
-- mais alto), apaga-se, e a inscrição verdadeira a seguir entra nesse número.
--
-- `lastMemberNumber` é a marca de água: o maior número já atribuído no clube, e
-- só sobe. O próximo é `MAX(marca de água, maior número vivo) + 1` — o segundo
-- termo é a rede para números escritos à mão acima da marca, e para o dia em
-- que alguém mexa nisto por SQL.
--
-- Encher um buraco continua a ser possível, mas só **à mão**, escrevendo o
-- número na ficha: quem decide se o 2 pode voltar a ser de outra pessoa é o
-- clube, não o produto.
--
-- O arranque: a marca de água de cada clube é o maior número que ele já tem.
-- ---------------------------------------------------------------------------

ALTER TABLE "Academy" ADD COLUMN "lastMemberNumber" INTEGER NOT NULL DEFAULT 0;

UPDATE "Academy" a
   SET "lastMemberNumber" = COALESCE(
         (SELECT MAX(m.number) FROM "Member" m WHERE m."academyId" = a.id),
         0
       );
