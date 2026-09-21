/**
 * A ficha de uma pessoa, em PDF.
 *
 * Corre o desenho a sério — o mesmo `construirPerfilPdf` que o botão "Exportar"
 * chama — e lê o ficheiro que sai. O que se guarda aqui é o que não se vê numa
 * exportação de teste com duas secções:
 *
 * - **as secções vazias não aparecem**: um título seguido de nada é pior do que
 *   a secção não existir, e é o que acontece a uma ficha meia preenchida (que é
 *   a norma num clube que acabou de importar o livro de sócios);
 * - **um valor em falta não se escreve**: `null` impresso numa ficha que vai
 *   para a federação é o género de coisa que se descobre tarde;
 * - **a paginação**: um histórico de quarenta alterações passa de página, e o
 *   cabeçalho da tabela tem de ir com ele;
 * - **o rodapé**, que avisa que o documento leva dados pessoais — em todas as
 *   páginas, e não só na primeira.
 *
 * O texto é lido de dentro dos fluxos comprimidos do PDF: o que se verifica é o
 * que o ficheiro diz, não o que o código tencionava dizer.
 *
 * Uso: npm run test:perfil --workspace @academia/console
 */
import { inflateSync } from "node:zlib";
import { construirPerfilPdf, type Perfil } from "@/lib/perfil-pdf";

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

/**
 * O que está **escrito** nas páginas: só os fluxos descomprimidos.
 *
 * A estrutura do ficheiro fica de fora de propósito. O `/OpenAction [3 0 R
 * /FitH null]` que o jsPDF escreve no catálogo fazia a prova de "nenhum campo
 * vazio se imprime" falhar por causa de uma palavra que nunca chega ao papel.
 */
function textoDoPdf(bytes: Uint8Array): string {
  const bruto = Buffer.from(bytes);
  const cru = bruto.toString("latin1");
  let saida = "";
  const marca = /(?<!end)stream\r?\n/g;
  for (let m = marca.exec(cru); m; m = marca.exec(cru)) {
    const inicio = m.index + m[0].length;
    const fim = cru.indexOf("endstream", inicio);
    if (fim < 0) continue;
    for (const recuo of [0, 1, 2]) {
      try {
        saida += "\n" + inflateSync(bruto.subarray(inicio, fim - recuo)).toString("latin1");
        break;
      } catch {
        /* Nem todos os fluxos são deflate. */
      }
    }
  }
  return saida;
}

const desenhar = async (p: Perfil) => {
  const doc = await construirPerfilPdf(p);
  const bytes = new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
  return { doc, texto: textoDoPdf(bytes) };
};

/**
 * O texto sai dos fluxos partido em pedaços com parênteses e deslocamentos pelo
 * meio ("(Sub-)-14(14 Masculinos)"). Procurar uma frase inteira falhava por
 * causa da tipografia, não do conteúdo — por isso a pergunta é sempre sobre um
 * pedaço que o `kerning` não parte.
 */
const contem = (t: string, s: string) => t.includes(s);

/* ========================================================================== */

console.log("=== Uma ficha com o essencial ===");
{
  const { doc, texto } = await desenhar({
    tipo: "Ficha de atleta",
    nome: "Joao Ribeiro",
    subtitulo: "Sub-14 Masculinos",
    distintivos: ["Activo", "N. 7"],
    seccoes: [
      {
        tipo: "factos",
        titulo: "Ficha fisica",
        pares: [
          ["Altura", "154 cm"],
          ["Peso", "45.5 kg"],
          ["Posicao", null],
        ],
      },
    ],
  });
  check("o nome vai na folha", contem(texto, "Ribeiro"));
  check("e o tipo de ficha também", contem(texto, "FICHA DE ATLETA"));
  check("os distintivos aparecem", contem(texto, "Activo"));
  check("os factos preenchidos aparecem", contem(texto, "154 cm") && contem(texto, "45.5 kg"));
  check("um facto vazio não escreve nada", !contem(texto, "null") && !contem(texto, "undefined"));
  check("uma ficha curta cabe numa página", doc.getNumberOfPages() === 1, `${doc.getNumberOfPages()}`);
  check("o rodapé avisa dos dados pessoais", contem(texto, "dados pessoais"));
}

console.log("\n=== Secções sem nada não se desenham ===");
{
  const { texto } = await desenhar({
    tipo: "Ficha de socio",
    nome: "Maria Duarte",
    seccoes: [
      { tipo: "factos", titulo: "Contactos", pares: [["E-mail", null], ["Telemovel", ""]] },
      { tipo: "texto", titulo: "Notas internas", texto: "   " },
      { tipo: "tabela", titulo: "Quotas lancadas", colunas: [{ titulo: "Periodo", larg: 1 }], linhas: [] },
      { tipo: "factos", titulo: "Identificacao", pares: [["Numero de socio", "128"]] },
    ],
  });
  check("uma secção de factos toda vazia não aparece", !contem(texto, "CONTACTOS"));
  check("uma secção de texto em branco não aparece", !contem(texto, "NOTAS INTERNAS"));
  check("uma tabela sem linhas não aparece", !contem(texto, "QUOTAS"));
  check("a secção com valor aparece", contem(texto, "IDENTIFICA") && contem(texto, "128"));
}

console.log("\n=== Uma tabela vazia com explicação aparece ===");
{
  const { texto } = await desenhar({
    tipo: "Ficha de socio",
    nome: "Maria Duarte",
    seccoes: [
      {
        tipo: "tabela",
        titulo: "Quotas lancadas",
        colunas: [{ titulo: "Periodo", larg: 1 }],
        linhas: [],
        vazio: "Ainda nao ha quotas lancadas.",
      },
    ],
  });
  check("o título e a explicação saem", contem(texto, "QUOTAS") && contem(texto, "quotas lan"));
}

console.log("\n=== O histórico longo parte de página ===");
{
  const linhas = Array.from({ length: 40 }, (_, i) => [
    `0${(i % 9) + 1}/03/2026`,
    "Peso",
    `${40 + i} kg`,
    `${41 + i} kg`,
    "Direcao do clube",
  ]);
  const { doc, texto } = await desenhar({
    tipo: "Ficha de atleta",
    nome: "Joao Ribeiro",
    seccoes: [
      {
        tipo: "tabela",
        titulo: "Historico de alteracoes",
        colunas: [
          { titulo: "Quando", larg: 0.17 },
          { titulo: "Campo", larg: 0.23 },
          { titulo: "Antes", larg: 0.2 },
          { titulo: "Depois", larg: 0.22 },
          { titulo: "Quem", larg: 0.18 },
        ],
        linhas,
      },
    ],
  });
  check("quarenta alterações passam para a segunda página", doc.getNumberOfPages() === 2, `${doc.getNumberOfPages()}`);
  check("o cabeçalho da tabela repete-se", (texto.match(/QUANDO/g) ?? []).length >= 2,
    `${(texto.match(/QUANDO/g) ?? []).length}`);
  check("a última alteração lá está", contem(texto, "80 kg"));
  check("o rodapé numera as páginas", contem(texto, "1/2") && contem(texto, "2/2"));
}

console.log(`\n${ok} passaram, ${bad} falharam`);
process.exit(bad === 0 ? 0 : 1);
