-- Os temas do site mudam de nome: "classico" passa a "tribuna" (o claro) e
-- "porto" a "holofote" (o escuro). O segundo era o nome de um clube a sério.
--
-- **Só depois do deploy da API e do site de 20/10.** A API antiga só conhece
-- os nomes antigos e lia "holofote" como "classico": a AD Fafe, que tem o
-- tema escuro e o site publicado, aparecia no claro até ao deploy. A API
-- nova aceita os dois nomes (`layoutValido`), por isso esta migração pode
-- esperar o tempo que for preciso.

UPDATE "SiteConfig" SET "layout" = 'tribuna'  WHERE "layout" = 'classico';
UPDATE "SiteConfig" SET "layout" = 'holofote' WHERE "layout" = 'porto';
ALTER TABLE "SiteConfig" ALTER COLUMN "layout" SET DEFAULT 'tribuna';
