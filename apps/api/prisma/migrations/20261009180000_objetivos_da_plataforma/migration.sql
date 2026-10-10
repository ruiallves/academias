-- Os objetivos da plataforma, no painel: para onde vai o negócio.
--
-- Uma tabela só da plataforma, fechada ao papel das academias como as Contas.
-- Nasce com uma primeira lista, para o ecrã não abrir vazio; edita-se no painel.
-- Só cria uma tabela nova: a API que está no ar não a lê.

CREATE TABLE "PlatformGoal" (
  "id"          TEXT NOT NULL,
  "title"       TEXT NOT NULL,
  "description" TEXT,
  "area"        TEXT NOT NULL,
  "metric"      TEXT,
  "target"      DOUBLE PRECISION,
  "current"     DOUBLE PRECISION,
  "deadline"    DATE,
  "doneAt"      TIMESTAMP(3),
  "order"       INTEGER NOT NULL DEFAULT 0,
  "archivedAt"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformGoal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlatformGoal_area_order_idx" ON "PlatformGoal"("area", "order");

REVOKE ALL ON "PlatformGoal" FROM academia_app;

INSERT INTO "PlatformGoal" ("id", "title", "description", "area", "metric", "target", "deadline", "order", "updatedAt") VALUES
  ('goal_clubes_25',      '25 clubes a pagar',                    'O primeiro marco: a plataforma paga-se a si própria e a uma pessoa.',                                   'Clientes',      'clubes_pagantes',  25,   '2026-12-31', 1, now()),
  ('goal_clubes_100',     '100 clubes a pagar',                   'Um em cada vinte clubes de formação do país.',                                                          'Clientes',      'clubes_pagantes',  100,  '2027-12-31', 2, now()),
  ('goal_atletas_5000',   '5 000 atletas na plataforma',          'Atletas ativos em clubes que usam a Academias.',                                                        'Clientes',      'atletas',          5000, '2027-06-30', 3, now()),
  ('goal_familias_2000',  '2 000 famílias a usar a app',          'Encarregados que já entraram na app do clube. É o que prende um clube: os pais habituam-se.',            'Clientes',      'familias_app',     2000, '2027-06-30', 4, now()),
  ('goal_mrr_1000',       '1 000 € de receita mensal',            'MRR das subscrições ativas.',                                                                           'Receita',       'mrr',              1000, '2026-12-31', 1, now()),
  ('goal_mrr_10000',      '10 000 € de receita mensal',           'Equipa a tempo inteiro paga pela própria plataforma.',                                                  'Receita',       'mrr',              10000,'2028-12-31', 2, now()),
  ('goal_modalidades_6',  'Seis modalidades em uso',              'Futebol e futsal já estão. Basquetebol, andebol, voleibol, natação, hóquei: cada uma abre um mercado.', 'Produto',       'modalidades',      6,    '2027-06-30', 1, now()),
  ('goal_cidades_20',     'Clubes em 20 cidades',                 'Sair do Minho e do Centro: um clube em cada capital de distrito.',                                     'Produto',       'cidades',          20,   '2027-12-31', 2, now()),
  ('goal_ia_500',         '500 jogos analisados pela Academias AI','O "Veo para clubes pequenos" a funcionar a sério.',                                                     'Produto',       'analises_ia',      500,  '2027-12-31', 3, now()),
  ('goal_es',             'Primeiro clube em Espanha',            'Galiza primeiro: a mesma cultura de formação, a duas horas de carro.',                                 'Internacional', NULL,               1,    '2027-09-30', 1, now()),
  ('goal_linguas',        'Plataforma em espanhol e inglês',      'Consola e app traduzidas, com as federações de cada país (RFEF, FA).',                                 'Internacional', NULL,               2,    '2027-06-30', 2, now()),
  ('goal_palop',          'Primeiro clube num país lusófono',     'Brasil, Angola ou Moçambique: o produto já fala a língua.',                                            'Internacional', NULL,               1,    '2028-06-30', 3, now()),
  ('goal_associacao',     'Parceria com uma associação distrital','A associação recomenda a Academias aos clubes, ou usa-a nas inscrições.',                              'Fora da caixa', NULL,               1,    '2027-06-30', 1, now()),
  ('goal_certificacao',   'Um clube sobe de estrelas na certificação FPF com a plataforma', 'A prova de que a plataforma muda o clube, e não só o organiza.',                     'Fora da caixa', NULL,               1,    '2027-12-31', 2, now()),
  ('goal_profissional',   'Um clube profissional a usar a Academias','A formação de um clube da Liga ou da Liga 3.',                                                      'Fora da caixa', NULL,               1,    '2028-06-30', 3, now()),
  ('goal_atleta_pro',     'Um atleta da plataforma chega a profissional','Um miúdo cujo percurso esteve todo na Academias assina o primeiro contrato.',                   'Fora da caixa', NULL,               1,    '2030-12-31', 4, now()),
  ('goal_media',          'Aparecer num meio de comunicação nacional','Jornal, televisão ou rádio a falar da plataforma.',                                                 'Fora da caixa', NULL,               1,    '2027-06-30', 5, now()),
  ('goal_web_summit',     'Stand no Web Summit',                  'Mostrar a Academias AI a analisar um jogo ao vivo.',                                                   'Fora da caixa', NULL,               1,    '2027-11-30', 6, now());
