/**
 * As formas do site do clube: o que entra em JSON sai sempre completo e limpo.
 *
 * `SiteConfig.identity` e `SiteConfig.home` são JSON gravado tal e qual; o que
 * os protege é `site.tipos.ts`, e é isso que se prova aqui, sem servidor nem
 * base de dados: a página de início fica sempre com as sete secções, uma vez
 * cada, pela ordem gravada e com as que faltam no fim; uma chave inventada
 * cai; o banner só aceita endereços web ou caminhos do próprio site; a direção
 * e as instalações têm tectos e não passam `javascript:` numa imagem.
 *
 * Uso: npm run test:site-tipos
 */
import { identidadeValida, inicioValido, SECCOES_INICIO } from "../src/site/site.tipos";

let ok = 0;
let falhas = 0;
const check = (rotulo: string, cond: boolean, detalhe = "") => {
  if (cond) {
    ok++;
    console.log(`  OK   ${rotulo}`);
  } else {
    falhas++;
    console.log(`  FALHA ${rotulo}${detalhe ? ` — ${detalhe}` : ""}`);
  }
};

console.log("=== A página de início ===");
{
  const vazio = inicioValido(undefined);
  check("sem nada gravado vem a ordem de origem", vazio.seccoes.map((s) => s.key).join(",") === SECCOES_INICIO.join(","));
  check("todas visíveis por omissão", vazio.seccoes.every((s) => s.visivel));
  check("o banner de origem existe, vazio", vazio.seccoes.find((s) => s.key === "banner")?.banner?.titulo === "" && vazio.banner.titulo === "");
  check("cada secção tem id", vazio.seccoes.every((s) => s.id));

  // Uma página gravada antes de 20/10: um banner só, fora da lista.
  const antiga = inicioValido({
    seccoes: [
      { key: "noticias", visivel: true },
      { key: "banner", visivel: false },
      { key: "inventada", visivel: true },
      { key: "noticias", visivel: false },
      { key: "loja" },
    ],
    banner: { titulo: " Torneio de verão ", texto: "x", imagem: "javascript:alert(1)", botao: "Inscrever", url: "/calendario?mes=7" },
  });
  const chaves = antiga.seccoes.map((s) => s.key);
  check("o que está na lista é o que está na página, pela ordem gravada", chaves.join(",") === "noticias,loja", chaves.join(","));
  check("uma secção escondida na versão antiga fica fora da página", !chaves.includes("banner"));
  check("as fixas que faltam NÃO se inventam", !chaves.includes("jogo") && !chaves.includes("equipas"));
  check("uma chave inventada cai", !chaves.includes("inventada" as never));
  check("a repetição de uma fixa fica com a primeira", antiga.seccoes.filter((s) => s.key === "noticias").length === 1);
  check("tudo o que sai vem visível", antiga.seccoes.every((s) => s.visivel));
  check("sem banner na lista, o espelho `banner` é vazio", antiga.banner.titulo === "");

  const comBannerVago = inicioValido({
    seccoes: [{ key: "banner" }, { key: "jogo" }],
    banner: { titulo: " Torneio de verão ", imagem: "javascript:alert(1)", url: "/calendario?mes=7" },
  });
  const bannerAntigo = comBannerVago.seccoes.find((s) => s.key === "banner")!;
  check("o banner antigo entra no banner vago da lista", bannerAntigo.banner?.titulo === "Torneio de verão");
  check("o espelho `banner` é o primeiro da lista", comBannerVago.banner.titulo === "Torneio de verão");
  check("uma imagem javascript: não entra", bannerAntigo.banner?.imagem === "");
  check("um caminho do próprio site serve de url", bannerAntigo.banner?.url === "/calendario?mes=7");

  // Vários banners, cada um com o seu conteúdo e o seu id.
  const varios = inicioValido({
    seccoes: [
      { id: "b-a", key: "banner", banner: { titulo: "A" } },
      { key: "jogo" },
      { id: "b-a", key: "banner", banner: { titulo: "B" } },
      { id: "x y", key: "banner", banner: { titulo: "C" } },
      { key: "banner", banner: { titulo: "D" } },
      { key: "banner", banner: { titulo: "E" } },
    ],
  });
  const bs = varios.seccoes.filter((s) => s.key === "banner");
  check("até quatro banners", bs.length === 4, String(bs.length));
  check("cada um guarda o seu conteúdo", bs.map((b) => b.banner?.titulo).join("") === "ABCD");
  check("ids únicos e limpos", new Set(bs.map((b) => b.id)).size === 4 && bs.every((b) => /^[a-z0-9-]+$/i.test(b.id)));
  check("só o que foi gravado: quatro banners e o jogo", varios.seccoes.length === 5);
  check("sem banner nenhum na lista gravada não se inventa um", inicioValido({ seccoes: [{ key: "jogo" }] }).seccoes.every((s) => s.key !== "banner"));
  check("uma lista vazia gravada é uma página só com o herói", inicioValido({ seccoes: [] }).seccoes.length === 0);

  const url = (u: string) => inicioValido({ seccoes: [{ key: "banner", banner: { url: u } }] }).seccoes[0].banner!.url;
  check("um url https serve", url("https://exemplo.pt/x") === "https://exemplo.pt/x");
  check("um url javascript: não serve", url("javascript:alert(1)") === "");
  check("um caminho com espaços não serve", url("/loja x") === "");
  check("um protocolo relativo não serve", url("//mal.pt") === "");
}

console.log("\n=== A identidade: direção e instalações ===");
{
  const id = identidadeValida({
    direcao: [
      { nome: " Ana ", cargo: "Presidente" },
      { nome: "", cargo: "Fantasma" },
      { nome: "Rui" },
      "lixo",
    ],
    instalacoes: [
      { nome: "Estádio", descricao: "Relvado sintético", imagem: "https://x.supabase.co/storage/v1/object/public/site-publico/a/b.webp" },
      { nome: "Sede", imagem: "javascript:alert(1)" },
      { descricao: "sem nome" },
    ],
  });
  check("a direção vem aparada e sem linhas sem nome", id.direcao.length === 2 && id.direcao[0].nome === "Ana" && id.direcao[1].cargo === "");
  check("as instalações sem nome caem", id.instalacoes.length === 2);
  check("a imagem só entra se for um endereço web", id.instalacoes[0].imagem.startsWith("https://") && id.instalacoes[1].imagem === "");
  check("sem direção nem instalações vêm listas vazias", identidadeValida({}).direcao.length === 0 && identidadeValida({}).instalacoes.length === 0);

  const muitos = identidadeValida({ direcao: Array.from({ length: 60 }, (_, i) => ({ nome: `P${i}`, cargo: "" })) });
  check("a direção tem tecto de 40", muitos.direcao.length === 40);
  const muitas = identidadeValida({ instalacoes: Array.from({ length: 20 }, (_, i) => ({ nome: `I${i}` })) });
  check("as instalações têm tecto de 12", muitas.instalacoes.length === 12);
}

console.log(`\n${falhas === 0 ? "TUDO OK" : "FALHOU"} — ${ok} ok, ${falhas} falhas`);
process.exit(falhas === 0 ? 0 : 1);
