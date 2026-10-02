# Capturas da consola

Capturas reais de `apps/console`, com os dados do clube inventado do `GUIAO.md`
e a rede toda simulada. Nenhum pedido chega à API, ao Supabase nem à base de
dados.

## Correr

Na raiz de `academia-pro`:

```
node apps/site/scripts/capturas/consola.mjs                      todas as cenas
node apps/site/scripts/capturas/consola.mjs con-atleta con-socios  só essas
node apps/site/scripts/capturas/consola.mjs --sem-build          reaproveita o último build
node apps/site/scripts/capturas/consola.mjs --ver                guarda também um PNG a 1920 na pasta de trabalho
node apps/site/scripts/capturas/consola.mjs --sem-remendos       fotografa a consola tal como está
```

Sai para `apps/site/public/shots/`: `<id>.webp` (3840×2160), `<id>-m.webp`
(1920×1080) e `manifesto-consola.json`, que é atualizado a cada captura.

No fim o script diz o que saiu para a rede (só as fontes do Google) e o que foi
abortado antes de sair. Uma cena com pedidos não simulados, avisos de erro no
ecrã ou um foco por encontrar fica marcada com `!` e o processo acaba com erro.

## O que é preciso ter

- `playwright-core` numa pasta fora do repositório, com um `package.json` ao
  lado. Por omissão `%TEMP%\claude\capturas-consola`; muda-se com a variável
  `CAPTURAS_TRABALHO`. Para a criar:
  `npm init -y && npm install playwright-core@1.62.1` dentro dessa pasta. A versão
  tem de casar com o Chromium instalado (a 1.62 usa a revisão 1234).
- O Chromium do Playwright em `%LOCALAPPDATA%\ms-playwright\chromium-*`, ou o
  caminho do executável em `CAPTURAS_CHROMIUM`.
- `vite` e `sharp`, que já estão no `node_modules` da raiz.

## Como funciona

1. A consola é compilada (`vite build`) para a pasta de trabalho, com o ambiente
   de `consola/ambiente/.env`: API em `127.0.0.1:3999` e Supabase em
   `127.0.0.1:3998`, duas portas onde não há nada. O `.env.local` da consola não
   é lido e nada é escrito dentro de `apps/console`.
2. O Chromium abre `http://127.0.0.1:5193`, mas não há servidor nenhum: o
   Playwright interceta todos os pedidos. Os da consola são respondidos com os
   ficheiros do build; os da API e do Supabase com os dados de `consola/`; as
   fontes do Google passam; qualquer outro destino é abortado. Não há portas
   abertas nem processos para matar.
3. A sessão é um JWT falso no `localStorage`, com validade até 2100. O relógio
   do browser fica parado na hora da cena, no fuso de Lisboa.

## Ficheiros

| Ficheiro | O que tem |
|---|---|
| `consola.mjs` | O build, a rede simulada e a captura. |
| `consola/cenas.mjs` | Uma entrada por captura: hora, endereço, o que fazer na página, focos. |
| `consola/clube.mjs` | O clube: equipas, atletas, staff, treinos, mensalidades, avisos, clínico. |
| `consola/jogos.mjs` | Os jogos, as convocatórias e a ficha do jogo de sábado. |
| `consola/tecnica.mjs` | Exercícios (com o desenho em futebol 9), planos de sessão, periodização. |
| `consola/desenvolvimento.mjs` | Avaliações. |
| `consola/outros.mjs` | Scouting e sócios. |
| `consola/api.mjs` | As rotas: que dados respondem a que pedido. |

Os dados dependem da hora da cena: um treino só tem presenças depois de acabar,
uma mensalidade só está paga depois do pagamento, um jogo só tem resultado depois
do apito final. A mesma semana fotografa-se em dias diferentes sem escrever dois
conjuntos de dados.

## Acrescentar uma captura

Junta uma entrada a `consola/cenas.mjs` e corre só essa com `--sem-build --ver`.
Se a página pedir algo que ainda não está simulado, o script diz o endereço
(`não simulado: GET /api/...`); a resposta acrescenta-se em `consola/api.mjs` ou
no módulo de dados que fizer sentido. O tipo que a consola espera está em
`apps/console/src/lib/`.

## Remendos

Dois defeitos da consola estragavam as capturas e são corrigidos na página, na
altura de fotografar, sem tocar no código do produto. Quando o produto for
corrigido, apagam-se.

1. **Acentos cortados no menu.** Os títulos de grupo do menu lateral (OPERAÇÃO,
   ÁREA TÉCNICA, GESTÃO, CLÍNICO) têm `line-height: 1` com `overflow: hidden`, e
   os acentos das maiúsculas ficam de fora: lê-se OPERAÇAO, AREA TECNICA, GESTAO,
   CLINICO. O remendo é uma linha de CSS em `REMENDOS`, em `consola.mjs`.
2. **Textos escritos à mão na Visão geral.** `routes/director/Overview.tsx` tem
   "Academia Life Club" por cima da saudação e "agosto" em "Cobrado em agosto" e
   "Cobrança de agosto". A cena `con-visao-geral` troca-os por "CD Academias" e
   "outubro" (`remendarTexto`, em `cenas.mjs`). Os números são os de outubro,
   calculados pela consola.

Com `--sem-remendos` nenhum dos dois é aplicado.
