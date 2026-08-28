#!/usr/bin/env node
/**
 * A cor do clube tem de se ver — em cima dela e por baixo dela.
 *
 * ## O bug
 *
 * O realce de foco era `outline: 2px solid var(--color-signal)`. Num clube de
 * amarelo claro isso dá **1,3:1** contra o branco da página: o contorno está lá,
 * ninguém o vê, e quem navega pelo teclado deixa de saber onde está. Um clube
 * verde-escuro tem 6,4:1 e nunca deu por nada — que é o que faz este tipo de
 * defeito passar meses sem aparecer.
 *
 * É o mesmo problema que o menu já tinha tido, e a lição é a mesma: **nenhuma cor
 * de tenant pode ir crua para o ecrã**. Vai sempre por um tom derivado que
 * garante o contraste do sítio onde é usada.
 *
 * ## As duas direcções, que são problemas diferentes
 *
 *  - `strongSignal` / `signal-ink` — a tinta lê-se **em cima** da cor. É para
 *    superfícies cheias: um botão, uma pastilha.
 *  - `signalOnSurface` / `signal-line` — a cor lê-se **sobre** a página. É para
 *    traços finos: o contorno de foco, o arco do disco de carregamento.
 *
 * Ter só a primeira era o buraco.
 *
 * Uso: node scripts/test-cor-do-clube.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { signalVars, signalOnSurface, strongSignal } from "../../../packages/ui/src/tokens.ts";

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

/* O cálculo de contraste da WCAG, escrito aqui de propósito: se o teste usasse a
 * função do produto, provava que ela concorda consigo própria. */
const rgb = (h) => {
  const x = h.replace("#", "");
  const f = x.length === 3 ? x.split("").map((c) => c + c).join("") : x;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};
const lum = (h) =>
  rgb(h)
    .map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : Math.pow((v / 255 + 0.055) / 1.055, 2.4)))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/** As que partiam, e as que já estavam bem. */
const CORES = [
  ["amarelo claro", "#f5e050", false],
  ["amarelo vivo", "#ffd400", false],
  ["laranja", "#f59e0b", false],
  ["lima", "#c7f464", false],
  ["branco sujo", "#f2f2f2", false],
  ["verde escuro", "#0f6b62", true],
  ["azul", "#1d4ed8", true],
  ["vermelho", "#c62828", true],
  ["preto", "#111111", true],
];

console.log("=== O traço sobre a página vê-se sempre ===");
/*
 * 3:1 é o mínimo que a WCAG 1.4.11 pede para um indicador de interface —
 * exactamente o caso de um contorno de foco. Não é um número escolhido a gosto.
 */
for (const [nome, hex] of CORES.map((c) => c)) {
  const linha = signalOnSurface(hex);
  const r = contraste(linha, "#ffffff");
  check(`${nome} (${hex}) → ${linha} a ${r.toFixed(2)}:1`, r >= 2.95, `${r.toFixed(2)}`);
}

console.log("\n=== E a variável chega ao CSS ===");
const vars = signalVars("#f5e050");
check("`--color-signal-line` existe", typeof vars["--color-signal-line"] === "string", JSON.stringify(Object.keys(vars)));
check("e não é a cor crua", vars["--color-signal-line"] !== "#f5e050", vars["--color-signal-line"]);
check("mas `--color-signal` continua a ser", vars["--color-signal"] === "#f5e050", vars["--color-signal"]);

console.log("\n=== Quem já estava bem não muda ===");
/*
 * A parte que faz isto ser aceitável: um clube que escolheu a cor com cuidado
 * fica com **exactamente** o tom que tinha. Só mexe em quem não passava.
 */
for (const [nome, hex, jaEstavaBem] of CORES) {
  if (!jaEstavaBem) continue;
  check(`${nome} fica intacta`, signalOnSurface(hex) === hex, `${hex} → ${signalOnSurface(hex)}`);
}
const mudaram = CORES.filter(([, hex]) => signalOnSurface(hex) !== hex).length;
check("e só as que precisavam mudaram", mudaram === CORES.filter(([, , bem]) => !bem).length, `${mudaram}`);

console.log("\n=== As duas direcções não se confundem ===");
/*
 * `strongSignal` resolve o problema oposto — a tinta em cima da cor — e não
 * serve para isto. A contraprova: para um amarelo, ele devolve a cor quase
 * intacta (o preto lê-se lá em cima), e essa cor continua invisível sobre a
 * página. Era por aqui que a tentação de reutilizar a função existente falhava.
 */
const amarelo = "#ffd400";
check(
  "`strongSignal` mantém o amarelo — o preto lê-se em cima dele",
  contraste(strongSignal(amarelo), "#000000") >= 4.4,
  `${strongSignal(amarelo)}`,
);
check(
  "mas esse amarelo continuaria invisível como traço",
  contraste(strongSignal(amarelo), "#ffffff") < 3,
  `${contraste(strongSignal(amarelo), "#ffffff").toFixed(2)}:1`,
);
check(
  "e é por isso que `signalOnSurface` existe",
  contraste(signalOnSurface(amarelo), "#ffffff") >= 2.95,
  `${contraste(signalOnSurface(amarelo), "#ffffff").toFixed(2)}:1`,
);

console.log("\n=== Entradas estranhas não rebentam ===");
check("aceita hex de três dígitos", /^#[0-9a-f]{6}$/.test(signalOnSurface("#fe0")), signalOnSurface("#fe0"));
check("o branco puro escurece até se ver", contraste(signalOnSurface("#ffffff"), "#ffffff") >= 2.95, signalOnSurface("#ffffff"));
check("o preto puro fica onde está", signalOnSurface("#000000") === "#000000", signalOnSurface("#000000"));

console.log("\n=== Nenhum traço usa a cor crua ===");
/*
 * O guarda que faz isto valer a pena daqui a seis meses.
 *
 * Ter o tom certo não chega — é preciso que os ecrãs o usem. `border-signal` e
 * `text-signal` são a cor crua do clube: numa borda ou num texto sobre a página,
 * desaparecem em qualquer clube de cor clara. Há um token para cada caso, e a
 * regra é usá-los:
 *
 *   `border-signal-line`  para o traço sobre a página
 *   `text-signal-ink`     para o texto sobre fundo claro
 *
 * A cor crua continua certa para **fundos** (`bg-signal`), que é o caso em que
 * ela é o próprio fundo e a tinta se calcula por cima.
 */
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function tsx(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) tsx(p, achados);
    else if (nome.endsWith(".tsx")) achados.push(p);
  }
  return achados;
}

/* Sem sufixo — as variantes (`-line`, `-ink`, `-soft`, `-on`) são as corrigidas. */
const CRUA = /\b(border|text)-signal(?![\-\w])/;

const cruas = [];
for (const app of ["console", "family"]) {
  for (const ficheiro of tsx(path.join(RAIZ, app, "src"))) {
    readFileSync(ficheiro, "utf8").split("\n").forEach((linha, i) => {
      if (CRUA.test(linha)) cruas.push(`${app}/${path.relative(path.join(RAIZ, app), ficheiro)}:${i + 1}`);
    });
  }
}
check("nenhuma borda ou texto na cor crua do clube", cruas.length === 0, cruas.join("  "));
console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);
