/**
 * Os códigos QR e os cartazes A4 — o dos sócios e o das famílias.
 *
 * ## O que aqui se prova, e porque é que não é a olho
 *
 * Que o cartaz **diz o que leva**. É a única coisa que um cartaz não pode errar,
 * e é a que falha em silêncio: o código é um quadrado preto que ninguém lê com
 * os olhos, e um endereço errado lá dentro só se descobre com o papel na parede,
 * por um pai que aponta a câmara e desiste. Abrir a consola e ver que descarrega
 * prova que sai um ficheiro — não prova o que está escrito nele.
 *
 * Por isso corre-se o desenho a sério (o mesmo `construirCartaz` que o botão
 * chama) e lê-se o texto de **dentro** dos fluxos comprimidos do PDF, como no
 * `test-callup-pdf`.
 *
 * ## As três regras
 *
 * - **O assunto e a chamada** de cada cartaz. Sem a linha do assunto, uma parede
 *   com um emblema e um quadrado preto não diz a ninguém o que acontece se o
 *   apontar.
 * - **O endereço por extenso**, que é o mesmo que o código carrega: são o mesmo
 *   argumento `link`, e imprimir um e codificar outro seria mentir em papel.
 * - **O convite das famílias vai com o token.** É a decisão que sustenta a
 *   funcionalidade: a app só oferece "Criar conta" a quem chega com convite
 *   (ver `Entrar.tsx`), e um cartaz que levasse à página do clube sem token
 *   punha a família num ecrã de "Entrar" para uma conta que não tem.
 *
 * ## Duas notas de mecânica
 *
 * O `qrcode` fica **fora** do pacote (`--external:qrcode`): empacotado, o
 * esbuild traz a compilação de servidor dele, que faz `require("fs")` a correr
 * — e um `require` dinâmico dentro de um pacote ESM não existe. Fora, o Node
 * resolve-o como sempre. É o mesmo recurso do `--external:react` do
 * `test:staff`.
 *
 * O clube aqui é o vazio com que o `lib/store` arranca (nome em branco, sem
 * emblema): o que se verifica são o assunto, a chamada e o endereço, que não
 * vêm do clube nenhum. O emblema vazio nem chega a pedir imagem — e é por isso
 * que isto corre sem DOM.
 *
 * Uso: npm run test:qr --workspace @academia/console
 */
import { inflateSync } from "node:zlib";
import { construirCartaz, qrPng } from "@/lib/qr-cartaz";
import { descarregarCartazDeAdesao, linkDeAdesao } from "@/lib/adesao";

const ORIGEM = "https://life-club.academias.pt";

/**
 * O pouco de browser que isto toca — e porque é que se desmonta a seguir.
 *
 * `linkDeAdesao` deriva o endereço da origem da página: é o que o torna
 * absoluto, e um QR não tem origem onde pendurar um caminho relativo (ver o
 * comentário lá). Finge-se a origem para o ler.
 *
 * Mas o `window` tem de **sair** antes de se desenhar o primeiro PDF: a
 * compilação do jsPDF para Node, se encontrar um `window`, vai buscar-lhe o
 * `atob` — e um `window` de mentira com uma propriedade só rebenta em
 * `Cannot read properties of undefined (reading 'bind')`. Sem `window` nenhum
 * ele usa os globais do Node, que é como o `test-callup-pdf` sempre correu.
 */
const comOrigemFingida = <T,>(ler: () => T): T => {
  const g = globalThis as { window?: unknown };
  g.window = { location: { origin: ORIGEM } };
  try {
    return ler();
  } finally {
    delete g.window;
  }
};

let ok = 0;
let bad = 0;
const check = (l: string, c: boolean, d = "") => {
  if (c) {
    ok++;
    console.log("  OK    " + l);
  } else {
    bad++;
    console.log("  FALHA " + l + (d ? " — " + d : ""));
  }
};

/** O texto que o ficheiro traz mesmo lá dentro, fluxos comprimidos incluídos. */
function textoDoPdf(bytes: Uint8Array): string {
  const bruto = Buffer.from(bytes);
  // `latin1` mapeia byte a byte, por isso os índices da string são os do buffer.
  const cru = bruto.toString("latin1");
  let saida = cru;

  const marca = /(?<!end)stream\r?\n/g;
  for (let m = marca.exec(cru); m; m = marca.exec(cru)) {
    const inicio = m.index + m[0].length;
    const fim = cru.indexOf("endstream", inicio);
    if (fim < 0) break;
    for (const recuo of [0, 1, 2]) {
      try {
        saida += "\n" + inflateSync(bruto.subarray(inicio, fim - recuo)).toString("latin1");
        break;
      } catch {
        /* Nem todos os fluxos são deflate, e o fim pode trazer uma quebra de linha. */
      }
    }
  }
  return saida;
}

/**
 * O texto de uma página de PDF, legível.
 *
 * jsPDF escreve cada linha como `(texto) Tj`, e parte a cadeia quando lhe mete
 * espaçamento entre letras — uma linha com `charSpace` sai como dezoito
 * parênteses seguidos. Juntam-se todos, e o que sobra é a página como se lê.
 */
function linhas(pdf: string): string {
  return [...pdf.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)]
    .map((m) => m[1].replace(/\\([()\\])/g, "$1"))
    .join("");
}

const bytesDe = (doc: Awaited<ReturnType<typeof construirCartaz>>): Uint8Array =>
  new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);

/* ========================================================================== */

console.log("=== O cartaz de adesão a sócio ===");
/*
 * O caminho dos sócios continua a existir e a dizer o mesmo depois de o gerador
 * ter passado a ser partilhado com o das famílias — é essa a razão de este bloco
 * estar aqui, e não só o novo.
 */
const adesao = comOrigemFingida(linkDeAdesao);
check("o endereço é absoluto — uma câmara não resolve caminhos", adesao.startsWith(ORIGEM), adesao);
check("e aponta para a página de adesão", adesao.endsWith("/sersocio"), adesao);

const cartazSocios = linhas(
  textoDoPdf(
    bytesDe(
      await construirCartaz({
        link: adesao,
        assunto: "ADESÃO A SÓCIO",
        chamada: "Aponta a câmara do telemóvel e inscreve-te",
        ficheiro: "x",
      }),
    ),
  ),
);
check("diz o assunto", cartazSocios.includes("ADESÃO A SÓCIO"), cartazSocios.slice(0, 160));
check("diz o que fazer com o código", cartazSocios.includes("Aponta a câmara do telemóvel e inscreve-te"));
check("e escreve o endereço por extenso, sem o esquema", cartazSocios.includes(adesao.replace(/^https?:\/\//, "")));
check("o endereço impresso não leva https:// (não se escreve à mão)", !cartazSocios.includes("https://"));
check("`descarregarCartazDeAdesao` continua exportado para o ecrã dos sócios", typeof descarregarCartazDeAdesao === "function");

console.log("\n=== O cartaz do convite das famílias ===");
/* Um convite como o servidor o constrói: `PUBLIC_BASE_URL` + /familia/<token>. */
const TOKEN = "4f3c1aa9b7e04d2f8c6a1b5e9d0f7a32";
const convite = `https://life-club.academias.pt/familia/${TOKEN}`;

const cartazFamilias = linhas(
  textoDoPdf(
    bytesDe(
      await construirCartaz({
        link: convite,
        assunto: "APP DO CLUBE",
        chamada: "Aponta a câmara do telemóvel e instala a app",
        ficheiro: "x",
      }),
    ),
  ),
);
check("diz o assunto", cartazFamilias.includes("APP DO CLUBE"), cartazFamilias.slice(0, 160));
check("diz o que fazer com o código", cartazFamilias.includes("Aponta a câmara do telemóvel e instala a app"));
/*
 * O token impresso é a prova de que o código o carrega: o endereço por extenso e
 * o QR saem do **mesmo** argumento `link`. Sem ele, a família instalava a app e
 * encontrava um ecrã de "Entrar" para uma conta que não tem.
 */
check("o endereço impresso leva o token do convite", cartazFamilias.includes(TOKEN), cartazFamilias.slice(-120));
check("e é o caminho /familia/ da landing, que instala a app", cartazFamilias.includes(`/familia/${TOKEN}`));

console.log("\n=== O código, em PNG ===");
const png = await qrPng(convite, 320);
check("sai um PNG em data URL", png.startsWith("data:image/png;base64,"), png.slice(0, 40));
check("com conteúdo a sério", png.length > 1000, `${png.length} caracteres`);
/*
 * Dois endereços diferentes não podem dar o mesmo código — é o que garante que
 * o que se codifica é o argumento e não uma constante esquecida. E é o par que
 * interessa: o convite com token, contra a página do clube sem ele.
 */
const semToken = await qrPng("https://life-club.academias.pt", 320);
check("um endereço diferente dá um código diferente", png !== semToken);
check("o mesmo endereço dá sempre o mesmo código", png === (await qrPng(convite, 320)));

console.log(`\n${ok} OK · ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);
