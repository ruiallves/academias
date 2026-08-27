# Sistema de design

## O que as referências ensinam

As três referências (Flup, Nexus, Vesper) funcionam pelos mesmos motivos. Vale a pena
nomeá-los, porque são eles — e não os screenshots — que copiamos.

1. **Separação por linha, não por sombra.** O canvas é claro, as superfícies são
   brancas, e o que as distingue é um traço de 1px. Nada flutua. Zero glassmorphism.
2. **A navegação é um índice, não um menu.** Sidebar persistente, itens agrupados sob
   rótulos minúsculos em maiúsculas. O utilizador aprende o produto lendo a sidebar.
3. **Uma página, uma acção primária.** Título à esquerda, botão escuro à direita. Tudo
   o resto é secundário e parece secundário.
4. **Os números são o herói.** Label pequeno e apagado, valor grande, e — crucial — o
   delta traz contexto (`+24% vs. mês anterior`). Um número sem comparação não informa.
5. **A tabela é o cavalo de batalha.** Monograma, nome, estado em *pill*, numéricos
   alinhados à direita. As referências não escondem tabelas atrás de cartões bonitos.
6. **Avareza cromática.** Um acento. Cor semântica só para estado. A densidade de cor
   de uma página inteira cabe numa mão.

O que deliberadamente **não** trazemos: gradientes roxos/azuis, cartões com brilho,
ícones de faísca, secções heroicas vazias.

## Direção própria

**Neutros quentes + um sinal.**

As referências usam cinzentos frios (base azulada). Nós usamos neutros quentes. Razão:
uma academia é um sítio de pessoas — miúdos, pais, treinadores — e o cinzento frio lê a
fintech. O quente baixa a temperatura institucional sem perder seriedade.

- **Tinta** (`ink`) faz o trabalho de hierarquia: quatro pesos, do preto quente ao
  cinzento de legenda. É também a cor dos botões primários — nunca white-label, para a
  legibilidade não depender da escolha de uma academia.
- **Sinal** (`signal`) é a cor do tenant. Aparece em identidade e selecção: item activo
  da navegação, anel de foco, série principal dos gráficos, marca. Nunca em estado.
- **Semânticas** (`ok` / `warn` / `risk`) são fixas e nunca white-label. Vencido é
  vermelho em todas as academias do mundo.

Esta regra — *sinal identifica, semântica avisa* — é o que impede o white-label de
transformar o produto em confusão.

## Tokens

Definidos uma vez em [`packages/ui/src/theme.css`](../packages/ui/src/theme.css) e
consumidos pelas duas apps. Tailwind v4, configuração em CSS (`@theme`).

| Token | Valor | Uso |
|---|---|---|
| `canvas` | `#F6F5F2` | fundo da página |
| `surface` | `#FFFFFF` | cartões, tabelas, sidebar |
| `sunken` | `#EFEDE8` | cabeçalho de tabela, campos, faixas |
| `line` | `#E5E2DC` | hairline por omissão |
| `line-strong` | `#D3CFC6` | separadores com peso |
| `ink` | `#1A1917` | títulos, valores, botão primário |
| `ink-2` | `#524F48` | texto corrente |
| `ink-3` | `#8A867C` | labels, meta |
| `ink-4` | `#ADA89D` | placeholder, desactivado |
| `signal` | `#0F6B62` | tenant — activo, foco, marca |
| `signal-strong` | derivado | a mesma cor, para superfícies **com** texto |
| `signal-on` | derivado | a tinta a usar por cima de `signal-strong` |
| `signal-ink` | derivado | a cor do clube como **texto**, sobre fundo claro |
| `signal-soft` | derivado | o fundo claro correspondente |
| `ok` `warn` `risk` | `#1F7A45` `#9A5B08` `#A82A20` | estado, fixo |

Cada semântica tem um par `-soft` para fundos de *pill*.

### O contraste é calculado, não configurado

O tenant escolhe **uma** cor. Tudo o resto sai dela em runtime, por `signalVars`
em [`packages/ui/src/tokens.ts`](../packages/ui/src/tokens.ts) — e o servidor faz a
mesma conta em `apps/api/src/common/contrast.ts` para as páginas que gera (landing,
sócios, e-mail de convite), onde não há CSS de tema a que recorrer.

A regra: **nunca se escreve branco por cima da cor do clube.** Escreve-se
`signal-on`, que é branco ou tinta escura consoante o que se lê melhor (WCAG 2.1,
alvo 4.5:1). Um clube de amarelo claro recebe tinta preta sem ninguém configurar
nada, e continua a ser um clube amarelo — a cor não se corrige, corrige-se a tinta.

`signal-strong` existe para a família de cores em que **nem branco nem preto**
chegam a 4.5:1 (cinzentos médios, vermelhos-tijolo): aí, e só aí, a cor anda um
passo na direcção que a tinta já pedia. Para as outras é igual a `signal`.

Consequência prática, e a razão de haver dois tokens para o mesmo tom: `signal`
pinta o que **não** tem texto por cima (o ponto de hoje, a barra de progresso, o
anel de foco); `signal-strong` pinta o que **tem**.

## Tipografia

**Instrument Sans** para tudo o que é interface, **Geist Mono** para referências de
pagamento, IBAN, IDs e colunas de dados densas.

Instrument Sans não é o Inter. Tem contraste e uma personalidade ligeiramente
geométrica que dá carácter a títulos pequenos sem gritar. Numerais tabulares ligados
(`font-variant-numeric: tabular-nums`) em toda a UI de dados — colunas que não dançam
quando os valores mudam.

Escala (rem / peso / tracking):

| Papel | Tamanho | Peso | Tracking |
|---|---|---|---|
| Métrica | 30px | 600 | `-0.02em` |
| Título de página | 22px | 600 | `-0.015em` |
| Título de painel | 14px | 600 | `-0.005em` |
| Corpo / tabela | 13.5px | 400–500 | 0 |
| Label de grupo | 11px | 600 | `0.08em`, maiúsculas |

## Forma e densidade

Raio 10px em painéis, 8px em controlos, pill completo em estados. Um pouco mais
apertado que as referências — é um workspace, não um site.

- Altura de linha de tabela: 52px
- Item de navegação: 34px
- Padding de página: 24px, 32px acima de 1280px, 40px acima de 1536px
- Padding de painel: 20px
- Grelha base: 4px

O conteúdo ocupa a largura toda da coluna principal — não há limite de largura nem
centragem. A sidebar já dá o enquadramento à esquerda; uma segunda moldura de margem
a meio do ecrã só afastava as colunas de dados umas das outras sem acrescentar
legibilidade. Onde uma largura enorme faria mal a um painel — o de comunicação, os
cartões de equipa — a grelha ganha colunas em vez de os esticar.

Sombras: só em elementos sobrepostos (menu, modal, popover). Uma superfície ao nível
da página nunca tem sombra.

## Movimento

O movimento existe para explicar continuidade, não para decorar.

- 120ms em hover e mudanças de estado
- 180ms `cubic-bezier(0.2, 0, 0, 1)` em painéis e sobreposições
- Zero animação de entrada em dados. Uma tabela que faz *fade in* linha a linha é
  bonita uma vez e irritante para sempre.
- `prefers-reduced-motion` respeitado.

## Escolhas específicas do produto

**Faixa da semana.** A academia corre a semanas. A Visão Geral do diretor e a do
treinador partilham uma faixa horizontal de 7 dias com a carga de treinos — é o
elemento que devolve o "pulso" e não existe nos concorrentes.

**Precisa de atenção.** Acima das métricas, não abaixo. Cada linha é um facto com um
verbo: *12 mensalidades vencidas · €1.740 →*. Se a lista estiver vazia, o estado vazio
diz "Está tudo em dia" e é um bom dia.

**Monogramas em vez de avatares.** As academias não têm fotos de toda a gente. Iniciais
sobre `sunken`, com a cor de sinal reservada para o próprio utilizador.

**Cor por escalão no calendário.** Distinguir oito escalões exige uma paleta
categórica, o que à primeira vista contraria a regra "cor semântica só para estado".
A regra sai reforçada, não aberta: **categoria e estado vivem em canais diferentes.**

- Categoria = *preenchimento* — fundo suave e ponto, da paleta `categorical` em
  `packages/ui/src/tokens.ts`.
- Estado = *contorno e etiqueta* — um treino sem treinador ganha borda e rótulo
  vermelhos, seja qual for o escalão.

As oito matizes foram escolhidas longe do verde-de-pago, do âmbar-de-aviso e do
vermelho-de-erro: teais, azuis, violetas, ameixas. Baixa saturação, porque um mês
inteiro destas cores tem de se poder olhar durante um minuto seguido. A cor de um
escalão vem da sua posição na lista de equipas, não de um hash do nome — renomear
"Sub-11" para "Iniciados" não repinta o calendário.

Um evento **sem escalão** fica sem cor. A ausência é o que o marca como evento da
academia toda.

**O detalhe de um jogo tem duas vidas, nunca ao mesmo tempo.** Antes de o jogo
acontecer, o painel mostra a convocatória (chamar, confirmar, dar falta). Depois de
o resultado ser registado, mostra a estatística (placar, marcadores) — e deixa de
mostrar a convocatória. Misturar as duas obrigaria a explicar porque é que um jogo
"concluído" ainda tinha uma lista de confirmações por fechar; separá-las por
`match.result` (presente ou ausente) resolve isso sem um interruptor manual de
"estado do jogo" para alguém se esquecer de mudar.
