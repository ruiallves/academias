import { signalVars } from "@academia/ui/tokens";
import { academy } from "@/lib/api";
import { apiOrigin } from "@/lib/http";
import { carregarEmblema } from "@/lib/callup-sheet";

/**
 * O QR da página de adesão a sócio — para o telemóvel de quem passa pelo clube.
 *
 * ## Porque é que um link não chegava
 *
 * O link serve o WhatsApp e o Instagram, onde há onde carregar. Não serve o
 * sítio onde as pessoas de facto decidem fazer-se sócias: a bancada, o bar, a
 * secretaria, o balcão de um patrocinador. Aí não há link nenhum — há uma
 * parede. E ninguém escreve `clube.academias.pt/l/.../sersocio` à mão a partir
 * de um cartaz.
 *
 * ## Dois formatos, duas utilizações
 *
 * O **PNG** é para o digital: colar num story, numa publicação, num email. É o
 * código e mais nada, com margem branca à volta — que não é decoração, é o que
 * os leitores precisam para o encontrar.
 *
 * O **cartaz A4** é para imprimir e pendurar: o emblema, o nome do clube, o
 * assunto, o código — e, por baixo dele, o que fazer com ele **e o endereço
 * escrito por extenso**. Há sempre quem tenha a câmara a falhar, e um cartaz
 * que só funciona por leitura óptica é um cartaz que falha em silêncio.
 *
 * Mais nada. É uma parede, não uma página: quem está a três metros lê um
 * símbolo, três palavras e um quadrado, e tudo o que se acrescentasse roubaria
 * tamanho ao código. O que o clube escreveu (a frase de abertura, a explicação)
 * fica onde serve — na página que abre a seguir, ver `CopyForm`.
 *
 * Nada disto passa pelo servidor: o código é o endereço, e o endereço já é
 * público.
 */

/**
 * O endereço público da página de inscrição deste clube — **absoluto, sempre**.
 *
 * Não devolve o `apiOrigin()` cru de propósito. Em produção a consola é servida
 * pela própria API e `apiOrigin()` é **vazio**: a mesma origem, que num
 * `<a href>` resolve sozinha (é o que o botão "Ver a página" faz). Num código
 * QR não resolve nada — a câmara de um telemóvel não tem origem onde pendurar
 * um caminho — e `/l/clube/sersocio` impresso num cartaz não é um endereço que
 * alguém consiga escrever. O erro só apareceria com o cartaz já na parede.
 */
export function linkDeAdesao(): string {
  return `${apiOrigin() || window.location.origin}/l/${academy.slug}/sersocio`;
}

/**
 * O código, em PNG.
 *
 * `M` é o nível de correcção de erros por omissão da biblioteca e o certo aqui:
 * recupera de cerca de 15% do código danificado — um cartaz com um canto
 * dobrado ou uma impressão fraca continuam a ler-se — sem inchar a grelha como
 * os níveis altos fazem.
 */
export async function qrDeAdesao(tamanho = 1024): Promise<string> {
  const QRCode = (await import("qrcode")).default;
  return QRCode.toDataURL(linkDeAdesao(), {
    width: tamanho,
    margin: 2,
    // Preto sobre branco, sempre. A cor do clube num QR é a maneira mais
    // rápida de o tornar ilegível para metade dos telemóveis.
    color: { dark: "#000000", light: "#ffffff" },
  });
}

/** O nome do ficheiro, sem os caracteres que o Windows recusa. */
const nomeDoFicheiro = (sufixo: string) =>
  `Sócios — ${academy.shortName} (${sufixo})`.replace(/[\\/:*?"<>|]/g, "-");

/** Descarrega o código como imagem. */
export async function descarregarQrDeAdesao(): Promise<void> {
  const dados = await qrDeAdesao();
  const a = document.createElement("a");
  a.href = dados;
  a.download = `${nomeDoFicheiro("QR")}.png`;
  a.click();
}

/**
 * O cartaz A4, pronto a imprimir.
 *
 * Desenhado à mão em milímetros, como as outras folhas deste produto (ver
 * `callup-sheet.ts`): é uma página só, e um gerador de HTML para PDF traria
 * uma dependência inteira para isto.
 */
export async function descarregarCartazDeAdesao(): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const [qr, emblema] = await Promise.all([qrDeAdesao(1200), carregarEmblema(academy.logoUrl)]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const L = 210;
  /*
   * A cor do clube, no tom que se lê.
   *
   * A cor crua não serve para texto: um clube de amarelo escrevia "ADESÃO A
   * SÓCIO" em amarelo sobre papel branco, que não se lê no ecrã e desaparece na
   * impressora. `--color-signal-ink` é a mesma cor escurecida até se ler — a
   * conta que o produto já faz, em `signalVars`.
   */
  const vars = signalVars(academy.signalColor);
  const tinta = rgb(vars["--color-signal-ink"]);
  /* O filete é desenho, não texto: `--color-signal-line` é o tom que o produto
     usa para o que se traça sobre a página, sem escurecer o clube a mais. */
  const filete = rgb(vars["--color-signal-line"]);

  /*
   * A folha, medida para o conteúdo ficar ao meio.
   *
   * Pouco conteúdo deixa muito papel: posto a partir do topo, ficava encostado
   * lá e com um terço da folha vazio em baixo. Os 46 mm de partida são o que
   * sobra dividido pelos dois lados, com o código a 104 mm.
   */
  let y = 46;

  if (emblema) {
    // O emblema entra pela altura, para um símbolo largo não ficar deformado.
    const alt = 30;
    const larg = (emblema.largura / emblema.altura) * alt;
    doc.addImage(emblema.dados, emblema.formato, (L - larg) / 2, y, larg, alt);
  }
  y += 30 + 12;

  // O nome do clube.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(115, 115, 115);
  centrado(doc, academy.name.toUpperCase(), y, 1.2);
  y += 9;

  /*
   * O assunto.
   *
   * Sem esta linha, uma parede com um emblema e um quadrado preto não diz a
   * ninguém o que acontece se o apontar. Na cor do clube, que é onde o olho cai
   * a seguir ao símbolo.
   */
  doc.setFontSize(13);
  doc.setTextColor(tinta[0], tinta[1], tinta[2]);
  centrado(doc, "ADESÃO A SÓCIO", y, 2.4);
  y += 16;

  // O código. 104 mm lê-se do outro lado de um balcão — e é o que a folha dá.
  const lado = 104;
  doc.addImage(qr, "PNG", (L - lado) / 2, y, lado, lado);
  doc.setDrawColor(filete[0], filete[1], filete[2]);
  doc.setLineWidth(1.2);
  doc.line((L - lado) / 2, y + lado + 6, (L + lado) / 2, y + lado + 6);
  y += lado + 16;

  // E o que fazer com ele.
  doc.setFontSize(15);
  doc.setTextColor(20, 20, 20);
  centrado(doc, "Aponta a câmara do telemóvel e inscreve-te", y);
  y += 8;

  /*
   * O endereço por extenso: há sempre quem tenha a câmara a falhar, e um cartaz
   * que só funciona por leitura óptica é um cartaz que falha em silêncio.
   */
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.setTextColor(110, 110, 110);
  centrado(doc, "ou escreve o endereço no navegador:", y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(60, 60, 60);
  centrado(doc, linkDeAdesao().replace(/^https?:\/\//, ""), y);

  doc.save(`${nomeDoFicheiro("cartaz")}.pdf`);
}

/**
 * Texto ao centro — com o espaçamento entre letras contado.
 *
 * O `align: "center"` do jsPDF mede a cadeia **sem** o `charSpace` e depois
 * desenha-a **com** ele: uma linha espaçada sai empurrada para a direita em
 * metade do espaçamento acrescentado. Num nome de clube com dezoito letras e
 * 1,2 mm entre elas, são onze milímetros — o suficiente para o cartaz parecer
 * torto e ninguém saber porquê. Medimos nós, e desenhamos a partir da esquerda.
 */
function centrado(doc: import("jspdf").jsPDF, texto: string, y: number, charSpace = 0): void {
  const largura = doc.getTextWidth(texto) + charSpace * Math.max(0, texto.length - 1);
  doc.text(texto, (210 - largura) / 2, y, charSpace ? { charSpace } : undefined);
}

/** `#1f7a45` → `[31, 122, 69]`. Cai no cinzento se o clube não tiver cor válida. */
function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex ?? "").trim());
  if (!m) return [90, 90, 90];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
