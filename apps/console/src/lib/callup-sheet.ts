import { signalVars } from "@academia/ui/tokens";

/**
 * A convocatória em papel.
 *
 * ## Porque é que isto existe num produto que avisa as famílias pelo telemóvel
 *
 * Porque no dia do jogo o telemóvel não serve para nada. O treinador chega ao
 * ponto de encontro, conta cabeças, e precisa de uma folha onde cada encarregado
 * assina que entregou o miúdo e onde se aponta quem vai no carro de quem. É o
 * documento que o clube arquiva. A notificação e a folha não competem: a
 * notificação convoca, a folha prova.
 *
 * ## Um PDF, e não o diálogo de impressão
 *
 * Durante um tempo isto era um documento HTML escrito num `iframe`, e quem fazia
 * o PDF era o navegador — "Exportar" abria o diálogo de impressão e a pessoa
 * escolhia "Guardar como PDF" lá dentro. Era mais leve e tinha melhor
 * tipografia, mas era outra coisa: exportar passava por um diálogo do sistema
 * onde se pode enganar no destino, o ficheiro saía com o nome que o navegador
 * quisesse, e num telemóvel — onde metade dos treinadores abre isto — o caminho
 * até um ficheiro que se possa enviar no grupo do escalão era desencontrado.
 *
 * Agora **descarrega um PDF**, com nome próprio, num clique. O documento é
 * desenhado aqui em milímetros: é mais trabalho do que escrever CSS, mas é o que
 * dá controlo sobre a paginação, que numa folha de assinaturas é o que importa.
 *
 * O motor entra por `import()` dinâmico. São umas centenas de kilobytes que só
 * quem exporta uma convocatória chega a descarregar — não pesam na abertura da
 * aplicação para quem nunca abre esta folha.
 *
 * ## O que esta folha tem, e porquê
 *
 * - O jogo lê-se como um jogo — dois nomes e a hora ao meio —, e não como uma
 *   lista de campos de formulário.
 * - A logística que faz alguém chegar a horas (encontro, chegada, local) é uma
 *   faixa de quatro células no topo, não letra miúda no meio do resto.
 * - A tabela tem cinco colunas e mais nada: **#**, **N.º**, **Atleta**, **T** e
 *   **Assinatura**. Tudo o que se acrescenta a uma folha que se assina em pé, no
 *   parque de estacionamento, é uma coluna que fica em branco.
 * - A coluna do transporte é uma **caixa** para pôr uma cruz. Uma célula vazia
 *   não diz o que se espera lá dentro.
 * - Convidados de escalão inferior trazem a equipa de origem ao lado do nome.
 * - O cabeçalho da tabela repete-se em cada página, e uma linha nunca se parte
 *   ao meio entre duas.
 */

export type SheetStatus = "CALLED" | "CONFIRMED" | "DECLINED";

/** Uma linha da folha. Quem exporta é que sabe montar isto. */
export type SheetRow = {
  squadNumber: number | null;
  name: string;
  position: string | null;
  status: SheetStatus;
  /** A equipa de origem, quando o atleta subiu de escalão para este jogo. */
  guestFrom: string | null;
};

export type SheetOrder = "name" | "number";

/** O que o treinador escreve no diálogo, e que o produto não tem em base. */
export type SheetLogistics = {
  competition: string;
  round: string;
  meetingPoint: string;
  meetingTime: string;
  arrivalTime: string;
  notes: string;
  order: SheetOrder;
};

export type CallUpSheet = SheetLogistics & {
  academy: { name: string; logoUrl: string; signalColor: string };
  season: string;
  team: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  kickOff: Date;
  /** O estado das respostas só se mostra depois de a convocatória ter saído. */
  submitted: boolean;
  coachName: string | null;
  staff: { name: string; role: string }[];
  rows: SheetRow[];
};

/* -------------------------------------------------------------------------- */
/* As medidas da folha                                                         */
/* -------------------------------------------------------------------------- */

const PAGINA = { largura: 210, altura: 297 };
const MARGEM = 12;
/** A largura útil: tudo o que se desenha vive entre `MARGEM` e isto. */
const LARGURA = PAGINA.largura - MARGEM * 2;

type RGB = [number, number, number];

const INK: RGB = [26, 25, 23];
const MUTED: RGB = [82, 79, 72];
const FAINT: RGB = [138, 134, 124];
const LINE: RGB = [229, 226, 220];
const LINE_FORTE: RGB = [211, 207, 198];
const CABECALHO: RGB = [239, 237, 232];

/** Onde começa o bloco da assinatura — encostado ao fundo, acima do rodapé. */
const ASSINATURA_Y = PAGINA.altura - 36;

/* -------------------------------------------------------------------------- */
/* Exportar                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Desenha a convocatória e descarrega-a como PDF.
 *
 * O emblema é carregado antes de tudo, com tecto de dois segundos: um emblema
 * que chega tarde desenhava um quadrado vazio, e nenhuma imagem vale bloquear a
 * exportação para sempre. Se não vier, ficam as iniciais do clube na cor dele —
 * nunca um espaço em branco.
 */
export async function exportCallUpSheet(sheet: CallUpSheet): Promise<void> {
  const doc = await buildCallUpPdf(sheet);
  doc.save(nomeDoFicheiro(sheet));
}

/**
 * Desenha a folha e devolve o documento, sem o gravar.
 *
 * Existe separado de `exportCallUpSheet` por uma razão só: `save()` é a única
 * linha que precisa de um navegador, e sem esta costura não havia como correr o
 * desenho num teste — o que numa folha com paginação (vinte e dois convocados
 * passam para a segunda página) é precisamente o que se quer verificar.
 */
export async function buildCallUpPdf(sheet: CallUpSheet): Promise<Doc> {
  /*
   * A regra da casa, no sítio por onde tudo passa.
   *
   * Os dois ecrãs que exportam já escondem o botão enquanto a lista não está
   * submetida, mas isso é a interface a ser simpática — não é a regra. A regra
   * está aqui, à entrada da única função que produz o documento, para que um
   * terceiro ecrã que amanhã queira uma folha não descubra sozinho que podia
   * exportar rascunhos.
   *
   * Porquê a regra: a folha é o documento que as famílias assinam, e a lista
   * que elas receberam é a submetida. Um rascunho ainda muda — sai o papel,
   * entra um lesionado, e no ponto de encontro há assinaturas por um plantel
   * que já não é aquele.
   */
  if (!sheet.submitted) {
    throw new Error("A convocatória só se exporta depois de submetida às famílias.");
  }

  const [{ jsPDF }, { default: autoTable }, emblema] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
    carregarEmblema(sheet.academy.logoUrl),
  ]);

  const vars = signalVars(sheet.academy.signalColor);
  const cor = {
    signal: hexRgb(vars["--color-signal"]),
    ink: hexRgb(vars["--color-signal-ink"]),
    strong: hexRgb(vars["--color-signal-strong"]),
    on: hexRgb(vars["--color-signal-on"]),
  };

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait", compress: true });
  doc.setProperties({ title: nomeDoDocumento(sheet), author: sheet.academy.name });

  let y = MARGEM;
  y = cabecalho(doc, sheet, cor, emblema, y);
  y = oJogo(doc, sheet, cor, y);
  y = aLogistica(doc, sheet, y);

  /* ----------------------------------------------------------- o plantel --- */
  const linhas = ordenar(sheet.rows, sheet.order);
  /** O fundo da última linha desenhada — vai-se reescrevendo até à última. */
  let fimDaTabela = y;

  autoTable(doc, {
    startY: y + 6,
    margin: { top: MARGEM, right: MARGEM, bottom: 16, left: MARGEM },
    theme: "plain",
    // Uma linha de assinatura partida entre duas páginas é uma assinatura por
    // cima da dobra. `thead` repete-se sozinho, que é metade da razão para a
    // tabela ser uma tabela e não uma lista desenhada à mão.
    rowPageBreak: "avoid",
    showHead: "everyPage",
    // O alinhamento do cabeçalho dito célula a célula: `columnStyles` só
    // alcança o corpo, e o "T" ficava encostado à esquerda por cima de uma
    // coluna de quadrados centrados.
    head: [[
      { content: "#", styles: { halign: "center" as const } },
      { content: "N.º", styles: { halign: "center" as const } },
      "Atleta",
      { content: "T", styles: { halign: "center" as const } },
      "Assinatura",
    ]],
    body: linhas.map((r, i) => [String(i + 1), r.squadNumber ?? "", r.name, "", ""]),
    styles: {
      font: "helvetica",
      fontSize: 10.5,
      textColor: INK,
      cellPadding: { top: 0, right: 2, bottom: 0, left: 2 },
      valign: "middle",
      lineWidth: 0,
      overflow: "ellipsize",
    },
    headStyles: {
      fillColor: CABECALHO,
      textColor: MUTED,
      fontSize: 7,
      fontStyle: "bold",
      cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
      valign: "middle",
    },
    bodyStyles: { minCellHeight: 10 },
    columnStyles: {
      0: { cellWidth: 8, halign: "center", fontSize: 8, textColor: FAINT },
      1: { cellWidth: 11, halign: "center", fontStyle: "bold" },
      2: { cellWidth: 71 },
      3: { cellWidth: 10, halign: "center" },
      4: { cellWidth: LARGURA - 100 },
    },
    didDrawCell: (d) => {
      if (d.section === "head") {
        // A régua por baixo do cabeçalho, mais escura do que a das linhas.
        if (d.column.index === 0) {
          regua(doc, d.cell.y + d.cell.height, LINE_FORTE, 0.35);
        }
        return;
      }
      if (d.section !== "body") return;

      if (d.column.index === 0) {
        regua(doc, d.cell.y + d.cell.height, LINE, 0.35);
        // A última a ser desenhada é a última linha da última página — que é
        // exactamente onde o resto do documento tem de continuar.
        fimDaTabela = d.cell.y + d.cell.height;
      }

      // A posição e a equipa de origem, por baixo do nome. O convidado tem de
      // se ver: é um miúdo de outro escalão, e quem assina por ele não é a
      // pessoa que o treinador está à espera de ver.
      //
      // Ao meio da metade de baixo da célula, e não encostado ao fundo: com o
      // nome subido pelo `willDrawCell`, é isto que dá às duas linhas o mesmo ar
      // de par que têm no ecrã, em vez de a posição roçar o nome.
      if (d.column.index === 2) {
        const r = linhas[d.row.index];
        const sub = [r.position, r.guestFrom ? `convidado · ${r.guestFrom}` : null].filter(Boolean).join(" · ");
        if (sub) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(7.5);
          doc.setTextColor(...FAINT);
          doc.text(sub, d.cell.x + 2, d.cell.y + d.cell.height - 2.6, { baseline: "middle" });
        }
      }

      // A caixa do transporte.
      if (d.column.index === 3) {
        doc.setDrawColor(173, 168, 157);
        doc.setLineWidth(0.35);
        doc.roundedRect(d.cell.x + (d.cell.width - 4) / 2, d.cell.y + (d.cell.height - 4) / 2, 4, 4, 0.8, 0.8, "S");
      }
    },
    didParseCell: (d) => {
      /*
       * O nome sobe quando leva a posição por baixo.
       *
       * Um nome centrado numa célula de 10mm ocupa o meio, e a linha da posição
       * — desenhada por nós — caía-lhe em cima. Com um enchimento de baixo de
       * 4mm, o `valign: middle` do motor passa a centrar o nome só na parte de
       * cima da célula, e as duas linhas ficam um par em vez de uma sobreposição.
       */
      if (d.section === "body" && d.column.index === 2) {
        const r = linhas[d.row.index];
        if (r.position || r.guestFrom) {
          d.cell.styles.cellPadding = { top: 0, right: 2, bottom: 4, left: 2 };
        }
      }
    },
  });

  y = fimDaTabela + 4;

  /* ------------------------------------------------------------- legenda --- */
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("T — transporte pelo clube", MARGEM, y, { baseline: "top" });
  doc.setTextColor(...FAINT);
  doc.text(
    `${linhas.length} ${linhas.length === 1 ? "convocado" : "convocados"}`,
    MARGEM + LARGURA,
    y,
    { align: "right", baseline: "top" },
  );
  y += 7;

  /* --------------------------------------------- observações e assinatura --- */
  /*
   * A assinatura mora no fundo da página, sempre.
   *
   * Ia logo a seguir às observações, e por isso subia e descia consoante o
   * número de convocados — num jogo de cinco ficava a meio da folha, com meia
   * página em branco por baixo. Uma assinatura é o fecho do documento; quem
   * arquiva procura-a no sítio onde ela está em todos os papéis do mundo.
   *
   * O quadro das observações é que se ajusta: se não couber acima da assinatura,
   * é ele que passa para a página seguinte — inteiro, porque um quadro cortado
   * ao meio não se escreve.
   */
  const minimo = alturaMinimaDoQuadro(doc, sheet.notes);
  if (y + minimo > ASSINATURA_Y - 6) {
    doc.addPage();
    y = MARGEM;
  }

  observacoes(doc, sheet.notes, y, ASSINATURA_Y - 6);
  assinaturas(doc, sheet, ASSINATURA_Y);

  rodape(doc, sheet);

  return doc;
}

/* -------------------------------------------------------------------------- */
/* As secções                                                                  */
/* -------------------------------------------------------------------------- */

type Doc = import("jspdf").jsPDF;
type Cores = { signal: RGB; ink: RGB; strong: RGB; on: RGB };

/** O clube à esquerda, o nome do documento à direita, e a faixa da cor por baixo. */
function cabecalho(doc: Doc, sheet: CallUpSheet, cor: Cores, emblema: Emblema | null, y: number): number {
  const alto = 14;

  if (emblema) {
    // Encaixado num quadrado sem esticar: um emblema deformado é a primeira
    // coisa que se nota num documento do clube.
    const escala = Math.min(alto / emblema.largura, alto / emblema.altura);
    const w = emblema.largura * escala;
    const h = emblema.altura * escala;
    doc.addImage(emblema.dados, emblema.formato, MARGEM + (alto - w) / 2, y + (alto - h) / 2, w, h);
  } else {
    doc.setFillColor(...cor.strong);
    doc.roundedRect(MARGEM, y, alto, alto, 2.5, 2.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(...cor.on);
    doc.text(iniciais(sheet.academy.name), MARGEM + alto / 2, y + alto / 2, { align: "center", baseline: "middle" });
  }

  const x = MARGEM + alto + 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(sheet.academy.name, x, y + 5.6, { baseline: "middle", maxWidth: LARGURA - alto - 60 });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(
    `${sheet.team}${sheet.season ? ` · Época ${sheet.season}` : ""}`,
    x,
    y + 10.4,
    { baseline: "middle", maxWidth: LARGURA - alto - 60 },
  );

  const direita = MARGEM + LARGURA;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...cor.ink);
  doc.text("CONVOCATÓRIA", direita, y + 4.6, { align: "right", baseline: "middle", charSpace: 0.28 });

  const prova = [sheet.competition.trim(), sheet.round.trim()].filter(Boolean).join(" · ");
  if (prova) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(prova, direita, y + 9.4, { align: "right", baseline: "middle" });
  }

  const faixa = y + alto + 3.5;
  doc.setFillColor(...cor.signal);
  doc.rect(MARGEM, faixa, LARGURA, 1.2, "F");
  return faixa + 1.2;
}

/**
 * Casa · hora · Fora — o jogo lido como um jogo.
 *
 * A data por extenso vive numa **linha só dela**, por baixo dos três. Estava
 * debaixo da hora, no meio, e "Sexta-feira, 4 de setembro de 2026" é largo o
 * suficiente para ir bater nos nomes das duas equipas — o par que mais precisa
 * de se ler à distância de um braço, com a folha numa mão.
 */
function oJogo(doc: Doc, sheet: CallUpSheet, cor: Cores, y: number): number {
  const topo = y + 5;
  const meio = MARGEM + LARGURA / 2;
  const casa = sheet.isHome ? sheet.team : sheet.opponent;
  const fora = sheet.isHome ? sheet.opponent : sheet.team;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(hora(sheet.kickOff), meio, topo + 7, { align: "center", baseline: "middle" });

  const lado = (label: string, nome: string, nosso: boolean, x: number, align: "right" | "left") => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    doc.text(label.toUpperCase(), x, topo + 1.5, { align, baseline: "middle", charSpace: 0.2 });

    doc.setFont("helvetica", nosso ? "bold" : "normal");
    doc.setFontSize(11.5);
    doc.setTextColor(...(nosso ? cor.ink : INK));
    doc.text(nome, x, topo + 7, { align, baseline: "middle", maxWidth: LARGURA / 2 - 22 });
  };

  lado("Casa", casa, sheet.isHome, meio - 16, "right");
  lado("Fora", fora, !sheet.isHome, meio + 16, "left");

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(dataLonga(sheet.kickOff), meio, topo + 14, { align: "center", baseline: "middle" });

  const fim = topo + 18;
  regua(doc, fim, LINE, 0.35);
  return fim;
}

/** Onde, a que horas se encontram, a que horas chegam. */
function aLogistica(doc: Doc, sheet: CallUpSheet, y: number): number {
  const celulas: [string, string][] = [
    ["Local do jogo", sheet.venue],
    ["Ponto de encontro", sheet.meetingPoint],
    ["Hora de encontro", sheet.meetingTime],
    ["Chegada ao campo", sheet.arrivalTime],
  ];
  const largura = LARGURA / celulas.length;

  celulas.forEach(([label, valor], i) => {
    const x = MARGEM + i * largura;
    if (i > 0) {
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.35);
      doc.line(x, y + 1, x, y + 12);
    }
    const texto = i === 0 ? x : x + 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    doc.text(label.toUpperCase(), texto, y + 4, { baseline: "middle", charSpace: 0.2 });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(valor.trim() || "—", texto, y + 9, { baseline: "middle", maxWidth: largura - 6 });
  });

  const fim = y + 13;
  regua(doc, fim, LINE, 0.35);
  return fim;
}

/**
 * O quadro das observações — a folha toda: a largura, e o que sobra da altura.
 *
 * Era metade da largura, ao lado de um quadro de "Informação adicional" que
 * repetia o que já estava no telemóvel de toda a gente. O que se escreve aqui
 * escreve-se **no campo**, à mão e à pressa: quem trocou de carro, quem saiu
 * mais cedo, quem se queixou do joelho. Meia página não chegava para isso.
 *
 * Cresce até `fundo` — que é o topo da assinatura. Numa convocatória de quatro
 * atletas o espaço que sobra é meia folha, e um rectângulo pequeno a meio dessa
 * meia folha seria um desenho de espaço vazio; assim o vazio **é** o sítio de
 * escrever, com pauta e tudo.
 */
function observacoes(doc: Doc, notas: string, y: number, fundo: number): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...MUTED);
  doc.text("OBSERVAÇÕES", MARGEM, y, { baseline: "top", charSpace: 0.2 });

  const topo = y + 4;
  const altura = Math.max(fundo - topo, alturaMinimaDoQuadro(doc, notas) - 4);

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.35);
  doc.rect(MARGEM, topo, LARGURA, altura, "S");

  let dentro = topo + 5;
  const escrito = notas.trim();
  if (escrito) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    const linhas = doc.splitTextToSize(escrito, LARGURA - 8) as string[];
    linhas.forEach((l) => {
      doc.text(l, MARGEM + 4, dentro, { baseline: "middle" });
      dentro += 4.4;
    });
    dentro += 2;
  }

  // As linhas para o que ainda se escreve à mão. Um rectângulo vazio não convida
  // a nada; uma pauta diz "escreve aqui".
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.25);
  while (dentro < topo + altura - 3) {
    doc.line(MARGEM + 4, dentro, MARGEM + LARGURA - 4, dentro);
    dentro += 7;
  }
}

/**
 * O menos que o quadro pode ocupar — título incluído.
 *
 * Serve para decidir se ainda cabe nesta página ou se passa para a seguinte.
 * Quatro pautas é o mínimo que faz dele um sítio para escrever; se já lá vier
 * texto do diálogo, o mínimo cresce com ele.
 */
function alturaMinimaDoQuadro(doc: Doc, notas: string): number {
  const escrito = notas.trim();
  if (!escrito) return 38;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const linhas = (doc.splitTextToSize(escrito, LARGURA - 8) as string[]).length;
  return 38 + linhas * 4.4;
}

/** A equipa técnica à esquerda, a assinatura de quem responde à direita. */
function assinaturas(doc: Doc, sheet: CallUpSheet, y: number): void {
  if (sheet.staff.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...FAINT);
    doc.text("EQUIPA TÉCNICA", MARGEM, y, { baseline: "top", charSpace: 0.2 });

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(
      sheet.staff.map((s) => `${s.name} (${s.role})`).join(" · "),
      MARGEM,
      y + 4.5,
      { baseline: "top", maxWidth: LARGURA - 70 },
    );
  }

  const direita = MARGEM + LARGURA;
  const linha = y + 10;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.3);
  doc.line(direita - 62, linha, direita, linha);

  if (sheet.coachName) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(sheet.coachName, direita, linha + 4, { align: "right", baseline: "middle" });
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...FAINT);
  doc.text("Treinador responsável", direita, linha + (sheet.coachName ? 8.5 : 4), {
    align: "right",
    baseline: "middle",
  });
}

/**
 * O rodapé, em todas as páginas.
 *
 * Escrito no fim e não à medida que as páginas nascem: só aqui é que se sabe
 * quantas são, e uma folha de assinaturas que se arquiva tem de dizer "1 de 2" —
 * senão ninguém repara que a segunda metade do plantel ficou na fotocopiadora.
 */
function rodape(doc: Doc, sheet: CallUpSheet): void {
  const total = doc.getNumberOfPages();
  const y = PAGINA.altura - 10;

  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...FAINT);
    doc.text(sheet.academy.name, MARGEM, y, { baseline: "middle" });
    doc.text(
      total > 1
        ? `Gerado em ${carimbo(new Date())} · ${p} de ${total}`
        : `Gerado em ${carimbo(new Date())}`,
      MARGEM + LARGURA,
      y,
      { align: "right", baseline: "middle" },
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Miudezas de desenho                                                         */
/* -------------------------------------------------------------------------- */

/** Uma linha horizontal de margem a margem. */
function regua(doc: Doc, y: number, cor: RGB, espessura: number): void {
  doc.setDrawColor(...cor);
  doc.setLineWidth(espessura);
  doc.line(MARGEM, y, MARGEM + LARGURA, y);
}

type Emblema = { dados: string; formato: "PNG" | "JPEG" | "WEBP"; largura: number; altura: number };

/**
 * O emblema do clube, em dados embutidos.
 *
 * Devolve `null` a qualquer contratempo — imagem em falta, ligação lenta,
 * formato que o motor não desenha. Uma exportação que rebenta porque o emblema
 * não veio seria trocar o documento por uma imagem, e o documento é que importa.
 */
async function carregarEmblema(url: string): Promise<Emblema | null> {
  if (!url) return null;
  try {
    const resposta = await Promise.race([
      fetch(url),
      new Promise<never>((_, rejeitar) => setTimeout(() => rejeitar(new Error("lento")), 2000)),
    ]);
    if (!resposta.ok) return null;

    const blob = await resposta.blob();
    const formato =
      blob.type === "image/png" ? "PNG" : blob.type === "image/jpeg" ? "JPEG" : blob.type === "image/webp" ? "WEBP" : null;
    if (!formato) return null;

    const dados = await new Promise<string>((resolver, rejeitar) => {
      const leitor = new FileReader();
      leitor.onload = () => resolver(String(leitor.result));
      leitor.onerror = () => rejeitar(leitor.error);
      leitor.readAsDataURL(blob);
    });

    const { largura, altura } = await new Promise<{ largura: number; altura: number }>((resolver, rejeitar) => {
      const img = new Image();
      img.onload = () => resolver({ largura: img.naturalWidth || 1, altura: img.naturalHeight || 1 });
      img.onerror = () => rejeitar(new Error("imagem ilegível"));
      img.src = dados;
    });

    return { dados, formato, largura, altura };
  } catch {
    return null;
  }
}

function hexRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

/* -------------------------------------------------------------------------- */

function ordenar(rows: SheetRow[], order: SheetOrder): SheetRow[] {
  const copia = [...rows];
  if (order === "number") {
    // Sem número vai para o fim: uma lista ordenada por número que começa com
    // três células vazias não parece ordenada por nada.
    return copia.sort(
      (a, b) => (a.squadNumber ?? 1e6) - (b.squadNumber ?? 1e6) || a.name.localeCompare(b.name, "pt"),
    );
  }
  return copia.sort((a, b) => a.name.localeCompare(b.name, "pt"));
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "··";
  return (partes.length > 1 ? partes[0][0] + partes[partes.length - 1][0] : nome.slice(0, 2)).toUpperCase();
}

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** `Sábado, 16 de novembro de 2024` — a data por extenso, como se lê num documento. */
export function dataLonga(d: Date): string {
  const dia = DIAS[d.getDay()];
  return `${dia[0].toUpperCase()}${dia.slice(1)}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

export function hora(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** `hh:mm` recuado `minutos` em relação ao apito. Serve as omissões do diálogo. */
export function antes(kickOff: Date, minutos: number): string {
  return hora(new Date(kickOff.getTime() - minutos * 60_000));
}

/** `16/11/2024 às 09:30`. */
function carimbo(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} às ${hora(d)}`;
}

function nomeDoDocumento(sheet: CallUpSheet): string {
  return `Convocatória — ${sheet.team} ${sheet.isHome ? "vs" : "@"} ${sheet.opponent}`;
}

/**
 * O nome do ficheiro que aparece nas transferências.
 *
 * Leva a data porque um treinador acaba a época com uma pasta de convocatórias,
 * e "Convocatória Sub-13 vs Fafe" repetido cinco vezes com `(1)`, `(2)` não é
 * uma pasta que se consiga ler. Sem os caracteres que o Windows recusa.
 */
function nomeDoFicheiro(sheet: CallUpSheet): string {
  const d = sheet.kickOff;
  const data = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const base = `Convocatória ${data} ${sheet.team} ${sheet.isHome ? "vs" : "em"} ${sheet.opponent}`;
  return `${base.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim()}.pdf`;
}
