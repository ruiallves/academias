#!/usr/bin/env node
/**
 * O que um ecrã de toque não perdoa.
 *
 * ## A avaria que deu origem a isto
 *
 * Uma fisioterapeuta, no telemóvel, a registar uma consulta: escreve o nome do
 * atleta, aparece a lista, toca no nome — **não selecciona e a lista
 * desaparece**. No computador o mesmo gesto funciona, e por isso ninguém tinha
 * dado por ela.
 *
 * Duas causas, as duas invisíveis a quem desenvolve num portátil:
 *
 *  1. **Coisas de tocar dentro de um `<label>`.** Um `<label>` reencaminha para
 *     o campo que rotula os toques que caiam lá dentro. Um botão ali deixa de
 *     receber o toque: ele vai parar ao campo de texto, o teclado reabre, e a
 *     escolha nunca acontece. Era o caso do selector de atleta, que vivia dentro
 *     de um `DialogField` — e o `DialogField` era um `<label>`. Na app das
 *     famílias era pior: tocar no nome de um documento legal para o **ler**
 *     marcava a caixa de o **aceitar**.
 *
 *  2. **Listas que deixam o campo perder o foco.** Tocar numa opção tira o foco
 *     ao campo de texto; no telemóvel isso fecha o teclado, e fechar o teclado
 *     devolve meio ecrã de altura **entre o dedo pousar e o dedo levantar**. A
 *     lista sobe, o dedo levanta noutro sítio, e o toque não escolhe nada. É o
 *     que `ListaDeEscolha` resolve, com `preventDefault` no `mousedown`.
 *
 * Este guião não corre a aplicação: lê o código e recusa os dois padrões. É a
 * mesma ideia de `check:access` — a regra fica escrita onde não se pode
 * esquecer dela.
 *
 * ## O que **não** é proibido
 *
 * Um `<label>` à volta do texto de uma caixa de marcar, que é o padrão certo. A
 * regra não persegue formas: persegue **ocorrências** — um rótulo que recebe de
 * fora algo de tocar, e uma lista de escolher ao lado de um campo de procura.
 *
 * Uso: node scripts/check-toque.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPS = ["apps/console/src", "apps/family/src", "apps/platform/src", "apps/site/src"];

/** Listas que já seguram o foco. Ver `ListaDeEscolha`, em `primitives.tsx`. */
const LISTA_SEGURA = "ListaDeEscolha";

/** O que não pode apanhar um toque dentro de um rótulo. */
const DE_TOCAR = [
  [/<button(?=[\s/>])/, "um <button>"],
  [/role="button"/, 'algo com role="button"'],
  [/<a\s[^>]*href/, "uma ligação"],
];

/* -------------------------------------------------------------------------- */

const ficheiros = [];
const andar = (dir) => {
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) andar(p);
    else if (p.endsWith(".tsx")) ficheiros.push(p);
  }
};
for (const app of APPS) {
  try {
    andar(path.join(RAIZ, app));
  } catch {
    /* uma app que não existe neste repositório */
  }
}

/** Onde fecha a etiqueta aberta em `i`, contando as iguais aninhadas. */
function fecho(s, i, tag) {
  const abre = new RegExp(`<${tag}(?=[\\s/>])`, "g");
  const fecha = new RegExp(`</${tag}>`, "g");
  let nivel = 0;
  let pos = i;
  while (pos < s.length) {
    abre.lastIndex = pos;
    fecha.lastIndex = pos;
    const a = abre.exec(s);
    const f = fecha.exec(s);
    if (!f) return s.length;
    if (a && a.index < f.index) {
      nivel++;
      pos = a.index + 1;
      continue;
    }
    nivel--;
    if (nivel <= 0) return f.index;
    pos = f.index + 1;
  }
  return s.length;
}

const linhaDe = (s, i) => s.slice(0, i).split("\n").length;
const curto = (f) => path.relative(RAIZ, f).replace(/\\/g, "/");

/**
 * Apaga os comentários, mantendo as posições.
 *
 * Este código explica-se muito, e metade das explicações fala de `<label>` —
 * incluindo as que dizem para **não** pôr botões lá dentro. Sem isto, o guião
 * acusava os comentários que existem precisamente porque alguém já aprendeu a
 * lição. Substitui-se por espaços para as linhas continuarem a bater certo.
 */
const semComentarios = (s) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (c, antes) => antes + " ".repeat(c.length - antes.length));

const codigo = new Map();
for (const f of ficheiros) codigo.set(f, semComentarios(readFileSync(f, "utf8")));

const problemas = [];

/* -------------------------------------------------------------------------- */
/* 1. Coisas de tocar dentro de um rótulo                                      */
/* -------------------------------------------------------------------------- */

for (const [f, s] of codigo) {
  for (const m of s.matchAll(/<label(?=[\s>])/g)) {
    const bloco = s.slice(m.index, fecho(s, m.index, "label"));
    const motivos = DE_TOCAR.filter(([r]) => r.test(bloco)).map(([, q]) => q);
    if (motivos.length === 0) continue;
    problemas.push(
      `${curto(f)}:${linhaDe(s, m.index)}\n` +
        `    <label> com ${motivos.join(" e ")} lá dentro.\n` +
        `    Num telemóvel o toque vai parar ao campo do rótulo. Põe o <label> só à volta do\n` +
        `    texto e liga-o ao campo com htmlFor (ver DialogField, em components/Dialog.tsx).`,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 1b. Rótulos que embrulham o que lhes derem                                  */
/* -------------------------------------------------------------------------- */

/*
 * O caso que escapa à regra de cima, porque o botão está escrito noutro
 * ficheiro: um componente com um `<label>` à volta de `{children}` ou de uma
 * ranhura tipo `{action}`. Quem o chama não vê que está a pôr um botão dentro de
 * um rótulo — era assim que o ecrã de aceitar os termos tinha lá o "Ler
 * documento", e era assim que o selector de atleta acabava dentro de um.
 *
 * Duas passagens, porque um `DialogField` é usado em quarenta ficheiros: a
 * primeira acha os embrulhos, a segunda procura quem lhes mete lá coisas.
 */
const embrulhos = [];
for (const [f, s] of codigo) {
  for (const m of s.matchAll(/<label(?=[\s>])/g)) {
    const fim = fecho(s, m.index, "label");
    const bloco = s.slice(m.index, fim);
    const ranhura = bloco.match(/\{(children|action|acao|extra|aside|botao|trailing)\}/);
    if (!ranhura) continue;
    /*
     * O componente a que este `<label>` pertence: a última declaração antes
     * dele. `match` com um `.*$` à frente não serve — devolve a **primeira**,
     * e daí saía o nome errado (e, com ele, uma lista de culpados que não
     * tinham nada a ver com o assunto).
     */
    let nome = null;
    let exportado = false;
    for (const d of s.slice(0, m.index).matchAll(/(export\s+)?(?:function|const)\s+([A-Z]\w*)/g)) {
      nome = d[2];
      exportado = Boolean(d[1]);
    }
    if (!nome) continue;
    /*
     * Exportado procura-se em toda a parte; local, só aqui. `Linha` é o nome
     * que meia dúzia de ficheiros dá ao seu componente de linha, e sem esta
     * distinção um deles levava com os usos dos outros às costas.
     */
    embrulhos.push({ nome, f, exportado, linha: linhaDe(s, m.index), ranhura: ranhura[1], de: m.index, ate: fim });
  }
}

for (const e of embrulhos) {
  const culpados = [];
  for (const [f, s] of codigo) {
    // Um componente local só se usa no ficheiro dele — e `Linha` é o nome que
    // meia dúzia de ficheiros dá ao seu. Sem isto, um levava os usos dos outros.
    if (!e.exportado && f !== e.f) continue;
    for (const uso of s.matchAll(new RegExp(`<${e.nome}(?=[\\s/>])`, "g"))) {
      if (f === e.f && uso.index >= e.de && uso.index <= e.ate) continue; // a própria definição
      const usoBloco = s.slice(uso.index, fecho(s, uso.index, e.nome));
      const motivos = DE_TOCAR.filter(([r]) => r.test(usoBloco)).map(([, q]) => q);
      if (motivos.length) culpados.push(`${curto(f)}:${linhaDe(s, uso.index)} (${motivos.join(" e ")})`);
    }
  }
  if (culpados.length === 0) continue;
  problemas.push(
    `${curto(e.f)}:${e.linha}\n` +
      `    <label> à volta de {${e.ranhura}}, e ${e.nome} recebe coisas de tocar:\n` +
      culpados.map((c) => `      ${c}`).join("\n") +
      `\n    No telemóvel esse toque vai parar ao campo do rótulo. Põe o <label> só à volta do\n` +
      `    texto e liga-o ao campo com htmlFor (ver DialogField, em components/Dialog.tsx).`,
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Listas de escolher que não seguram o foco                                */
/* -------------------------------------------------------------------------- */

/*
 * O padrão perigoso é preciso, e vale a pena procurá-lo com precisão: um campo
 * onde se escreve para filtrar, e ao lado a lista do que bateu certo, para
 * tocar. Uma barra de navegação ou uma lista de pessoas já atribuídas não
 * contam — sem um campo com o teclado aberto não há teclado para fechar, e é o
 * fechar do teclado que estraga o toque.
 */
for (const [f, s] of codigo) {
  const PROCURA = /<input(?=[\s/>])[^>]*value=\{(q|query|procura|pesquisa|busca|termo|texto|filtro)[\s}]/g;
  const campos = [...s.matchAll(PROCURA)].map((c) => c.index);
  if (campos.length === 0) continue;

  for (const m of s.matchAll(/<ul(?=[\s>])/g)) {
    // A distância é o que os diz companheiros: uma lista que responde a um
    // campo escreve-se sempre ao lado dele.
    if (!campos.some((i) => m.index > i && m.index - i < 2500)) continue;
    const bloco = s.slice(m.index, fecho(s, m.index, "ul"));
    const eEscolha = /\.map\(/.test(bloco) && /<button(?=[\s/>])/.test(bloco) && /onClick=/.test(bloco);
    if (!eEscolha) continue;
    if (/onMouseDown=/.test(bloco)) continue; // já segura o foco à mão
    problemas.push(
      `${curto(f)}:${linhaDe(s, m.index)}\n` +
        `    lista de escolher ao lado de um campo de procura, sem segurar o foco.\n` +
        `    Troca a <ul> por <${LISTA_SEGURA}> (components/primitives.tsx): no telemóvel, tocar\n` +
        `    numa opção fecha o teclado, a página salta, e o toque escolhe a linha errada ou nenhuma.`,
    );
  }
}

/* -------------------------------------------------------------------------- */

if (problemas.length) {
  console.log(`\n  ${problemas.length} ${problemas.length === 1 ? "sítio" : "sítios"} que um telemóvel não perdoa:\n`);
  for (const p of problemas) console.log("  " + p + "\n");
  process.exit(1);
}

console.log(`  OK  ${ficheiros.length} ecrãs — nada de tocar dentro de rótulos, e as listas de escolher seguram o foco.`);
