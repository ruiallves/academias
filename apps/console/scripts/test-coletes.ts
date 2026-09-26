/**
 * Os coletes do quadro tático — as cores dos jogadores.
 *
 * ## O que se está a proteger
 *
 * Um treinador pediu 3 ou 4 cores onde havia duas, e a cor deixou de ser o tipo
 * da peça (`player` / `opponent`) para passar a ser um atributo dela. Três coisas
 * podem partir-se em silêncio nessa troca:
 *
 * 1. **os desenhos que já existem** — milhares de exercícios guardados com
 *    `opponent`. Se a tradução falhar ou a cor histórica mudar, um clube reabre
 *    o exercício de sempre e encontra-o diferente;
 * 2. **o número deixa de se ler** — o número vai escrito por cima do colete, e
 *    uma cor nova com a tinta errada dá um 7 branco sobre amarelo. É a falha que
 *    ninguém vê a escrever o código e todos veem no campo;
 * 3. **a numeração por equipa** — era grátis com dois tipos de peça (cada um
 *    numerava à parte) e é fácil de perder ao contar por tipo com cinco equipas.
 *
 * Corre as funções verdadeiras, agrupadas com esbuild como os outros testes da
 * consola.
 *
 * Uso: npm run test:coletes
 */
import {
  ALL_ITEM_KINDS,
  GK_FILL,
  INK_DARK,
  INK_LIGHT,
  ITEM_LABEL,
  OPPONENT_FILL,
  PLAYER_FILL,
  QUICK_COLORS,
  MAX_RECENTES,
  contrasteWcag,
  coresDaPeca,
  coresRecentes,
  guardarCorRecente,
  haloFor,
  inkFor,
  nextNumber,
  normalizarDiagrama,
  normalizarItem,
  type Diagram,
  type DiagramItem,
  type PieceColor,
} from "../src/lib/training";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};

const peca = (over: Partial<DiagramItem> = {}): DiagramItem => ({ id: "i1", kind: "player", x: 10, y: 20, ...over });

/* -------------------------------------------------------------------------- */
console.log("=== 1. Um desenho antigo fica exactamente como estava ===");

/*
 * A garantia mais importante do lote. Um adversário desenhava-se branco com
 * tinta escura; depois da mudança tem de continuar a desenhar-se assim, tenha
 * sido traduzido ou não.
 */
const antes = coresDaPeca({ kind: "opponent" });
const depois = coresDaPeca(normalizarItem(peca({ kind: "opponent", label: "9" })));
check("o adversário traduzido fica com a cor que o adversário tinha", antes.fill === depois.fill && antes.ink === depois.ink, JSON.stringify({ antes, depois }));
check("e continua a ser branco com tinta escura", depois.fill.toLowerCase() === "#f4f1ea", depois.fill);

const traduzido = normalizarItem(peca({ kind: "opponent", label: "9", rot: 45 }));
check("passa a ser jogador", traduzido.kind === "player", traduzido.kind);
check("com colete branco", traduzido.color === OPPONENT_FILL, String(traduzido.color));
check("e não perde o número", traduzido.label === "9", String(traduzido.label));
check("nem a posição", traduzido.x === 10 && traduzido.y === 20);
check("nem a rotação", traduzido.rot === 45, String(traduzido.rot));

/* Traduzir duas vezes tem de dar o mesmo — o editor lê a cada abertura. */
check("traduzir é idempotente", JSON.stringify(normalizarItem(traduzido)) === JSON.stringify(traduzido));

/* Um jogador já com cor não se toca, e as outras peças também não. */
const vermelho = peca({ kind: "player", color: "#b3261e", label: "4" });
check("um jogador com cor fica igual", normalizarItem(vermelho) === vermelho);
const cone = peca({ kind: "cone" });
check("um cone fica igual", normalizarItem(cone) === cone);

/*
 * O guarda-redes continua laranja. Foi por isto que o carimbo não lhe aplica o
 * colete armado: a cor dele é informação, vê-se num relance quem ele é.
 */
const gk = coresDaPeca({ kind: "gk" });
check("o guarda-redes sem colete continua laranja", gk.fill.toLowerCase() === GK_FILL, gk.fill);
check("e o jogador sem colete continua azul", coresDaPeca({ kind: "player" }).fill.toLowerCase() === PLAYER_FILL);
/* Mas dá para lhe vestir um, que é o que um exercício com duas balizas precisa. */
check("um guarda-redes com colete usa o colete", coresDaPeca({ kind: "gk", color: "#b3261e" }).fill === "#b3261e");

/* -------------------------------------------------------------------------- */
console.log("\n=== 2. O diagrama inteiro, e sem mexer no que não precisa ===");

const d = (items: DiagramItem[]): Diagram => ({ field: "f11", frames: [{ id: "f1", items, arrows: [] }] });

const limpo = d([peca({ kind: "player" }), cone]);
check("um diagrama sem adversários volta o MESMO objecto", normalizarDiagrama(limpo) === limpo);

const sujo = d([peca({ id: "a", kind: "opponent" }), peca({ id: "b", kind: "player" })]);
const lavado = normalizarDiagrama(sujo);
check("um diagrama com adversários é traduzido", lavado.frames[0].items.every((i) => i.kind !== "opponent"));
check("e só o adversário muda", lavado.frames[0].items[1] === sujo.frames[0].items[1]);
check("o original não é tocado", sujo.frames[0].items[0].kind === "opponent");

/* -------------------------------------------------------------------------- */
console.log("=== 3. O número lê-se por cima de QUALQUER cor ===");

/*
 * A propriedade que a cor livre exige.
 *
 * Com uma paleta fixa bastava conferir seis pares à mão. Com uma roda de cor o
 * treinador pode escolher os 16 milhões — e um amarelo claro com número branco
 * por cima é uma peça sem número. Por isso varre-se o espaço todo, em passos, e
 * exige-se que `inkFor` encontre sempre contraste suficiente.
 *
 * 4,5:1 é o mínimo do WCAG para texto normal, e não se baixa: o número é pequeno
 * no ecrã e o desenho ainda vai para PDF impresso num clube.
 */
let piorTinta = { fill: "", r: Infinity };
let piorAresta = { fill: "", r: Infinity };
let amostras = 0;
for (let r = 0; r < 256; r += 15)
  for (let g = 0; g < 256; g += 15)
    for (let b = 0; b < 256; b += 15) {
      const fill = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
      amostras++;
      const daTinta = contrasteWcag(fill, inkFor(fill));
      if (daTinta < piorTinta.r) piorTinta = { fill, r: daTinta };
      /* A aresta: a melhor das duas contra o colete. Com o número contornado,
         basta uma delas destacar-se do fundo para o glifo ter um limite vísivel. */
      const aresta = Math.max(daTinta, contrasteWcag(fill, haloFor(fill)));
      if (aresta < piorAresta.r) piorAresta = { fill, r: aresta };
    }

/*
 * Há cores onde **nenhuma** das duas tintas chega aos 4,5:1, e isso não se
 * resolve escolhendo melhor: um tom médio está longe do branco e do escuro ao
 * mesmo tempo. Foi este varrimento que o mostrou (`#5a9696`, 3,4:1), e foi por
 * isso que o número passou a ser contornado.
 */
check(
  `sozinha, a tinta não chega em todas as cores (pior: ${piorTinta.fill}, ${piorTinta.r.toFixed(2)}:1)`,
  piorTinta.r < 4.5,
  "se isto passar a ser sempre >= 4.5, o contorno deixou de ser preciso",
);

/*
 * O que se exige, com contorno: em qualquer cor, uma das duas tintas destaca-se
 * do colete. É o limiar de 3:1 do WCAG para objectos gráficos — e um glifo
 * contornado é exactamente isso: uma forma com um limite, e não texto à solta
 * sobre um fundo.
 */
check(
  `em ${amostras} cores varridas, o número tem sempre aresta (pior: ${piorAresta.fill}, ${piorAresta.r.toFixed(2)}:1)`,
  piorAresta.r >= 3,
  piorAresta.fill,
);

/* E as duas tintas contrastam sempre uma com a outra — é o que faz o contorno ler-se. */
check(
  `a tinta e o contorno contrastam entre si (${contrasteWcag(INK_LIGHT, INK_DARK).toFixed(1)}:1)`,
  contrasteWcag(INK_LIGHT, INK_DARK) >= 7,
);
check("o contorno é sempre a outra tinta", haloFor("#000000") === INK_DARK && haloFor("#ffffff") === INK_LIGHT);
check("a peça traz as três cores", Boolean(coresDaPeca({ kind: "player" }).halo));

/* E a tinta é uma das duas, nunca uma terceira inventada. */
check("a tinta é branca ou escura", [INK_LIGHT, INK_DARK].includes(inkFor("#808080")));
check("sobre preto, tinta clara", inkFor("#000000") === INK_LIGHT);
check("sobre branco, tinta escura", inkFor("#ffffff") === INK_DARK);
/* Uma cor estranha num desenho guardado à mão não pode apagar a peça. */
check("uma cor ilegível não rebenta", [INK_LIGHT, INK_DARK].includes(inkFor("laranja")));
check("nem uma vazia", [INK_LIGHT, INK_DARK].includes(inkFor("")));
check("o formato curto também serve", inkFor("#fff") === INK_DARK, inkFor("#fff"));

/* -------------------------------------------------------------------------- */
console.log("\n=== 4. Os atalhos distinguem-se, inclusive com daltonismo ===");

/*
 * Os atalhos não são a lista de cores permitidas, mas são o que a maior parte dos
 * desenhos vai usar — e por isso têm de ser boas escolhas. A exigência é que duas
 * equipas se distingam uma da outra, e que se distingam também para quem não
 * separa vermelho de verde. A primeira tentativa tinha um verde escuro (#1f7a46)
 * que ficava a 27/441 do azul sob tritanopia e quase colado ao vermelho sob
 * deuteranopia: o verde ficou claro por causa disto, e não por gosto.
 */
const canal = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
const paraLinear = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
const paraSrgb = (c: number) => Math.round(255 * (c <= 0.00304 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055));
const VISAO: Record<string, number[][] | null> = {
  normal: null,
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  protanopia: [[0.567, 0.433, 0], [0.558, 0.442, 0], [0, 0.242, 0.758]],
  tritanopia: [[0.95, 0.05, 0], [0, 0.433, 0.567], [0, 0.475, 0.525]],
};
const comoSeVe = (hex: string, tipo: string) => {
  const v = [0, 1, 2].map((i) => paraLinear(canal(hex, i)));
  const m = VISAO[tipo];
  return (m ? m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]) : v).map(paraSrgb);
};
const distancia = (a: string, b: string, tipo: string) => {
  const [A, B] = [comoSeVe(a, tipo), comoSeVe(b, tipo)];
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

check("seis atalhos", QUICK_COLORS.length === 6, String(QUICK_COLORS.length));
check("sem cores repetidas", new Set(QUICK_COLORS.map((c) => c.fill.toLowerCase())).size === 6);
check("o azul e o branco de sempre vêm à frente", QUICK_COLORS[0].fill === PLAYER_FILL && QUICK_COLORS[1].fill === OPPONENT_FILL);

for (const tipo of Object.keys(VISAO)) {
  let pior = { par: "", d: Infinity };
  for (let i = 0; i < QUICK_COLORS.length; i++)
    for (let j = i + 1; j < QUICK_COLORS.length; j++) {
      const d = distancia(QUICK_COLORS[i].fill, QUICK_COLORS[j].fill, tipo);
      if (d < pior.d) pior = { par: `${QUICK_COLORS[i].label}/${QUICK_COLORS[j].label}`, d };
    }
  check(`${tipo}: o par mais parecido separa-se (${pior.par}, ${pior.d.toFixed(0)}/441)`, pior.d >= 50, pior.par);
}

/* -------------------------------------------------------------------------- */
console.log("\n=== 5. Cada equipa começa no 1 ===");

const equipa = (color: PieceColor, labels: string[]): DiagramItem[] =>
  labels.map((label, n) => peca({ id: `${color}${n}`, kind: "player", color, label }));

const campo = [...equipa(PLAYER_FILL, ["1", "2", "3"]), ...equipa("#b3261e", ["1"])];
check("o azul seguinte é o 4", nextNumber(campo, PLAYER_FILL) === "4", nextNumber(campo, PLAYER_FILL));
check("o vermelho seguinte é o 2", nextNumber(campo, "#b3261e") === "2", nextNumber(campo, "#b3261e"));
check("e em MAIÚSCULAS é o mesmo colete", nextNumber(campo, "#B3261E") === "2", nextNumber(campo, "#B3261E"));
check("uma cor nova começa no 1", nextNumber(campo, "#56c07a") === "1", nextNumber(campo, "#56c07a"));

/* Um jogador com bola é da equipa dele, e conta. */
const comBola = [...equipa(PLAYER_FILL, ["1"]), peca({ id: "z", kind: "playerBall", color: PLAYER_FILL, label: "2" })];
check("o jogador com bola gasta o número da equipa dele", nextNumber(comBola, PLAYER_FILL) === "3", nextNumber(comBola, PLAYER_FILL));

/* Um jogador sem cor é azul — é o que os desenhos antigos têm. */
check("um jogador sem cor conta como azul", nextNumber([peca({ kind: "player", label: "1" })], PLAYER_FILL) === "2");

/* O guarda-redes tem o número dele e não gasta o 1 da linha. */
check(
  "o guarda-redes não gasta números",
  nextNumber([peca({ id: "g", kind: "gk", color: PLAYER_FILL, label: "1" })], PLAYER_FILL) === "1",
);

/* -------------------------------------------------------------------------- */
console.log("\n=== 6. A paleta já não oferece adversários ===");

check("'opponent' saiu da paleta", !ALL_ITEM_KINDS.includes("opponent"), ALL_ITEM_KINDS.join(","));
check("mas o tipo continua a ter nome, para ler o que está guardado", Boolean(ITEM_LABEL.opponent));
check("'player' continua na paleta", ALL_ITEM_KINDS.includes("player"));

/* -------------------------------------------------------------------------- */
console.log("\n=== 7. A fila de cores usadas ===");

/*
 * Um armazenamento de mentira, para a fila poder ser exercitada fora do browser
 * — e para se poder pôr lá lixo, que é metade do que interessa provar.
 */
let guardado: Record<string, string> = {};
let explode = false;
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => {
    if (explode) throw new Error("janela privada");
    return guardado[k] ?? null;
  },
  setItem: (k: string, v: string) => {
    if (explode) throw new Error("quota");
    guardado[k] = v;
  },
};
const limpar = () => {
  guardado = {};
  explode = false;
};

limpar();
check("sem nada guardado, a fila são os atalhos", coresRecentes().join() === QUICK_COLORS.map((c) => c.fill).join());

limpar();
const comNova = guardarCorRecente("#123456");
check("uma cor nova fica à frente", comNova[0] === "#123456", comNova.join());
check("e os atalhos ficam atrás", comNova[1] === QUICK_COLORS[0].fill, comNova.join());
/* É um tecto e não um alvo: seis sementes mais uma nova são sete. */
check("a fila cabe no tecto", comNova.length <= MAX_RECENTES && comNova.length === QUICK_COLORS.length + 1, String(comNova.length));
check("e sobrevive à releitura", coresRecentes()[0] === "#123456", coresRecentes().join());

/*
 * O comportamento que faz a fila organizar-se sozinha: reescolher uma cor que já
 * lá está **move-a**, não a duplica. Sem isto, os quatro coletes de um treinador
 * iam saindo pela cauda à medida que ele experimentasse cores novas.
 */
limpar();
guardarCorRecente("#111111");
guardarCorRecente("#222222");
const movida = guardarCorRecente("#111111");
check("reescolher move para a frente", movida[0] === "#111111" && movida[1] === "#222222", movida.join());
check("e não duplica", movida.filter((c) => c === "#111111").length === 1, movida.join());

limpar();
guardarCorRecente("#AABBCC");
check("maiúsculas e minúsculas são a mesma cor", guardarCorRecente("#aabbcc").filter((c) => c === "#aabbcc").length === 1);

/* O tecto respeita-se ao fim de muitas. */
limpar();
for (let n = 0; n < 20; n++) guardarCorRecente("#" + n.toString(16).padStart(6, "0"));
check("depois de vinte, continua no tecto", coresRecentes().length === MAX_RECENTES, String(coresRecentes().length));
check("e a última escolhida está à frente", coresRecentes()[0] === "#000013", coresRecentes()[0]);

/*
 * O que está guardado não é de confiança: outra versão pode ter escrito outra
 * coisa, e um utilizador pode mexer na consola do browser. Nada disto pode
 * deixar o seletor sem cores.
 */
for (const [nome, cru] of [
  ["texto que não é JSON", "isto não é json"],
  ["um objecto em vez de uma lista", '{"a":1}'],
  ["uma lista vazia", "[]"],
  ["coisas que não são cores", '["vermelho", 42, null]'],
]) {
  limpar();
  guardado["academia.quadro.cores"] = cru;
  const fila = coresRecentes();
  check(`${nome}: volta aos atalhos`, fila.join() === QUICK_COLORS.map((c) => c.fill).join(), fila.join());
}

limpar();
guardado["academia.quadro.cores"] = '["#ff0000", "nao-e-cor", "#00ff00"]';
check("mistura boa e má: fica só a boa", coresRecentes().join() === "#ff0000,#00ff00", coresRecentes().join());

/* Numa janela privada o armazenamento deita excepção — e nada parte. */
limpar();
explode = true;
check("armazenamento a falhar: continua a haver cores", coresRecentes().length === QUICK_COLORS.length);
let guardouSemRebentar = true;
try {
  guardarCorRecente("#abcdef");
} catch {
  guardouSemRebentar = false;
}
check("e guardar não rebenta", guardouSemRebentar);
limpar();

/* Uma cor que não é hex nunca entra na fila. */
guardarCorRecente("#ff0000");
check("lixo não entra na fila", !guardarCorRecente("laranja").includes("laranja"), guardarCorRecente("laranja").join());

console.log("");
console.log(`${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);
