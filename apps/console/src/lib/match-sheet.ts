import { signalVars } from "@academia/ui/tokens";
import { carregarEmblema, dataLonga, hora } from "@/lib/callup-sheet";

/**
 * A ficha de jogo: titulares, suplentes, capitão e sub-capitão, numa folha.
 *
 * É o papel que o delegado leva para o jogo e de onde se passa a equipa para a
 * plataforma da federação. Sai do plano do jogo (`MatchPlan`), e não da
 * convocatória: a convocatória diz quem vai, a ficha diz quem começa.
 *
 * Um PDF e não uma integração: a aplicação da federação não aceita ficheiros
 * nossos, preenche-se lá à mão. Por isso a folha é feita para se ler depressa
 * e copiar sem enganos, com o número à frente de cada nome.
 */

export type LinhaDaFicha = { numero: number | null; nome: string; posicao: string; marca: "C" | "SC" | "" };

export type FichaDeJogo = {
  academy: { name: string; logoUrl: string; signalColor: string };
  season: string;
  team: string;
  opponent: string;
  isHome: boolean;
  competition: string;
  round: string;
  venue: string;
  kickOff: Date;
  system: string;
  titulares: LinhaDaFicha[];
  suplentes: LinhaDaFicha[];
  staff: { name: string; role: string }[];
};

type RGB = [number, number, number];
const hexRgb = (hex: string): RGB => {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
};

const MARGEM = 14;
const TINTA: RGB = [20, 19, 15];
const CINZA: RGB = [110, 106, 98];
const LINHA: RGB = [226, 223, 216];

export async function exportarFichaDeJogo(f: FichaDeJogo): Promise<void> {
  const [{ jsPDF }, { default: autoTable }, emblema] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    carregarEmblema(f.academy.logoUrl),
  ]);
  const vars = signalVars(f.academy.signalColor);
  const forte = hexRgb(vars["--color-signal-strong"]);
  const sobre = hexRgb(vars["--color-signal-on"]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  const largura = doc.internal.pageSize.getWidth();
  doc.setProperties({ title: `Ficha de jogo ${f.team} ${f.opponent}`, author: f.academy.name });

  /* ---- cabeçalho ---- */
  let y = MARGEM;
  if (emblema) {
    const alto = 16;
    const w = Math.min(alto, (emblema.largura / emblema.altura) * alto);
    doc.addImage(emblema.dados, emblema.formato, MARGEM, y, w, (emblema.altura / emblema.largura) * w);
  }
  const x0 = emblema ? MARGEM + 21 : MARGEM;
  doc.setFont("helvetica", "bold").setFontSize(16).setTextColor(...TINTA);
  doc.text("Ficha de jogo", x0, y + 6);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...CINZA);
  doc.text([f.academy.name, f.season ? `Época ${f.season}` : ""].filter(Boolean).join("  ·  "), x0, y + 12);
  y += 22;

  /* ---- o jogo ---- */
  doc.setFillColor(...forte).roundedRect(MARGEM, y, largura - 2 * MARGEM, 17, 2, 2, "F");
  doc.setTextColor(...sobre).setFont("helvetica", "bold").setFontSize(13);
  const casa = f.isHome ? f.team : f.opponent;
  const fora = f.isHome ? f.opponent : f.team;
  doc.text(`${casa}  ×  ${fora}`, largura / 2, y + 7, { align: "center" });
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(
    [dataLonga(f.kickOff), hora(f.kickOff), f.venue, f.competition, f.round].filter(Boolean).join("  ·  "),
    largura / 2,
    y + 13,
    { align: "center" },
  );
  y += 23;

  doc.setTextColor(...CINZA).setFontSize(9);
  doc.text(
    [`Equipa: ${f.team}`, f.system ? `Sistema: ${f.system}` : "", `${f.titulares.length} titulares`, `${f.suplentes.length} suplentes`]
      .filter(Boolean)
      .join("   ·   "),
    MARGEM,
    y,
  );
  y += 4;

  const corpo = (linhas: LinhaDaFicha[]) =>
    linhas.map((l) => [l.numero ?? "", l.nome, l.posicao, l.marca === "C" ? "Capitão" : l.marca === "SC" ? "Sub-capitão" : ""]);
  const tabela = (titulo: string, linhas: LinhaDaFicha[], inicio: number) => {
    autoTable(doc, {
      startY: inicio,
      margin: { left: MARGEM, right: MARGEM },
      head: [[{ content: titulo, colSpan: 4 }], ["N.º", "Nome", "Posição", ""]],
      body: linhas.length ? corpo(linhas) : [["", "Ninguém", "", ""]],
      theme: "plain",
      styles: { font: "helvetica", fontSize: 10, cellPadding: { top: 2.1, bottom: 2.1, left: 2.5, right: 2.5 }, textColor: TINTA, lineColor: LINHA, lineWidth: { bottom: 0.2 } },
      headStyles: { fontStyle: "bold", fontSize: 8.5, textColor: CINZA },
      columnStyles: { 0: { cellWidth: 14, halign: "center", fontStyle: "bold" }, 2: { cellWidth: 48, textColor: CINZA }, 3: { cellWidth: 30, fontStyle: "bold" } },
      didParseCell: (d) => {
        if (d.section === "head" && d.row.index === 0) {
          d.cell.styles.fontSize = 11;
          d.cell.styles.textColor = TINTA;
        }
      },
    });
    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  };

  y = tabela("Titulares", f.titulares, y + 2);
  y = tabela("Suplentes", f.suplentes, y + 6);

  if (f.staff.length > 0) {
    autoTable(doc, {
      startY: y + 6,
      margin: { left: MARGEM, right: MARGEM },
      head: [[{ content: "Equipa técnica", colSpan: 2 }]],
      body: f.staff.map((s) => [s.role, s.name]),
      theme: "plain",
      styles: { font: "helvetica", fontSize: 10, cellPadding: { top: 2.1, bottom: 2.1, left: 2.5, right: 2.5 }, textColor: TINTA, lineColor: LINHA, lineWidth: { bottom: 0.2 } },
      headStyles: { fontStyle: "bold", fontSize: 11, textColor: TINTA },
      columnStyles: { 0: { cellWidth: 62, textColor: CINZA } },
    });
  }

  const d = f.kickOff;
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const nome = `Ficha de jogo ${data} ${f.team} ${f.isHome ? "vs" : "em"} ${f.opponent}`;
  doc.save(`${nome.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim()}.pdf`);
}
