#!/usr/bin/env node
/**
 * A exportação da área técnica para PDF.
 *
 * ## O que aqui se prova, e porque é que não é a olho
 *
 * O PDF gera-se no browser, e a tentação era abrir a página e ver se descarrega.
 * Isso prova que sai um ficheiro — não prova que **o desenho lá está**. Um SVG
 * que o canvas recusa desenha um rectângulo branco, e um rectângulo branco num
 * PDF parece um campo por preencher.
 *
 * Por isso este teste corre o módulo a sério, num DOM de mentira que conta o que
 * lhe pedem: quantas páginas se abriram, que imagens foram lá postas, e com que
 * medidas. É a diferença entre "descarregou" e "está lá dentro".
 *
 * ## A regra que interessa
 *
 * **Uma página por frame.** Um exercício de quatro frames tem de dar quatro
 * páginas com quatro imagens diferentes; um de um frame não gasta página nenhuma
 * a dizer "Frame 1 de 1".
 *
 * Uso: node scripts/test-training-pdf.mjs
 */
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(AQUI, "..");

let ok = 0, bad = 0;
const check = (l, c, d = "") => {
  if (c) { ok++; console.log("  OK    " + l); }
  else { bad++; console.log("  FALHA " + l + (d ? " — " + d : "")); }
};

/* -------------------------------------------------------------------------- */
/* Um browser do tamanho do que o módulo usa                                   */
/* -------------------------------------------------------------------------- */

/** Tudo o que o `jsPDF` de mentira registou — é isto que se verifica no fim. */
const registo = { paginas: 1, imagens: [], textos: [], nomeGravado: null };

/*
 * Os SVG que passaram pelo canvas.
 *
 * Guardam-se inteiros: é neles que se vê se o desenho tem jogadores e setas, ou
 * se veio um campo vazio.
 */
const svgsDesenhados = [];

class FakeImage {
  set src(url) {
    /*
     * O `onload` **tem** de ser assíncrono.
     *
     * Chamá-lo aqui, de imediato, corria antes de o módulo lhe atribuir o
     * `onload` — e a promessa ficava pendurada para sempre. É o mesmo erro que o
     * browser não perdoa e que só aparece em runtime.
     */
    const svg = decodeURIComponent(String(url).replace(/^data:image\/svg\+xml;charset=utf-8,/, ""));
    svgsDesenhados.push(svg);
    queueMicrotask(() => {
      if (!svg.includes("<svg")) this.onerror?.(new Error("não é svg"));
      else this.onload?.();
    });
  }
}

globalThis.Image = FakeImage;
globalThis.document = {
  createElement: (tag) => {
    if (tag !== "canvas") return {};
    return {
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(_) {} }),
      toDataURL: () => "data:image/png;base64,ZmFrZQ==",
    };
  },
};

/** O `jsPDF`, reduzido ao que o módulo lhe chama. */
class FakeDoc {
  addPage() { registo.paginas += 1; }
  setPage() {}
  getNumberOfPages() { return registo.paginas; }
  setFont() {} setFontSize() {} setTextColor() {} setDrawColor() {} setLineWidth() {}
  line() {} rect() {}
  text(t) { registo.textos.push(...(Array.isArray(t) ? t : [String(t)])); }
  addImage(_png, _fmt, x, y, w, h) { registo.imagens.push({ pagina: registo.paginas, x, y, w, h }); }
  splitTextToSize(t, largura) {
    // Uma quebra grosseira, mas fiel no que importa: devolve linhas.
    const palavras = String(t).split(/\s+/);
    const porLinha = Math.max(1, Math.floor(largura / 2));
    const linhas = [];
    for (let i = 0; i < palavras.length; i += porLinha) linhas.push(palavras.slice(i, i + porLinha).join(" "));
    return linhas.length ? linhas : [""];
  }
  save(nome) { registo.nomeGravado = nome; }
}

/* -------------------------------------------------------------------------- */
/* Os módulos que o `training-pdf` importa                                     */
/* -------------------------------------------------------------------------- */

const academia = { slug: "ad-fafe", shortName: "AD Fafe", name: "AD Fafe", signalColor: "#f5e050" };

/*
 * Só o `jspdf` e o `store` é que são substituídos.
 *
 * `FieldView`, `Pitch` e o resto do desenho entram **a sério**, do ficheiro do
 * produto: é precisamente o desenho que se quer ver a sair. Trocá-lo por uma
 * imitação era testar a imitação.
 */
const substitutos = new Map([
  ["jspdf", { jsPDF: FakeDoc }],
  ["@/lib/store", { academy: academia }],
]);

/*
 * O stub do `store` tem de exportar **todos** os nomes que o real exporta.
 *
 * `training.ts` puxa `api.ts`, que importa uma dúzia de listas do store —
 * `athletes`, `fees`, `teams`. Nenhuma serve para nada aqui, mas o esbuild
 * resolve os nomes em tempo de compilação e recusa-se a ligar o que não existe.
 * Lê-se a lista do ficheiro real em vez de a escrever à mão: assim uma exportação
 * nova não parte este teste com um erro que não explica nada.
 */
const NOMES_DO_STORE = [
  ...readFileSync(path.join(RAIZ, "src/lib/store.ts"), "utf8")
    .matchAll(/^export (?:let|const|function|async function) (\w+)/gm),
].map((m) => m[1]);

/* -------------------------------------------------------------------------- */
/* Dados de exemplo                                                            */
/* -------------------------------------------------------------------------- */

const frame = (n, itens) => ({
  id: `f${n}`,
  durationMs: 1200,
  note: `Nota do frame ${n}`,
  items: itens,
  arrows: [{ id: `a${n}`, kind: "pass", x1: 20, y1: 20, x2: 40, y2: 30 }],
});

const jogador = (id, x, y) => ({ id, kind: "player", x, y, label: String(id) });

const EXERCICIO = {
  name: "Posse 4v4 com apoios",
  description: "Manter a posse em espaço reduzido.",
  category: "Posse de bola",
  objectives: ["Posse", "Pressão após perda"],
  phase: "Parte principal",
  type: "Jogo condicionado",
  intensity: 4,
  players: "8 + 2",
  durationMin: 15,
  space: "30×20",
  material: "6 cones, 4 coletes",
  ageMin: 12,
  ageMax: 15,
  complexity: 3,
  videoUrl: null,
  rules: "Dois toques. Golo vale só depois de cinco passes.",
  progressions: "Um toque.",
  regressions: "Toques livres.",
  coachingPoints: "Corpo aberto. Apoio na diagonal.",
  commonErrors: "Apoio atrás da linha da bola.",
  images: [],
  deletable: true,
  diagram: {
    field: "f11",
    frames: [
      frame(1, [jogador(1, 20, 20), jogador(2, 30, 40)]),
      frame(2, [jogador(1, 25, 25), jogador(2, 35, 35)]),
      frame(3, [jogador(1, 40, 30), jogador(2, 45, 20)]),
      frame(4, [jogador(1, 55, 34), jogador(2, 60, 25)]),
    ],
  },
};

const UM_FRAME = {
  ...EXERCICIO,
  name: "Aquecimento em quadrado",
  diagram: { field: "f11-half", frames: [frame(1, [jogador(1, 20, 20)])] },
};

const MODELO = {
  id: "m1",
  name: "4-3-3 de posse",
  system: "4-3-3",
  teamId: "t1",
  teamName: "Sub-15",
  visibility: "CLUB",
  lineup: { pitch: "f11", slots: [{ id: "s1", label: "GR", x: 6, y: 34 }, { id: "s2", label: "DC", x: 22, y: 26 }] },
  principles: {
    offensive: { "Saída de bola": "Три linhas. Laterais abertos.", Construção: "" },
    defensive: { Pressão: "Alta, com referência no médio centro." },
  },
  notes: "Rever com a equipa técnica em Setembro.",
  mine: true, editable: true, deletable: true, authorName: "Rui", updatedAt: "2026-08-01",
};

const BOLA_PARADA = {
  id: "sp1",
  kind: "corner-off",
  name: "Canto ao primeiro poste",
  description: "Bloqueio no primeiro poste, corte do 9.",
  teamId: "t1", teamName: "Sub-15", visibility: "CLUB",
  diagram: { field: "f11-half", frames: [frame(1, [jogador(9, 40, 30)]), frame(2, [jogador(9, 50, 32)])] },
  mine: true, editable: true, deletable: true, authorName: "Rui", updatedAt: "2026-08-01",
};

const PLANO = {
  sessionId: "s1",
  teamId: "t1",
  teamName: "Sub-15",
  startsAt: "2026-09-03T18:30:00.000Z",
  endsAt: "2026-09-03T20:00:00.000Z",
  venue: "Campo 2",
  status: "SCHEDULED",
  coachName: "Rui Machado",
  mine: true,
  objective: "Posse em bloco médio",
  objectives: ["Posse"],
  sessionType: "Aquisitivo",
  intensity: 3,
  expectedAthletes: 18,
  material: "Coletes, cones",
  planNotes: "Chegar 15 min antes.",
  postNotes: null,
  blocks: [
    { name: "Activação", durationMin: 15, category: "Aquecimento", objective: null, intensity: 2, players: "18", notes: null, exerciseId: null },
    { name: "Posse 4v4", durationMin: 20, category: "Posse", objective: "Manter a bola", intensity: 4, players: "10", notes: "Insistir no apoio.", exerciseId: "ex1" },
    { name: "Posse 4v4 (repete)", durationMin: 10, category: "Posse", objective: null, intensity: 4, players: "10", notes: null, exerciseId: "ex1" },
    { name: "Jogo formal", durationMin: 20, category: "Jogo", objective: null, intensity: 5, players: "18", notes: null, exerciseId: "ex2" },
  ],
};

/* -------------------------------------------------------------------------- */

function limpar() {
  registo.paginas = 1;
  registo.imagens.length = 0;
  registo.textos.length = 0;
  registo.nomeGravado = null;
  svgsDesenhados.length = 0;
}

const texto = () => registo.textos.join(" | ");

/* -------------------------------------------------------------------------- */

/*
 * O módulo carrega-se com os imports desviados.
 *
 * Um `Module.register` seria mais limpo; isto é um ficheiro `.tsx` com JSX e
 * caminhos `@/`, e o que o resolve é o esbuild que o Vite já traz. Compila-se
 * para um ficheiro só, com os dois substitutos injectados como globais.
 */
const { build } = await import("esbuild");

const bundle = await build({
  entryPoints: [path.join(RAIZ, "src/lib/training-pdf.tsx")],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  jsx: "automatic",
  target: "es2022",
  /*
   * `import.meta.env` é do Vite e não existe no Node.
   *
   * O `training.ts` puxa `http.ts`, que lê a variável no topo do módulo — e o
   * módulo rebentava a carregar, antes de qualquer teste correr. Substituído no
   * momento da compilação por um objecto vazio: nada aqui faz pedidos.
   */
  define: { "import.meta.env": '{"DEV":false}' },
  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/server"],
  alias: { "@": path.join(RAIZ, "src") },
  plugins: [
    {
      name: "substitutos",
      setup(b) {
        for (const nome of substitutos.keys()) {
          const filtro = new RegExp(`^${nome.replace(/[/@]/g, "\\$&")}$`);
          b.onResolve({ filter: filtro }, (args) => ({ path: args.path, namespace: "falso" }));
        }
        b.onLoad({ filter: /.*/, namespace: "falso" }, (args) => {
          if (args.path === "jspdf") {
            return { contents: `export const jsPDF = globalThis.__sub["jspdf"].jsPDF;`, loader: "js" };
          }
          // O `academy` é o do teste; o resto existe só para o esbuild ligar.
          const linhas = [`export const academy = globalThis.__sub["@/lib/store"].academy;`];
          for (const n of NOMES_DO_STORE) {
            if (n !== "academy") linhas.push(`export const ${n} = undefined;`);
          }
          return { contents: linhas.join("\n"), loader: "js" };
        });
      },
    },
  ],
});

globalThis.__sub = Object.fromEntries(substitutos);

/*
 * O bundle vai para um ficheiro, e não para um `data:` URL.
 *
 * Um módulo `data:` não tem base para resolver especificadores nus: o
 * `import "react-dom/server"` lá dentro rebenta com `ERR_UNSUPPORTED_RESOLVE_REQUEST`.
 * Escrito ao lado do projecto, o Node resolve os `node_modules` como resolveria
 * qualquer outro ficheiro. Apaga-se a seguir.
 */
const ficheiro = path.join(AQUI, ".pdf-bundle.mjs");
writeFileSync(ficheiro, bundle.outputFiles[0].text, "utf8");

let modulo;
try {
  modulo = await import(pathToFileURL(ficheiro).href);
} finally {
  rmSync(ficheiro, { force: true });
}

/* -------------------------------------------------------------------------- */

console.log("=== Exercício com quatro frames ===");
limpar();
await modulo.exportarExercicio(EXERCICIO);

check("gerou um ficheiro", registo.nomeGravado !== null, `${registo.nomeGravado}`);
check(
  "com o nome do clube e do exercício",
  registo.nomeGravado === "ad-fafe_exercicio_posse-4v4-com-apoios.pdf",
  `${registo.nomeGravado}`,
);
/*
 * Quatro frames, quatro páginas de frame — mais a primeira, a da ficha. Se um
 * dia alguém encolher isto para uma grelha, este número cai e diz porquê.
 */
check("uma página por frame, mais a ficha", registo.paginas === 5, `${registo.paginas} páginas`);
check("quatro campos desenhados", registo.imagens.length === 4, `${registo.imagens.length}`);
check("um em cada página de frame", new Set(registo.imagens.map((i) => i.pagina)).size === 4, "");
check(
  "e a numeração dos frames no cabeçalho",
  ["Frame 1 de 4", "Frame 4 de 4"].every((t) => registo.textos.includes(t)),
  "",
);
check("com a nota de cada frame", texto().includes("Nota do frame 3"), "");

console.log("\n=== O desenho vai lá dentro, não um campo em branco ===");
/*
 * A verificação que dá sentido a todas as outras. Um SVG que chegue ao canvas
 * sem jogadores nem setas produz um PDF bonito e inútil.
 */
check("os quatro SVG passaram pelo canvas", svgsDesenhados.length === 4, `${svgsDesenhados.length}`);
check("cada um com o campo desenhado", svgsDesenhados.every((s) => s.includes("<svg") && s.includes("path")), "");
check("com os jogadores", svgsDesenhados.every((s) => s.includes("circle")), "");
check("e as posições mudam de frame para frame", svgsDesenhados[0] !== svgsDesenhados[3], "");
check(
  "sem variáveis CSS por resolver — não existem fora do documento",
  svgsDesenhados.every((s) => !s.includes("var(--")),
  "",
);
check(
  "e com o `xmlns`, senão o browser recusa a imagem",
  svgsDesenhados.every((s) => s.includes("xmlns=")),
  "",
);

console.log("\n=== A ficha inteira, não só o desenho ===");
for (const [rotulo, esperado] of [
  ["as regras", "Dois toques."],
  ["as progressões", "Um toque."],
  ["os pontos de treino", "Corpo aberto."],
  ["os erros comuns", "Apoio atrás"],
  ["o espaço", "30×20"],
  ["o material", "coletes"],
]) {
  check(rotulo, texto().includes(esperado), "");
}
check("e a legenda do que está no frame", texto().includes("Jogador"), "");

console.log("\n=== Um frame só não abre uma página para si ===");
/*
 * A regra não é "cabe numa página" — a primeira versão deste teste dizia isso e
 * falhou com razão: uma ficha com regras, progressões, regressões, pontos de
 * treino e erros comuns transborda para a segunda folha por causa do **texto**,
 * e isso está certo. O que se mede é outra coisa: com um frame não se gasta uma
 * página a dizer "Frame 1 de 1", e o desenho entra no seguimento da ficha.
 */
limpar();
await modulo.exportarExercicio(UM_FRAME);
check("um desenho só", registo.imagens.length === 1, `${registo.imagens.length}`);
check('sem escrever "Frame 1 de 1"', !texto().includes("Frame 1 de 1"), "");
const comUmFrame = registo.paginas;

limpar();
await modulo.exportarExercicio(EXERCICIO);
check(
  "e menos páginas do que a mesma ficha com quatro",
  comUmFrame < registo.paginas,
  `${comUmFrame} contra ${registo.paginas}`,
);

console.log("\n=== Modelo de jogo ===");
limpar();
await modulo.exportarModelo(MODELO);
check("gerou", registo.nomeGravado === "ad-fafe_modelo-de-jogo_4-3-3-de-posse.pdf", `${registo.nomeGravado}`);
check("com o onze desenhado", registo.imagens.length === 1, `${registo.imagens.length}`);
check("com os rótulos das posições", svgsDesenhados[0]?.includes("GR"), "");
check("e os princípios escritos", texto().includes("Saída de bola"), "");
/*
 * Um tópico em branco não se imprime: em papel, um título sem texto por baixo
 * diz que o treinador não pensou nisso, quando o que diz é que não escreveu.
 */
check("mas não os que estão por escrever", !texto().includes("Construção"), "");

console.log("\n=== Bola parada ===");
limpar();
await modulo.exportarBolaParada(BOLA_PARADA);
check("gerou", registo.nomeGravado === "ad-fafe_bola-parada_canto-ao-primeiro-poste.pdf", `${registo.nomeGravado}`);
check("dois frames, duas páginas", registo.imagens.length === 2, `${registo.imagens.length}`);
check("com o tipo no cabeçalho", texto().includes("Cantos ofensivos"), "");

console.log("\n=== Plano de treino, com os exercícios atrás ===");
limpar();
const pedidos = [];
await modulo.exportarPlano(PLANO, async (id) => {
  pedidos.push(id);
  if (id === "ex2") throw new Error("arquivado");
  return { ...EXERCICIO, name: "Posse 4v4" };
});

check("gerou", registo.nomeGravado === "ad-fafe_treino_sub-15-2026-09-03.pdf", `${registo.nomeGravado}`);
check("com a janela de tempo de cada bloco", texto().includes("0'–15'") && texto().includes("35'–45'"), "");
check("e a duração total", texto().includes("65 min"), "");

/*
 * O mesmo exercício em dois blocos pede-se uma vez. Sem isto, um plano que
 * repete o jogo final imprimia a ficha duas vezes.
 */
check("um exercício repetido pede-se uma vez", pedidos.filter((x) => x === "ex1").length === 1, pedidos.join(","));
check("e o outro também se tenta", pedidos.includes("ex2"), pedidos.join(","));

/*
 * A ficha do `ex1` traz os seus quatro frames — é o que faz esta exportação
 * valer a pena: a folha do treino leva os desenhos consigo.
 */
check("a ficha do exercício vem com os frames", registo.imagens.length === 4, `${registo.imagens.length}`);
check("o exercício que já não abre não trava o plano", registo.nomeGravado !== null, "");
check("e o bloco dele continua na folha", texto().includes("Jogo formal"), "");

console.log("\n=== A cor do clube não vai crua para o papel ===");
/*
 * O clube deste teste é amarelo claro (#f5e050): a cor crua dá 1,3:1 contra o
 * branco e o filete do cabeçalho imprimia-se invisível. `signalOnSurface`
 * escurece-a até aos 3:1 — o mesmo cuidado do menu e dos contornos de foco.
 */
const { signalOnSurface } = await import("../../../packages/ui/src/tokens.ts");
check("a cor usada é a escurecida", signalOnSurface("#f5e050") !== "#f5e050", signalOnSurface("#f5e050"));

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);
