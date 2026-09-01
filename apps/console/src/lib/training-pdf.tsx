import { renderToStaticMarkup } from "react-dom/server";
import { signalOnSurface } from "@academia/ui/tokens";
import { FieldView, Pitch, baseView, itemScale, pitchBackground } from "@/components/FieldEditor";
import { academy } from "@/lib/store";
import { longDate, time } from "@/lib/format";
import {
  ARROW_LABEL,
  ITEM_LABEL,
  PRINCIPLE_SECTIONS,
  SET_PIECE_KINDS,
  asDiagram,
  asLineupData,
  type ExerciseFull,
  type GameModelRow,
  type LineupData,
  type Principles,
  type SessionPlan,
  type SetPieceRow,
} from "@/lib/training";

/**
 * A área técnica em PDF.
 *
 * ## Porque é que isto vive no browser
 *
 * Pela mesma razão que a exportação de mensalidades (ver `fees-export`): o
 * desenho já está aqui. `FieldView` sabe pintar um frame — o campo, os
 * jogadores, as setas — e é o mesmo componente que a consola mostra no ecrã. Um
 * gerador no servidor teria de reimplementar esse desenho em Node, e passariam a
 * existir duas versões do mesmo campo, a divergir à primeira correcção de um
 * cone. **O que sai no papel é literalmente o que está no ecrã.**
 *
 * O `jspdf` entra por `import()` dinâmico: são umas centenas de kilobytes que só
 * fazem falta a quem carrega em Exportar.
 *
 * ## Uma página por frame
 *
 * Um exercício com quatro frames é uma sequência — o lance começa, a bola sai, o
 * extremo cruza. Encolher isso para quatro miniaturas numa página é o mesmo que
 * dar as quatro imagens de uma banda desenhada em tamanho de selo. Cada frame
 * ocupa a sua página, grande, com a nota do frame por baixo e a numeração
 * ("Frame 2 de 4") no cabeçalho — que é o que se lê quando a folha está em cima
 * do relvado, ao vento, sem ninguém para explicar.
 *
 * ## Como o desenho entra no PDF
 *
 * `renderToStaticMarkup` dá o SVG que o React desenharia, e esse SVG é
 * desenhado num `<canvas>` para sair PNG. Não é a via mais elegante — é a que
 * não precisa de mais nenhuma dependência e a que garante que o PNG é pixel a
 * pixel o que o browser mostra. Os desenhos são autónomos (cores literais, sem
 * `var(--…)` nem `currentColor`), por isso sobrevivem intactos fora do documento.
 */

/* -------------------------------------------------------------------------- */
/* Medidas                                                                     */
/* -------------------------------------------------------------------------- */

/** A4 em milímetros, com a margem que o produto usa em papel. */
const PAG = { w: 210, h: 297, m: 16 };
const LARGURA = PAG.w - PAG.m * 2;

/** Densidade do PNG dos campos. 2,6 px/mm ≈ 200 dpi — nítido sem inchar o ficheiro. */
const DENSIDADE = 2.6;

type Doc = import("jspdf").jsPDF;

/* -------------------------------------------------------------------------- */
/* Do SVG para o papel                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Um SVG desenhado num canvas, devolvido como PNG.
 *
 * O `xmlns` é obrigatório: sem ele o browser não aceita o SVG como imagem e a
 * promessa fica pendurada para sempre. E `width`/`height` explícitos, porque um
 * SVG só com `viewBox` dentro de um `<img>` não tem tamanho intrínseco em
 * Firefox — desenharia a zero.
 */
async function svgParaPng(svg: string, larguraMm: number, alturaMm: number): Promise<string> {
  const w = Math.round(larguraMm * DENSIDADE * 2);
  const h = Math.round(alturaMm * DENSIDADE * 2);

  const completo = svg
    .replace("<svg", `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"`)
    .replace(/&nbsp;/g, " ");

  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(completo)}`;
  const img = new Image();
  img.decoding = "sync";

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Não foi possível desenhar o campo."));
    img.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este browser não consegue desenhar campos.");
  /*
   * Fundo branco antes do desenho.
   *
   * O `background` do SVG é um estilo do elemento, não do conteúdo — passa para
   * um `<img>` mas não para o canvas. Sem isto, as barras que o `meet` deixa
   * ficavam transparentes, e transparência num PDF imprime-se a preto nalgumas
   * impressoras.
   */
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

/** O SVG de um frame de um diagrama, no tamanho que vai ocupar. */
function svgDoFrame(diagram: unknown, frame: number, ratio: number): string {
  return renderToStaticMarkup(<FieldView diagram={diagram} frame={frame} ratio={ratio} />);
}

/** O SVG do onze de um modelo — o mesmo desenho da página, sem o arrastar. */
function svgDoOnze(data: LineupData, ratio: number): string {
  const v = baseView(data.pitch);
  const k = itemScale(data.pitch);
  return renderToStaticMarkup(
    <svg
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      style={{ background: pitchBackground(data.pitch), aspectRatio: String(ratio) }}
      preserveAspectRatio="xMidYMid meet"
    >
      <Pitch field={data.pitch} />
      {data.slots.map((s) => (
        <g key={s.id} transform={`translate(${s.x} ${s.y}) scale(${k})`}>
          <circle r={2.2} fill="#1d3a5f" stroke="rgba(255,255,255,0.85)" strokeWidth={0.25} />
          <text y={0.8} textAnchor="middle" fontSize={1.9} fontWeight={700} fill="#fff">
            {s.label}
          </text>
        </g>
      ))}
    </svg>,
  );
}

/* -------------------------------------------------------------------------- */
/* O documento                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * O estilo do papel, num sítio só.
 *
 * A cor do clube entra pelo tom que se **vê**: `signalOnSurface` é a mesma cor
 * escurecida até aos 3:1 contra o branco. Um clube de amarelo claro imprimia
 * um filete invisível e um cabeçalho ilegível — é o mesmo cuidado que o menu e
 * os contornos de foco já levam (ver `tokens.ts`).
 */
class Folha {
  readonly doc: Doc;
  private y = PAG.m;
  private readonly cor: string;

  constructor(doc: Doc) {
    this.doc = doc;
    this.cor = signalOnSurface(academy.signalColor || "#0f6b62");
    doc.setFont("helvetica", "normal");
  }

  /** Espaço livre até ao fim da página. */
  get resta(): number {
    return PAG.h - PAG.m - this.y;
  }

  get topo(): number {
    return this.y;
  }

  novaPagina(): void {
    this.doc.addPage();
    this.y = PAG.m;
  }

  /** Abre espaço; muda de página se não couber. */
  garante(altura: number): void {
    if (this.resta < altura) this.novaPagina();
  }

  espaco(mm: number): void {
    this.y += mm;
  }

  /**
   * O cabeçalho de cada página — o clube à esquerda, o contexto à direita.
   *
   * Repetido em todas as páginas de propósito: estas folhas imprimem-se e
   * separam-se. Uma página solta com um campo desenhado e nada mais é uma folha
   * que ninguém sabe de onde veio.
   */
  cabecalho(titulo: string, direita?: string): void {
    const d = this.doc;
    d.setFontSize(8.5);
    d.setTextColor(120);
    d.text(academy.shortName || academy.name || "Academia", PAG.m, PAG.m - 5);
    if (direita) d.text(direita, PAG.w - PAG.m, PAG.m - 5, { align: "right" });
    d.setDrawColor(this.cor);
    d.setLineWidth(0.6);
    d.line(PAG.m, PAG.m - 3, PAG.w - PAG.m, PAG.m - 3);
    d.setTextColor(0);
    this.y = PAG.m + 4;
    if (titulo) this.titulo(titulo);
  }

  titulo(texto: string): void {
    const d = this.doc;
    d.setFont("helvetica", "bold");
    d.setFontSize(17);
    d.setTextColor(20);
    const linhas = d.splitTextToSize(texto, LARGURA) as string[];
    d.text(linhas, PAG.m, this.y + 6);
    this.y += 6 + (linhas.length - 1) * 7.5 + 3;
    d.setFont("helvetica", "normal");
  }

  subtitulo(texto: string): void {
    if (!texto) return;
    const d = this.doc;
    d.setFontSize(9.5);
    d.setTextColor(110);
    const linhas = d.splitTextToSize(texto, LARGURA) as string[];
    d.text(linhas, PAG.m, this.y + 4);
    this.y += 4 + (linhas.length - 1) * 4.6 + 3;
    d.setTextColor(0);
  }

  /** Um título de secção, com o filete na cor do clube por baixo. */
  seccao(texto: string): void {
    this.garante(18);
    const d = this.doc;
    this.y += 4;
    d.setFont("helvetica", "bold");
    d.setFontSize(10);
    d.setTextColor(this.cor);
    d.text(texto.toUpperCase(), PAG.m, this.y);
    d.setDrawColor(225);
    d.setLineWidth(0.3);
    d.line(PAG.m, this.y + 1.8, PAG.w - PAG.m, this.y + 1.8);
    d.setTextColor(0);
    d.setFont("helvetica", "normal");
    this.y += 6;
  }

  /** Um parágrafo, que muda de página quando acaba o espaço. */
  paragrafo(texto: string | null | undefined): void {
    if (!texto?.trim()) return;
    const d = this.doc;
    d.setFontSize(10);
    d.setTextColor(35);
    for (const linha of d.splitTextToSize(texto.trim(), LARGURA) as string[]) {
      this.garante(6);
      d.text(linha, PAG.m, this.y + 3.4);
      this.y += 4.9;
    }
    this.y += 1.5;
  }

  /**
   * Os factos do exercício em duas colunas.
   *
   * Duas e não uma tabela: são pares curtos — "Duração: 15 min", "Espaço: 30×20"
   * — e uma tabela com molduras à volta de doze palavras faz mais barulho do que
   * as palavras.
   */
  factos(pares: [string, string | null | undefined][]): void {
    const cheios = pares.filter((p): p is [string, string] => Boolean(p[1]?.toString().trim()));
    if (cheios.length === 0) return;
    const d = this.doc;
    const colW = LARGURA / 2;
    for (let i = 0; i < cheios.length; i += 2) {
      this.garante(7);
      cheios.slice(i, i + 2).forEach(([rotulo, valor], col) => {
        const x = PAG.m + col * colW;
        d.setFontSize(8);
        d.setTextColor(140);
        d.text(rotulo.toUpperCase(), x, this.y + 3);
        d.setFontSize(10);
        d.setTextColor(25);
        const v = (d.splitTextToSize(String(valor), colW - 6) as string[])[0];
        d.text(v, x, this.y + 7.6);
      });
      this.y += 11;
    }
    d.setTextColor(0);
  }

  /** Uma imagem que ocupa a largura toda, com a altura que a proporção pedir. */
  async campo(svg: string, ratio: number, altura = LARGURA / ratio): Promise<void> {
    this.garante(altura + 4);
    const png = await svgParaPng(svg, LARGURA, altura);
    this.doc.addImage(png, "PNG", PAG.m, this.y, LARGURA, altura);
    this.doc.setDrawColor(215);
    this.doc.setLineWidth(0.3);
    this.doc.rect(PAG.m, this.y, LARGURA, altura);
    this.y += altura + 4;
  }

  /** O rodapé com a numeração, escrito no fim sobre todas as páginas. */
  fechar(): void {
    const d = this.doc;
    const total = d.getNumberOfPages();
    const hoje = longDate(new Date());
    for (let i = 1; i <= total; i += 1) {
      d.setPage(i);
      d.setFontSize(8);
      d.setTextColor(150);
      d.text(`Gerado a ${hoje}`, PAG.m, PAG.h - 8);
      d.text(`${i}/${total}`, PAG.w - PAG.m, PAG.h - 8, { align: "right" });
    }
  }
}

async function novaFolha(): Promise<Folha> {
  const { jsPDF } = await import("jspdf");
  return new Folha(new jsPDF({ unit: "mm", format: "a4" }));
}

function guardar(folha: Folha, nome: string): void {
  folha.fechar();
  folha.doc.save(nome);
}

/** `Passe em profundidade` → `ad-fafe_exercicio_passe-em-profundidade.pdf` */
function nomeDoFicheiro(tipo: string, titulo: string): string {
  const limpa = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const clube = limpa(academy.slug || academy.shortName || "academia");
  return `${clube}_${tipo}_${limpa(titulo) || "sem-nome"}.pdf`;
}

/* -------------------------------------------------------------------------- */
/* Os frames                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Os frames de um diagrama, um por página.
 *
 * Com **um** frame não há sequência nenhuma para contar: o desenho entra na
 * própria página da ficha, a seguir ao texto, e não se gasta uma folha nem se
 * escreve "Frame 1 de 1" — que é ruído a fingir-se de informação.
 */
async function frames(folha: Folha, diagram: unknown, titulo: string): Promise<void> {
  const d = asDiagram(diagram);
  if (!d) return;

  const v = baseView(d.field);
  const ratio = v.w / v.h;

  if (d.frames.length === 1) {
    folha.seccao("Desenho");
    await folha.campo(svgDoFrame(diagram, 0, ratio), ratio, Math.min(LARGURA / ratio, 150));
    legenda(folha, diagram, 0);
    return;
  }

  for (let i = 0; i < d.frames.length; i += 1) {
    folha.novaPagina();
    folha.cabecalho(titulo, `Frame ${i + 1} de ${d.frames.length}`);
    // A altura que sobra, menos o espaço da legenda e da nota.
    const alturaMax = Math.min(LARGURA / ratio, folha.resta - 40);
    await folha.campo(svgDoFrame(diagram, i, ratio), ratio, alturaMax);

    const nota = d.frames[i].note?.trim();
    if (nota) folha.paragrafo(nota);
    legenda(folha, diagram, i);
  }
}

/**
 * O que cada símbolo quer dizer, só do que está neste frame.
 *
 * Uma legenda com os catorze símbolos possíveis é uma legenda que ninguém lê.
 * Esta conta o que o frame tem: "6 jogadores · 3 cones · 2 passes".
 */
function legenda(folha: Folha, diagram: unknown, frame: number): void {
  const d = asDiagram(diagram);
  const f = d?.frames[frame];
  if (!f) return;

  const contar = <T extends string>(lista: { kind: T }[]) => {
    const m = new Map<T, number>();
    for (const x of lista) m.set(x.kind, (m.get(x.kind) ?? 0) + 1);
    return m;
  };

  const partes: string[] = [];
  for (const [kind, n] of contar(f.items)) partes.push(`${n} ${ITEM_LABEL[kind] ?? kind}`);
  for (const [kind, n] of contar(f.arrows)) partes.push(`${n} ${ARROW_LABEL[kind] ?? kind}`);
  if (partes.length === 0) return;

  folha.garante(8);
  const doc = folha.doc;
  doc.setFontSize(8.5);
  doc.setTextColor(130);
  for (const linha of doc.splitTextToSize(partes.join("  ·  "), LARGURA) as string[]) {
    doc.text(linha, PAG.m, folha.topo + 3);
    folha.espaco(4.2);
  }
  doc.setTextColor(0);
}

/* -------------------------------------------------------------------------- */
/* Exercício                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * O que o PDF precisa de um exercício.
 *
 * `ExerciseFull` menos os campos de identidade — porque a página de edição
 * trabalha sobre um rascunho (`Draft`) que ainda não os tem, e exportar antes de
 * gravar é um pedido legítimo: escreve-se a ficha, imprime-se, leva-se para o
 * campo. Pedir `ExerciseFull` obrigaria a gravar primeiro sem nenhuma razão.
 */
export type ExercicioImprimivel = Omit<
  ExerciseFull,
  "id" | "authorName" | "updatedAt" | "mine" | "editable" | "visibility"
>;

export async function exportarExercicio(ex: ExercicioImprimivel): Promise<void> {
  const folha = await novaFolha();
  folha.cabecalho("", "Exercício");
  folha.titulo(ex.name);
  folha.subtitulo([ex.category, ex.phase, ex.type].filter(Boolean).join(" · "));

  folha.factos([
    ["Duração", ex.durationMin ? `${ex.durationMin} min` : null],
    ["Jogadores", ex.players],
    ["Espaço", ex.space],
    ["Material", ex.material],
    ["Intensidade", ex.intensity ? `${ex.intensity}/5` : null],
    ["Complexidade", ex.complexity ? `${ex.complexity}/5` : null],
    ["Escalão", ex.ageMin || ex.ageMax ? `${ex.ageMin ?? "?"}–${ex.ageMax ?? "?"} anos` : null],
    ["Objectivos", ex.objectives.length ? ex.objectives.join(", ") : null],
  ]);

  if (ex.description?.trim()) {
    folha.seccao("Descrição");
    folha.paragrafo(ex.description);
  }

  await frames(folha, ex.diagram, ex.name);

  /*
   * O texto todo, e por esta ordem.
   *
   * É a ordem com que um treinador lê a ficha em cima do relvado: primeiro como
   * se joga (regras), depois como se muda se estiver fácil ou difícil
   * (progressões, regressões), e por fim o que dizer aos miúdos.
   */
  for (const [rotulo, texto] of [
    ["Regras", ex.rules],
    ["Progressões", ex.progressions],
    ["Regressões", ex.regressions],
    ["Pontos de treino", ex.coachingPoints],
    ["Erros comuns", ex.commonErrors],
  ] as const) {
    if (!texto?.trim()) continue;
    folha.seccao(rotulo);
    folha.paragrafo(texto);
  }

  if (ex.videoUrl?.trim()) {
    folha.seccao("Vídeo");
    folha.paragrafo(ex.videoUrl);
  }

  guardar(folha, nomeDoFicheiro("exercicio", ex.name));
}

/* -------------------------------------------------------------------------- */
/* Modelo de jogo                                                              */
/* -------------------------------------------------------------------------- */

export async function exportarModelo(m: GameModelRow): Promise<void> {
  const folha = await novaFolha();
  folha.cabecalho("", "Modelo de jogo");
  folha.titulo(m.name);
  folha.subtitulo([m.system, m.teamName].filter(Boolean).join(" · "));

  const lineup = asLineupData(m.lineup);
  if (lineup.slots.length > 0) {
    folha.seccao("Onze-tipo");
    const v = baseView(lineup.pitch);
    const ratio = v.w / v.h;
    await folha.campo(svgDoOnze(lineup, ratio), ratio, Math.min(LARGURA / ratio, 155));
  }

  /*
   * Os princípios, secção a secção, e só os que estão escritos.
   *
   * As quatro secções e os seus tópicos vêm de `PRINCIPLE_SECTIONS` — a mesma
   * lista que o ecrã usa. Um tópico em branco não se imprime: um modelo com
   * "Saída de bola" vazio em papel diz que o treinador não pensou nisso, quando
   * o que diz é que ainda não escreveu.
   */
  const principios = (m.principles ?? {}) as Principles;
  for (const seccao of PRINCIPLE_SECTIONS) {
    const conteudo = principios[seccao.key] ?? {};
    const escritos = seccao.topics.filter((t) => conteudo[t]?.trim());
    if (escritos.length === 0) continue;

    folha.seccao(seccao.label);
    for (const topico of escritos) {
      folha.garante(12);
      const d = folha.doc;
      d.setFont("helvetica", "bold");
      d.setFontSize(9.5);
      d.text(topico, PAG.m, folha.topo + 3);
      folha.espaco(5);
      d.setFont("helvetica", "normal");
      folha.paragrafo(conteudo[topico]);
    }
  }

  if (m.notes?.trim()) {
    folha.seccao("Notas");
    folha.paragrafo(m.notes);
  }

  guardar(folha, nomeDoFicheiro("modelo-de-jogo", m.name));
}

/* -------------------------------------------------------------------------- */
/* Bola parada                                                                 */
/* -------------------------------------------------------------------------- */

export async function exportarBolaParada(sp: SetPieceRow): Promise<void> {
  const folha = await novaFolha();
  const tipo = SET_PIECE_KINDS.find((k) => k.key === sp.kind)?.label ?? "Bola parada";

  folha.cabecalho("", tipo);
  folha.titulo(sp.name);
  folha.subtitulo(sp.teamName ?? "");

  if (sp.description?.trim()) {
    folha.seccao("Descrição");
    folha.paragrafo(sp.description);
  }

  await frames(folha, sp.diagram, sp.name);

  guardar(folha, nomeDoFicheiro("bola-parada", sp.name));
}

/* -------------------------------------------------------------------------- */
/* Plano de treino                                                             */
/* -------------------------------------------------------------------------- */

/**
 * O plano de treino, com os exercícios lá dentro.
 *
 * ## O que sai, e o que se foi buscar
 *
 * A primeira página é o plano: a equipa, a hora, o objectivo, e a lista de
 * blocos com a duração de cada um. É a folha que se leva para o campo.
 *
 * A seguir vem **a ficha de cada exercício usado**, com os desenhos e os frames.
 * O plano diz "15 min · Posse 4v4"; sem a ficha, o treinador tem de a ter na
 * cabeça ou voltar ao telemóvel — que é exactamente o que um PDF existe para
 * evitar.
 *
 * Os exercícios vêm da API (`carregarExercicio`) porque o bloco só guarda o id e
 * o nome: a ficha completa, com o diagrama, não está na página do plano.
 *
 * ## Um exercício repetido imprime-se uma vez
 *
 * Um plano pode usar o mesmo jogo em dois momentos. A ficha vai uma vez, e os
 * dois blocos apontam para ela.
 */
export async function exportarPlano(
  plan: SessionPlan,
  carregarExercicio: (id: string) => Promise<ExercicioImprimivel>,
): Promise<void> {
  const folha = await novaFolha();
  const inicio = new Date(plan.startsAt);

  folha.cabecalho("", "Plano de treino");
  folha.titulo(`${plan.teamName} · ${time(inicio)}`);
  folha.subtitulo(
    [longDate(inicio), plan.venue, plan.coachName].filter(Boolean).join(" · "),
  );

  const total = plan.blocks.reduce((n, b) => n + (b.durationMin || 0), 0);
  folha.factos([
    ["Duração", total ? `${total} min` : null],
    ["Tipo de sessão", plan.sessionType],
    ["Intensidade", plan.intensity ? `${plan.intensity}/5` : null],
    ["Atletas previstos", plan.expectedAthletes ? String(plan.expectedAthletes) : null],
    ["Objectivo", plan.objective],
    ["Objectivos", plan.objectives.length ? plan.objectives.join(", ") : null],
    ["Material", plan.material],
  ]);

  if (plan.planNotes?.trim()) {
    folha.seccao("Notas do plano");
    folha.paragrafo(plan.planNotes);
  }

  /*
   * Os blocos como uma tabela desenhada à mão.
   *
   * O `jspdf-autotable` está no projecto e daria isto em três linhas — mas com a
   * sua própria tipografia e as suas próprias molduras, ao lado de um documento
   * que não as tem. Cinco linhas de `text()` mantêm a folha com uma voz só.
   */
  if (plan.blocks.length > 0) {
    folha.seccao("Blocos");
    const d = folha.doc;
    let minuto = 0;

    for (const [i, b] of plan.blocks.entries()) {
      folha.garante(14);
      const y = folha.topo;
      const fim = minuto + (b.durationMin || 0);

      d.setDrawColor(232);
      d.setLineWidth(0.3);
      if (i > 0) d.line(PAG.m, y - 1, PAG.w - PAG.m, y - 1);

      // A janela de tempo à esquerda: é por ela que se segue o treino.
      d.setFont("helvetica", "bold");
      d.setFontSize(9);
      d.setTextColor(90);
      d.text(`${minuto}'–${fim}'`, PAG.m, y + 4.5);

      d.setFontSize(10.5);
      d.setTextColor(20);
      d.text((d.splitTextToSize(b.name, LARGURA - 40) as string[])[0], PAG.m + 20, y + 4.5);

      d.setFont("helvetica", "normal");
      d.setFontSize(9);
      d.setTextColor(120);
      const detalhe = [
        b.category,
        b.players ? `${b.players} jogadores` : null,
        b.intensity ? `intensidade ${b.intensity}/5` : null,
        b.objective,
      ]
        .filter(Boolean)
        .join(" · ");
      if (detalhe) {
        d.text((d.splitTextToSize(detalhe, LARGURA - 22) as string[])[0], PAG.m + 20, y + 9);
        folha.espaco(13);
      } else {
        folha.espaco(8.5);
      }

      if (b.notes?.trim()) folha.paragrafo(b.notes);
      minuto = fim;
    }
    d.setTextColor(0);
  }

  /* As fichas dos exercícios usados — uma vez cada, pela ordem do plano. */
  const ids = [...new Set(plan.blocks.map((b) => b.exerciseId).filter((x): x is string => Boolean(x)))];

  for (const id of ids) {
    let ex: ExercicioImprimivel;
    try {
      ex = await carregarExercicio(id);
    } catch {
      /*
       * Um exercício que já não abre não trava o plano.
       *
       * Pode ter sido arquivado, ou ser de outro treinador com visibilidade
       * privada. A folha do treino é a parte que interessa; sai à mesma, e o
       * bloco continua lá com o nome.
       */
      continue;
    }

    folha.novaPagina();
    folha.cabecalho("", "Exercício do plano");
    folha.titulo(ex.name);
    folha.subtitulo([ex.category, ex.phase, ex.type].filter(Boolean).join(" · "));
    folha.factos([
      ["Duração", ex.durationMin ? `${ex.durationMin} min` : null],
      ["Jogadores", ex.players],
      ["Espaço", ex.space],
      ["Material", ex.material],
    ]);
    if (ex.description?.trim()) folha.paragrafo(ex.description);
    await frames(folha, ex.diagram, ex.name);
    for (const [rotulo, texto] of [
      ["Regras", ex.rules],
      ["Pontos de treino", ex.coachingPoints],
    ] as const) {
      if (!texto?.trim()) continue;
      folha.seccao(rotulo);
      folha.paragrafo(texto);
    }
  }

  guardar(folha, nomeDoFicheiro("treino", `${plan.teamName}-${plan.startsAt.slice(0, 10)}`));
}
