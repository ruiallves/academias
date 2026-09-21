import { signalOnSurface } from "@academia/ui/tokens";
import { academy } from "@/lib/store";
import { carregarEmblema } from "@/lib/callup-sheet";
import { longDate } from "@/lib/format";

/**
 * A ficha de uma pessoa em papel: um atleta, um sócio, alguém do staff.
 *
 * ## Para que serve
 *
 * Uma ficha que só existe dentro da consola é uma ficha que não se pode entregar.
 * Há sempre o pedido que obriga a isto — a federação quer o processo do atleta, a
 * família pede o que o clube tem sobre o filho (é um direito, e o prazo é de um
 * mês), a direção leva a ficha do sócio para a assembleia, alguém sai do clube e
 * fica-se com o que lá estava. Sem exportação, a resposta era um ecrã fotografado.
 *
 * ## O que este módulo sabe, e o que não sabe
 *
 * Não sabe nada sobre atletas nem sobre sócios. Recebe um documento já decidido —
 * nome, fotografia, distintivos e uma lista de secções — e desenha-o. Quem decide
 * o que é relevante é a ficha, que é quem tem os dados e as permissões de quem
 * está a ler: um treinador sem `clinical:read` não pode exportar um diagnóstico
 * que não vê no ecrã, e a regra disso vive lá, não aqui.
 *
 * ## Papel
 *
 * A4 vertical, desenhado em milímetros com `jspdf` carregado só quando se
 * exporta — como a folha de convocatória e o plano de treino. A cor do clube
 * entra escurecida (`signalOnSurface`) para se ler no branco.
 *
 * O rodapé diz sempre que o documento leva dados pessoais. Um PDF anda por email
 * e por Whatsapp; a frase não impede nada, mas é o aviso que faz alguém pensar
 * duas vezes antes de o reencaminhar.
 */

export type Seccao =
  /** Pares rótulo e valor, em duas colunas. Os vazios não aparecem. */
  | { tipo: "factos"; titulo: string; pares: [string, string | null | undefined][] }
  /** Texto corrido — notas, observações. */
  | { tipo: "texto"; titulo: string; texto: string | null | undefined }
  /** Uma tabela com cabeçalho que se repete entre páginas. `larg` é fração de 1. */
  | {
      tipo: "tabela";
      titulo: string;
      colunas: { titulo: string; larg: number }[];
      linhas: string[][];
      vazio?: string;
    };

export type Perfil = {
  /** Entra no título do documento e no nome do ficheiro: "Ficha de atleta". */
  tipo: string;
  nome: string;
  subtitulo?: string | null;
  /** Estado, número, categoria — o que se lê de relance por baixo do nome. */
  distintivos?: (string | null | undefined)[];
  fotoUrl?: string | null;
  seccoes: Seccao[];
};

/* -------------------------------------------------------------------------- */
/* Medidas                                                                     */
/* -------------------------------------------------------------------------- */

const PAG = { w: 210, h: 297, m: 16 };
const LARGURA = PAG.w - PAG.m * 2;
const TOPO = PAG.m + 6;

type Doc = import("jspdf").jsPDF;
type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/* -------------------------------------------------------------------------- */
/* A folha                                                                     */
/* -------------------------------------------------------------------------- */

class Folha {
  readonly doc: Doc;
  y = TOPO;
  readonly cor: RGB;
  private readonly direita: string;

  constructor(doc: Doc, direita: string) {
    this.doc = doc;
    this.cor = rgb(signalOnSurface(academy.signalColor || "#0f6b62"));
    this.direita = direita;
    doc.setFont("helvetica", "normal");
    this.cabecalho();
  }

  /** O clube à esquerda e de quem é a ficha à direita, em todas as páginas. */
  private cabecalho() {
    const d = this.doc;
    d.setFontSize(8.5);
    d.setTextColor(120);
    d.text(academy.shortName || academy.name || "Academia", PAG.m, PAG.m - 4);
    d.text(corta(d, this.direita, LARGURA * 0.6), PAG.w - PAG.m, PAG.m - 4, { align: "right" });
    d.setDrawColor(...this.cor);
    d.setLineWidth(0.6);
    d.line(PAG.m, PAG.m - 2, PAG.w - PAG.m, PAG.m - 2);
    d.setTextColor(0);
    this.y = TOPO;
  }

  novaPagina() {
    this.doc.addPage();
    this.cabecalho();
  }

  garante(altura: number) {
    if (this.y + altura > PAG.h - PAG.m) this.novaPagina();
  }

  seccao(texto: string) {
    this.garante(20);
    const d = this.doc;
    this.y += 5;
    d.setFont("helvetica", "bold");
    d.setFontSize(9.5);
    d.setTextColor(...this.cor);
    d.text(texto.toUpperCase(), PAG.m, this.y);
    d.setDrawColor(225);
    d.setLineWidth(0.3);
    d.line(PAG.m, this.y + 1.6, PAG.w - PAG.m, this.y + 1.6);
    d.setFont("helvetica", "normal");
    d.setTextColor(0);
    this.y += 6;
  }

  /**
   * Pares rótulo e valor, duas colunas.
   *
   * Duas e não três: numa folha vertical, uma morada em três colunas parte-se em
   * cinco linhas de duas palavras.
   */
  factos(pares: [string, string | null | undefined][]) {
    const cheios = pares.filter((p): p is [string, string] => Boolean(p[1]?.toString().trim()));
    if (cheios.length === 0) return;
    const d = this.doc;
    const colW = LARGURA / 2;
    for (let i = 0; i < cheios.length; i += 2) {
      const linha = cheios.slice(i, i + 2);
      const partes = linha.map(([, v]) => d.splitTextToSize(String(v), colW - 6) as string[]);
      const alto = 5.4 + Math.max(...partes.map((p) => p.length)) * 4.6;
      this.garante(alto + 2);
      linha.forEach(([rotulo], col) => {
        const x = PAG.m + col * colW;
        d.setFontSize(7.5);
        d.setTextColor(140);
        d.text(rotulo.toUpperCase(), x, this.y + 3);
        d.setFontSize(10);
        d.setTextColor(28);
        d.text(partes[col], x, this.y + 7.8);
      });
      this.y += alto + 2;
    }
    d.setTextColor(0);
  }

  paragrafo(texto: string) {
    const d = this.doc;
    d.setFontSize(10);
    d.setTextColor(40);
    for (const linha of d.splitTextToSize(texto.trim(), LARGURA) as string[]) {
      this.garante(6);
      d.text(linha, PAG.m, this.y + 3.4);
      this.y += 4.9;
    }
    this.y += 1.5;
    d.setTextColor(0);
  }

  /** Uma tabela que parte páginas e repete o cabeçalho. */
  tabela(colunas: { titulo: string; larg: number }[], linhas: string[][]) {
    const d = this.doc;
    const larguras = colunas.map((c) => c.larg * LARGURA);
    const PAD = 1.8;
    const LH = 3.9;

    const cabeca = () => {
      this.garante(12);
      d.setFillColor(245, 244, 241);
      d.rect(PAG.m, this.y, LARGURA, 6.5, "F");
      d.setFont("helvetica", "bold");
      d.setFontSize(7.5);
      d.setTextColor(95);
      let x = PAG.m;
      colunas.forEach((c, i) => {
        d.text(c.titulo.toUpperCase(), x + PAD, this.y + 4.4);
        x += larguras[i];
      });
      d.setFont("helvetica", "normal");
      this.y += 6.5;
    };

    cabeca();
    for (const linha of linhas) {
      d.setFontSize(8.8);
      const partes = linha.map((t, i) => d.splitTextToSize(t || "—", larguras[i] - PAD * 2) as string[]);
      const alto = Math.max(...partes.map((p) => p.length)) * LH + PAD * 2;
      if (this.y + alto > PAG.h - PAG.m) {
        this.novaPagina();
        cabeca();
      }
      // A página nova e o cabeçalho mexeram no tamanho da letra.
      d.setFontSize(8.8);
      let x = PAG.m;
      partes.forEach((p, i) => {
        d.setTextColor(i === 0 ? 25 : 55);
        d.text(p, x + PAD, this.y + PAD + 2.9);
        x += larguras[i];
      });
      d.setDrawColor(232);
      d.setLineWidth(0.2);
      d.line(PAG.m, this.y + alto, PAG.w - PAG.m, this.y + alto);
      this.y += alto;
    }
    d.setTextColor(0);
    this.y += 2;
  }

  /** O rodapé, escrito no fim por cima de todas as páginas. */
  fechar() {
    const d = this.doc;
    const total = d.getNumberOfPages();
    const hoje = longDate(new Date());
    for (let i = 1; i <= total; i += 1) {
      d.setPage(i);
      d.setFontSize(7);
      d.setTextColor(150);
      d.text(`${academy.name || "Academia"} · Gerado a ${hoje} · Contém dados pessoais`, PAG.m, PAG.h - 8);
      d.text(`${i}/${total}`, PAG.w - PAG.m, PAG.h - 8, { align: "right" });
    }
  }
}

function corta(d: Doc, texto: string, largura: number): string {
  if (d.getTextWidth(texto) <= largura) return texto;
  let t = texto;
  while (t.length > 3 && d.getTextWidth(`${t}…`) > largura) t = t.slice(0, -1);
  return `${t}…`;
}

/* -------------------------------------------------------------------------- */
/* O cabeçalho da pessoa                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A fotografia, o nome e os distintivos.
 *
 * A fotografia fica ao lado do nome, em quadrado: é o que faz uma folha de papel
 * servir para identificar alguém à porta do pavilhão. Quando não há, o nome ocupa
 * a largura toda — nunca um retângulo cinzento a dizer que falta uma foto.
 */
async function identidade(f: Folha, p: Perfil, emblema: Awaited<ReturnType<typeof carregarEmblema>>) {
  const d = f.doc;
  /*
   * A fotografia entra pelo mesmo caminho do emblema: é um endereço assinado que
   * pode não responder, e `carregarEmblema` já resolve isso (tecto de dois
   * segundos, e `null` em vez de rebentar). Uma ficha sem foto exporta-se na
   * mesma; uma exportação que fica presa à espera de uma imagem, não.
   */
  const foto = p.fotoUrl ? await carregarEmblema(p.fotoUrl) : null;
  const LADO = 26;
  const x = PAG.m;
  const textoX = foto ? x + LADO + 6 : x;
  const larguraTexto = PAG.w - PAG.m - textoX - (emblema ? 20 : 0);

  if (foto) {
    // Encaixada no quadrado pelo lado maior: a cara pode ficar com margem, mas
    // nunca esticada.
    const k = Math.min(LADO / foto.largura, LADO / foto.altura);
    const w = foto.largura * k;
    const h = foto.altura * k;
    d.addImage(foto.dados, foto.formato, x + (LADO - w) / 2, f.y + (LADO - h) / 2, w, h, undefined, "FAST");
    d.setDrawColor(215);
    d.setLineWidth(0.3);
    d.rect(x, f.y, LADO, LADO);
  }

  if (emblema) {
    const lado = 14;
    const k = Math.min(lado / emblema.largura, lado / emblema.altura);
    d.addImage(
      emblema.dados,
      emblema.formato,
      PAG.w - PAG.m - emblema.largura * k,
      f.y,
      emblema.largura * k,
      emblema.altura * k,
      undefined,
      "FAST",
    );
  }

  let y = f.y;
  d.setFontSize(7.5);
  d.setTextColor(140);
  d.text(p.tipo.toUpperCase(), textoX, y + 3);
  y += 4;

  d.setFont("helvetica", "bold");
  d.setFontSize(19);
  d.setTextColor(20);
  const nome = d.splitTextToSize(p.nome, larguraTexto) as string[];
  d.text(nome, textoX, y + 6);
  y += 6 + (nome.length - 1) * 8;
  d.setFont("helvetica", "normal");

  if (p.subtitulo) {
    d.setFontSize(10.5);
    d.setTextColor(105);
    d.text(corta(d, p.subtitulo, larguraTexto), textoX, y + 6);
    y += 6;
  }

  const distintivos = (p.distintivos ?? []).filter((v): v is string => Boolean(v?.trim()));
  if (distintivos.length) {
    y += 6;
    d.setFontSize(8);
    let bx = textoX;
    for (const t of distintivos) {
      const w = d.getTextWidth(t) + 5;
      d.setFillColor(243, 242, 238);
      d.roundedRect(bx, y - 3.6, w, 5.4, 1.2, 1.2, "F");
      d.setTextColor(70);
      d.text(t, bx + 2.5, y);
      bx += w + 2.5;
    }
  }

  f.y = Math.max(y + 4, foto ? f.y + LADO : f.y) + 2;
  d.setTextColor(0);
}

/* -------------------------------------------------------------------------- */
/* Exportar                                                                    */
/* -------------------------------------------------------------------------- */

export async function exportarPerfil(p: Perfil): Promise<void> {
  const doc = await construirPerfilPdf(p);
  doc.save(nomeDoFicheiro(p));
}

/**
 * Desenha a ficha e devolve o documento, sem o gravar.
 *
 * Separado de `exportarPerfil` pela mesma razão que a folha de convocatória o
 * faz: `save()` é a única linha que precisa de um navegador, e sem esta costura
 * não havia como correr o desenho num teste — que numa ficha com secções que
 * aparecem e desaparecem conforme as permissões é precisamente o que se quer
 * verificar.
 */
export async function construirPerfilPdf(p: Perfil): Promise<Doc> {
  const [{ jsPDF }, emblema] = await Promise.all([import("jspdf"), carregarEmblema(academy.logoUrl ?? "")]);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({ title: `${p.tipo} · ${p.nome}`, author: academy.name || "Academia" });

  const f = new Folha(doc, p.nome);
  await identidade(f, p, emblema);

  for (const s of p.seccoes) {
    if (s.tipo === "factos") {
      // Uma secção sem um único valor preenchido não se desenha: um título
      // seguido de nada é pior do que a secção não existir.
      if (!s.pares.some(([, v]) => v?.toString().trim())) continue;
      f.seccao(s.titulo);
      f.factos(s.pares);
    } else if (s.tipo === "texto") {
      if (!s.texto?.trim()) continue;
      f.seccao(s.titulo);
      f.paragrafo(s.texto);
    } else {
      if (s.linhas.length === 0 && !s.vazio) continue;
      f.seccao(s.titulo);
      if (s.linhas.length === 0) {
        f.garante(6);
        f.doc.setFontSize(9);
        f.doc.setTextColor(140);
        f.doc.text(s.vazio ?? "", PAG.m, f.y + 3);
        f.doc.setTextColor(0);
        f.y += 6;
      } else {
        f.tabela(s.colunas, s.linhas);
      }
    }
  }

  f.fechar();
  return doc;
}

/** `life-club_ficha-de-atleta_joao-silva_2026-09-20.pdf` */
function nomeDoFicheiro(p: Perfil): string {
  const limpa = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const hoje = new Date();
  const data = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const clube = limpa(academy.slug || academy.shortName || "academia");
  return `${clube}_${limpa(p.tipo)}_${limpa(p.nome) || "sem-nome"}_${data}.pdf`;
}
