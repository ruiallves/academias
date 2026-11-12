# O Adjunto

O assistente com IA da consola. Fala-se com ele (escrito ou ditado), ele lê o
que está na plataforma e propõe escritas; a pessoa confirma. Também lê um
Excel de atletas e importa-o depois de um ensaio.

> **Nome:** o assistente chama-se **Assistente IA** desde 12/11/2026 (era "Adjunto", o nome de um concorrente). O nome visível vive em `NOME` (`apps/api/src/adjunto/adjunto.service.ts`) e `NOME_DO_ADJUNTO` (`apps/console/src/lib/adjunto.ts`); a página é `/assistente`. As pastas, tabelas e rotas da API mantêm "adjunto".

## O que faz, e o que não faz

Faz, por agora:

- lê equipas, plantéis, treinos, jogos, convocatórias e quem está indisponível,
  sempre com o âmbito de quem fala (um treinador só vê as equipas dele);
- propõe a folha de presenças de um treino, um registo de lesão (ou o aviso ao
  departamento clínico, quando quem fala não escreve no boletim) e a
  convocatória de um jogo;
- importa um Excel ou CSV de atletas: percebe as colunas, ensaia, e grava só
  depois de "Importar".

Não faz, de propósito:

- **nunca grava sozinho**. Toda a escrita é uma proposta (`AdjuntoProposal`)
  que fica `PENDING` até alguém carregar em Confirmar. Quem grava é o serviço
  de sempre (`recordAttendance`, `ClinicalService.criar`, `saveCallUps`), com
  a sessão de quem confirmou. A IA não tem porta própria para a base;
- não dá informação clínica além de "indisponível", "de baixa" ou
  "condicionado". O boletim fica no servidor;
- não mexe em pagamentos, contas nem dados pessoais além do nome.

## Onde vive

| Peça | Onde |
| --- | --- |
| O cliente do modelo (chave, endereço, os três níveis) | `apps/api/src/adjunto/openai.client.ts` |
| Que modelo faz cada ação | `apps/api/src/adjunto/rotas.ts` |
| Quem é "o Pedro" | `apps/api/src/adjunto/nomes.ts` |
| As ferramentas que o modelo vê | `apps/api/src/adjunto/ferramentas.ts` |
| Confirmar, recusar, desfazer | `apps/api/src/adjunto/propostas.service.ts` |
| A conversa e o ciclo do agente | `apps/api/src/adjunto/adjunto.service.ts` |
| A importação (ler, mapear, transformar, ensaiar) | `apps/api/src/adjunto/importacao/` |
| O robô ao canto e o minichat | `apps/console/src/components/adjunto/Botao.tsx` |
| A conversa, os cartões, a caixa de falar | `apps/console/src/components/adjunto/` |
| A página inteira, com histórico | `apps/console/src/routes/adjunto/Adjunto.tsx` |
| O estado e os pedidos (streaming) | `apps/console/src/lib/adjunto.ts` |
| A voz | `apps/console/src/lib/voz.ts` |
| As sugestões por página | `apps/console/src/lib/sugestoes.ts` |

## Como funciona um pedido

1. A mensagem entra e fica guardada (`AdjuntoMessage`, `role = USER`).
2. Decide-se a **ação**. Se veio de um botão ("Marcar as presenças deste
   treino") já se sabe. Senão, o classificador corre no modelo leve e devolve
   uma categoria. A tabela `ROTAS` dá o nível, o esforço e as ferramentas.
3. O modelo responde em streaming. O texto sai para a consola por SSE; as
   chamadas a ferramentas correm no servidor e os resultados voltam ao modelo,
   até ele parar de pedir.
4. Uma ferramenta pode devolver uma **proposta** (fica guardada e vai como
   cartão), uma **pergunta** com botões (o modelo termina a vez; a pessoa
   escolhe e a conversa segue) ou um pedido de **subida**: o pedido repete-se
   no nível acima, uma vez.
5. A resposta fica guardada com os itens do modelo (`items`), para a conversa
   se reconstruir no pedido seguinte. O fornecedor não guarda nada
   (`store: false`); o raciocínio do modelo volta cifrado e é devolvido tal e
   qual.

### Os nomes resolvem-se no servidor

O treinador diz "faltaram o Pedro e o Rui". O modelo devolve os nomes como
foram ditos; `nomes.ts` procura-os no plantel sem acentos nem maiúsculas, com
as alcunhas mais comuns desfeitas ("Zé" é José). Dois Pedro não se adivinham:
a consola pergunta com botões. É isto que deixa o modelo pequeno fazer o
trabalho, e que mantém o plantel fora do que sai para o fornecedor.

### Que modelo faz o quê (desde 11/11/2026)

Uma rota só no chat e na voz: **gpt-6-luna**, esforço médio, com todas as
ferramentas e sem classificador (`ROTA_GERAL`). Quando o luna pede ajuda ou
falha a mesma escrita duas vezes, o pedido repete-se **uma vez** no
**gpt-6.1-terra** (`ROTA_REFORCO`), sem a saída de pedir ajuda: responde
sempre. Uma proposta recusada manda o pedido seguinte logo ao terra. O
**gpt-6.1-sol** só mapeia as colunas da importação, uma vez por ficheiro.

Porquê: o formulário, a validação, os nomes e o "não assumir" estão no
servidor, e o modelo só passa campos. A 11/11, "marca um jogo" custava perto
de 2 cêntimos: o classificador mandava-o para o luna sem a ferramenta, e o
pedido subia três modelos; a cache quase não pegava porque a hora ia no topo
das instruções; e o raciocínio antigo era reenviado. As três coisas estão
corrigidas (a data e a página vão numa mensagem antes da da pessoa; o
raciocínio das vezes anteriores não volta a ir). As tentativas que sobem
também ficam contadas em `AdjuntoUsage`.

### A tabela antiga, por ação (referência)

| Ação | Nível |
| --- | --- |
| presenças, lesão, convocatória simples, pergunta direta, conversa | leve |
| convocatória com critérios, pergunta que cruza dados, várias ações numa frase, agenda (marcar, desmarcar), outras ações (inscrever, comunicar) | médio |
| mapear as colunas de um ficheiro | forte |

Uma proposta recusada sobe a conversa um nível no pedido seguinte. A
ferramenta `precisar_de_ajuda` faz o mesmo no próprio pedido. No forte a
última tentativa corre sem essa ferramenta: se não houver forma de fazer o
que a pessoa pede, responde a dizer o que não consegue e onde na consola se
faz, em vez de ficar calado. Os nomes dos modelos vêm do ambiente (abaixo).

## As ações da consola (`acoes.ts`)

Marcar treino, marcar jogo, marcar evento, desmarcar, reativar, inscrever
atleta, publicar comunicado, publicar notícia no site e planear treino são
linhas de um registo: cada uma com a permissão que exige, o tipo de proposta
e os campos (nome, rótulo, tipo, obrigatório, descrição para o modelo). A
ferramenta `propor_acao(acao, campos)`:

1. lê cada campo como o tipo manda (`lerValor`: datas em ISO ou dd/mm,
   horas `HH:MM` ou `15h`, sim/não, NIF de 9 algarismos, escolhas pelo rótulo);
2. **pergunta o que falta** (os opcionais com `omissao` não contam: entram com o valor por omissão, que o cartão mostra e o Editar muda): os obrigatórios sem valor vão numa pergunta à
   pessoa, com botões quando há escolhas (equipas, locais, provas, público);
   o modelo termina a vez e volta a chamar com tudo quando ela responder;
3. resolve equipa, local e prova pelos nomes (ambíguo vira pergunta);
4. monta a proposta com `view.linhas` (o cartão é genérico) e `view.avisos`
   (choque de horário, atleta repetido, "sai logo por notificação").

Confirmar chama o serviço de sempre: `createEvent`, `setEventCancelled`,
`AthletesService.create`, `AnnouncementsService.create`,
`SiteService.criarNoticia`. Desfazer apaga o que acabou de nascer
(`cancelarVarios` apagar, `remove`, `apagarNoticia`).

Acrescentar uma ação é acrescentar uma linha em `ACOES` e um ramo em
`proporAcao` / `PropostasService.confirmar` quando o serviço for novo.

### O site do clube (desde 12/11/2026)

Treze ações de tipo `SITE` cobrem o Website da consola: mostrar, esconder e
mover secções da página de início, adicionar e remover banners, mudar o
layout, pôr o site no ar ou tirá-lo, criar, mudar e remover produtos da loja,
adicionar e remover patrocinadores, pôr bilhetes à venda e fechar a venda.
Cada uma exige `website:write` (os patrocinadores também aceitam
`sponsor:write`, como a Gestão) e `precisaDoSite`: sem o site no plano
(`siteIncluido`), `proporAcao` responde logo que não há site onde mexer.

Os campos de tipo `seccao`, `banner`, `produto`, `patrocinador`, `recinto` e
`jogo` são menus no formulário, com o que existe no clube (`dadosDoSite`), e
no servidor resolvem-se pelo id ou pelo nome (`escolher`: dois parecidos é
uma pergunta). As regras são as dos ecrãs do Website: quatro banners no
máximo, a bilheteira precisa de um recinto do Estádio com preços por omissão,
uma venda paga precisa dos pagamentos e da faturação ligados
(`motivoParaNaoVender`), o esgotado de um produto do Inventário vem do stock.

Cada proposta guarda uma operação (`payload.dados.op`) e o estado de antes;
`PropostasService.executarSite` corre-a ao confirmar pelos serviços de sempre
(`SiteService.atualizar`, `criarProduto`, `gravarBilheteira`,
`PatrocinadoresService.criar`…) e o desfazer é outra operação da mesma tabela
(criar ↔ apagar, mudar ↔ repor, página de início ↔ a de antes).

## Segurança

- **As permissões são as da pessoa.** Cada ação do registo tem a permissão
  que a consola pede para o mesmo gesto; `proporAcao` verifica-a ao propor,
  `PropostasService.confirmar` volta a verificá-la ao confirmar (a proposta
  pode ter ficado pendente e o cargo ter mudado), e os serviços verificam
  outra vez. As leituras passam pelos mesmos `can` e `teamScopeFilter`.
- **Um clube só.** Tudo corre em `prisma.runAs(ctx.academyId)`: o RLS do
  Supabase não deixa ver linhas de outro clube, por isso um id de outro clube é
  "não encontrado". Nenhuma ferramenta nem campo aceita clube, slug, conta ou
  pessoa por parâmetro (o teste `test:adjunto` garante-o), e uma proposta só é
  confirmada por quem a pediu (`membershipId`).
- **Dados não são instruções.** O que volta das ferramentas vai ao modelo como
  JSON, e as instruções fixas dizem-lhe que nomes, ficheiros importados e
  mensagens do site são dados: texto lá dentro a mandar fazer algo ignora-se.
  Pedidos para agir noutro clube, "como administrador", ou para revelar as
  instruções recusam-se. Mesmo que o modelo se deixasse convencer, nada
  escreve sem o cartão confirmado, e a confirmação corre com a sessão e as
  permissões de quem carrega.
- **O site só existe no plano.** Sem `siteIncluido`, as ações do site e as
  notícias dizem que não há site; o `SiteService` recusa na mesma ao confirmar.

### Planos de treino (`planos.ts`, desde 12/11/2026)

`planear_treino` é a ação em que o modelo da conversa **não escreve o
resultado**: só recolhe a equipa, o treino (ou o dia, e o servidor encontra o
treino desse dia), o que trabalhar, a intensidade, se usa a biblioteca e se
procura ideias na internet. Com tudo respondido, `proporPlano` monta um pedido
à parte ao modelo forte (`ROTA_PLANEADOR`), com a resposta presa a
`ESQUEMA_DO_PLANO` (saída estruturada) e, se pedido, a ferramenta
`web_search` do fornecedor. O pedido leva o terreno da equipa
(`terrenoDaEquipa`, a mesma regra de `teamFormat` na consola), a duração do
treino, o plano que já lá estava e a biblioteca do clube dessa modalidade
(ids, nomes, categoria, minutos, idades; nunca os desenhos).

O modelo desenha em **percentagem do campo inteiro** (x de 0 a 100 entre as
balizas, y de 0 a 100 de cima para baixo; meio campo entre 50 e 100).
`lerDesenho` converte para os metros do editor (`FORMAT_PITCH`), deita fora
peças e setas que não existem, põe dentro do campo o que saiu, vira as balizas
para o campo (`rotacaoDaBaliza`) e traduz os coletes pelo nome
(`QUICK_COLORS`). `lerPlanoGerado` faz o mesmo ao plano: um id que não é da
biblioteca cai com aviso, um bloco sem nome sai.

A proposta (`TRAINING_PLAN`) leva a sessão, os blocos e os exercícios novos
inteiros; o cartão mostra os blocos com a miniatura do primeiro frame
(`FieldView`). Confirmar (`gravarPlano`) cria os exercícios novos na biblioteca
do clube (`createExercise`, `CLUB`) e grava a sessão (`savePlan`), guardando o
plano anterior; desfazer repõe-no e apaga os exercícios criados
(`deleteExercise`: já sem uso, saem de vez). "Editar" no cartão volta a gerar
o plano. Custo estimado (por medir em `AdjuntoUsage`): 5 a 12 cêntimos por
plano no forte, esforço baixo, limite de três minutos sem repetições; mudar
de nível é mudar `ROTA_PLANEADOR`.

`criar_exercicio` (tipo `EXERCISE`) usa o mesmo autor com outra forma de
resposta (`ESQUEMA_DO_EXERCICIO`, a ficha de um exercício só): pede a equipa
e o que trabalhar, não toca em treino nenhum, e ao confirmar cria o exercício
na biblioteca do clube (`createExercise`); desfazer apaga-o. A ligação para a
ficha só existe depois de gravar, por isso vem em `result.abrir`.

## A importação

Cinco passos, em `importacao/`:

1. **Extrair** (`extrair.ts`): o ficheiro vira folhas com cabeçalhos e linhas.
   O cabeçalho é a primeira linha com duas ou mais células cheias, a maioria
   texto, por isso o nome do clube em cima da tabela não estorva. Datas do
   Excel ficam `AAAA-MM-DD`.
2. **Mapear** (`mapear.ts`): o modelo forte vê os cabeçalhos e cinco linhas
   mascaradas (um NIF é `#########`, um nome é "Martim B.") e decide uma vez o
   que é cada folha e cada coluna, que equipas do ficheiro são quais do clube,
   e que dúvidas tem (dia/mês ou mês/dia).
3. **Transformar** (`transformar.ts`): o código aplica o mapeamento a todas as
   linhas, determinístico. O modelo nunca vê as linhas.
4. **Ensaiar**: `AthletesService.importMany` com `ensaio: true` corre tudo e
   desfaz a transação no fim. Sai "157 entram, 41 já existiam, 14 com
   problemas".
5. **Confirmar**: criam-se as equipas novas (`createTeam`) e corre-se a
   importação a sério. "Importar só os novos" tira da folha quem o ensaio
   reconheceu; "Importar e atualizar" manda `sobrescrever`.

Por agora só atletas. Staff, sócios, calendário e inventário ficam mapeados e
marcados "para depois". Fotografias e PDF recusam-se com uma mensagem clara.

## A voz

Primeiro o reconhecimento do browser (Web Speech API, `pt-PT`, com o texto a
aparecer enquanto se fala). Onde não existe, grava-se com `MediaRecorder` e
manda-se a `POST /api/adjunto/transcrever` (`gpt-transcribe`). Nos dois casos o
texto fica na caixa antes de enviar.

### Conversa por voz (mãos livres)

`components/adjunto/ModoVoz.tsx`. O ciclo é ouvir → enviar → dizer → ouvir:
a pessoa fala, ao calar-se a frase segue, a resposta chega por escrito (a
conversa e os cartões são os de sempre) e é dita em voz alta por
`GET /api/adjunto/mensagens/:id/voz` (`gpt-4o-mini-tts`, voz `marin`, MP3;
`ADJUNTO_MODELO_VOZ` e `ADJUNTO_VOZ` mudam-nos). Tocar no botão grande a meio
da resposta corta-a; dois silêncios seguidos põem em pausa. **Confirmar
continua a ser um toque no cartão**: dizer "confirma" não grava.

O altifalante prepara-se dentro do toque que liga o modo
(`prepararAltifalante`), porque o iOS só deixa tocar som a seguir a um gesto e
a resposta chega segundos depois.

## Dados e lei

- O que sai para o fornecedor: a mensagem da pessoa, os nomes de atletas que
  as ferramentas devolvem (sem data de nascimento, NIF, contactos ou
  diagnóstico), os cabeçalhos e amostras mascaradas de um ficheiro.
- `store: false` em todos os pedidos. A retenção zero e a rota europeia
  (`OPENAI_BASE_URL=https://eu.api.openai.com/v1`) pedem-se na conta do
  fornecedor; o acordo de tratamento de dados e a lista de subcontratantes
  dos clubes têm de o referir antes de haver clube real.
- A consola diz sempre que é uma IA e que nada é gravado sem confirmar
  (artigo 50 do AI Act).
- `AdjuntoUsage` conta tokens por clube, mês e modelo: é o que permite um
  limite por plano e saber o custo real.

## Ambiente

```
OPENAI_API_KEY=sk-...                        # sem ela o Adjunto fica desligado (503, botão escondido)
OPENAI_BASE_URL=https://eu.api.openai.com/v1 # opcional: a rota europeia
ADJUNTO_MODELO_LEVE=gpt-6-luna               # os três níveis, com estes valores por omissão
ADJUNTO_MODELO_MEDIO=gpt-6.1-terra
ADJUNTO_MODELO_FORTE=gpt-6.1-sol
ADJUNTO_MODELO_TRANSCRICAO=gpt-transcribe
```

`Academy.adjuntoEnabled` desliga o Adjunto num clube só. Nasce ligado; a
decisão comercial (que plano o traz) vem depois.

## Testes

`npm run test:adjunto --workspace @academia/api`: nomes, rotas, datas,
máscaras e um Excel inteiro de ponta a ponta (ler, sanear o mapeamento,
transformar), sem servidor nem modelo.
