-- Sócios importados de uma folha do clube.
--
-- O consentimento passa a poder ser nulo, como o comentário do modelo sempre
-- disse. Um sócio que já era sócio antes desta plataforma deu os termos ao clube
-- em papel, numa data que ninguém aqui conhece — carimbar o momento da
-- importação seria inventar a prova que o RGPD pede. Nulo diz a verdade: não há
-- registo aqui, e quem precisar dela vai ao arquivo do clube.
ALTER TABLE "Member" ALTER COLUMN "acceptedTermsAt" DROP NOT NULL;
