import { renderToStaticMarkup } from "react-dom/server";
import { signalOnSurface } from "@academia/ui/tokens";
import { FieldView, Pitch, baseView, itemScale, pitchBackground } from "@/components/FieldEditor";
import { academy, currentSeason } from "@/lib/store";
import { carregarEmblema } from "@/lib/callup-sheet";
import { longDate, time } from "@/lib/format";
import { SPORT_PROFILES, kindLabel, sportAreaById } from "@/lib/sports";
import {
  ARROW_LABEL,
  ITEM_LABEL,
  PRINCIPLE_SECTIONS,
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
  // O perfil da modalidade dá os nomes — "Sistema de jogo", "Posições de
  // partida" — e as secções dos princípios; sem ele, o futebol de sempre.
  const perfil = sportAreaById(m.sportId)?.profile ?? SPORT_PROFILES.football;
  const tipo = perfil.playbook.kinds && m.kind ? kindLabel([{ label: null, kinds: perfil.playbook.kinds }], m.kind) : null;
  const um = perfil.playbook.count(1).replace(/^1 /, "");
  folha.cabecalho("", um[0].toUpperCase() + um.slice(1));
  folha.titulo(m.name);
  folha.subtitulo([tipo, m.system, m.teamName].filter(Boolean).join(" · "));

  const lineup = asLineupData(m.lineup);
  if (lineup.slots.length > 0) {
    folha.seccao(perfil.playbook.lineupLabel);
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
  const seccoes = perfil.playbook.sections.length ? perfil.playbook.sections : PRINCIPLE_SECTIONS;
  for (const seccao of seccoes) {
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

  if (m.exercises?.length) {
    folha.seccao("Exercícios relacionados");
    for (const e of m.exercises) folha.paragrafo(`• ${e.name}`);
  }

  if (m.notes?.trim()) {
    folha.seccao("Notas");
    folha.paragrafo(m.notes);
  }

  guardar(folha, nomeDoFicheiro(perfil.playbook.slug, m.name));
}

/* -------------------------------------------------------------------------- */
/* Bola parada                                                                 */
/* -------------------------------------------------------------------------- */

export async function exportarBolaParada(sp: SetPieceRow): Promise<void> {
  const folha = await novaFolha();
  const perfil = sportAreaById(sp.sportId)?.profile ?? SPORT_PROFILES.football;
  const tipo = kindLabel(perfil.situations.groups, sp.kind);

  folha.cabecalho("", tipo);
  folha.titulo(sp.name);
  folha.subtitulo([sp.teamName, sp.gameModelName].filter(Boolean).join(" · "));

  if (sp.description?.trim()) {
    folha.seccao("Descrição");
    folha.paragrafo(sp.description);
  }

  await frames(folha, sp.diagram, sp.name);

  if (sp.exercises?.length) {
    folha.seccao("Exercícios relacionados");
    for (const e of sp.exercises) folha.paragrafo(`• ${e.name}`);
  }

  guardar(folha, nomeDoFicheiro(perfil.situations.slug, sp.name));
}

/* -------------------------------------------------------------------------- */
/* Plano de treino                                                             */
/* -------------------------------------------------------------------------- */

/**
 * O plano de treino — a folha densa.
 *
 * ## Uma folha, não um dossier
 *
 * A primeira versão disto era uma página de plano e depois **uma ficha por
 * exercício**, cada frame na sua página. Saía um dossier de doze folhas para um
 * treino de noventa minutos, e o treinador queria o contrário: a folha de
 * treino que se leva para o campo numa mão, com tudo à vista — o mesmo desenho
 * que os planos de treino têm em papel há trinta anos.
 *
 * O desenho é esse: um cabeçalho com o emblema e o clube; uma grelha com os
 * factos do treino (data, hora, duração, local, material, objectivos); e, por
 * fase, um painel por exercício com o **campo à esquerda, a descrição ao meio e
 * o tempo/atletas/espaço numa coluna estreita à direita**, fechado por uma
 * linha de observações com o tempo acumulado. Tudo dentro de molduras, com
 * pouco ar: o espaço em branco que uma ficha bonita gosta de ter é o espaço
 * que aqui falta para a folha caber numa página.
 *
 * ## O que se foi buscar
 *
 * O bloco só guarda o id e o nome do exercício; a descrição, o desenho, o
 * espaço e a fase vêm da ficha (`carregarExercicio`). Um exercício que já não
 * abre — arquivado, ou privado de outro treinador — não trava a folha: o painel
 * sai com o que o bloco tem.
 *
 * ## As fases
 *
 * Os blocos saem pela ordem do plano. A fase é a do exercício, e escreve-se
 * como título sempre que muda — "Fase inicial", "Fase fundamental" — sem
 * reordenar nada: a ordem do plano é a ordem do treino.
 */

/** As molduras da folha, todas iguais. */
const MOLDURA = { cor: 170, grossura: 0.25 };
/** O cinzento das células de rótulo e das barras de título. */
const CINZA = 232;

type Bloco = {
  b: SessionPlan["blocks"][number];
  ex: ExercicioImprimivel | null;
  /** O campo do exercício em PNG, já no tamanho da coluna — nulo sem desenho. */
  imagem: { dados: string; formato: "PNG" | "JPEG" | "WEBP"; w: number; h: number } | null;
};

export async function exportarPlano(
  plan: SessionPlan,
  carregarExercicio: (id: string) => Promise<ExercicioImprimivel>,
): Promise<void> {
  const folha = await novaFolha();
  const d = folha.doc;
  const inicio = new Date(plan.startsAt);
  const fim = new Date(plan.endsAt);

  /* ---- O que se vai buscar antes de desenhar ------------------------------ */

  const emblema = await carregarEmblema(academy.logoUrl ?? "");

  const fichas = new Map<string, ExercicioImprimivel | null>();
  for (const id of new Set(plan.blocks.map((b) => b.exerciseId).filter((x): x is string => Boolean(x)))) {
    try {
      fichas.set(id, await carregarExercicio(id));
    } catch {
      fichas.set(id, null);
    }
  }

  const LARG_IMG = 62;
  const blocos: Bloco[] = [];
  for (const b of plan.blocks) {
    const ex = b.exerciseId ? (fichas.get(b.exerciseId) ?? null) : null;
    blocos.push({ b, ex, imagem: ex ? await imagemDoExercicio(ex, LARG_IMG) : null });
  }

  /* ---- Cabeçalho ---------------------------------------------------------- */

  let y = PAG.m;
  const ALTO_EMBLEMA = 18;
  let xTexto = PAG.m;
  if (emblema) {
    const k = Math.min(ALTO_EMBLEMA / emblema.largura, ALTO_EMBLEMA / emblema.altura);
    const w = emblema.largura * k;
    const h = emblema.altura * k;
    d.addImage(emblema.dados, emblema.formato, PAG.m + (ALTO_EMBLEMA - w) / 2, y + (ALTO_EMBLEMA - h) / 2, w, h);
    xTexto = PAG.m + ALTO_EMBLEMA + 5;
  }
  d.setFont("helvetica", "normal");
  d.setFontSize(16);
  d.setTextColor(35);
  d.text(academy.name || academy.shortName || "Academia", xTexto, y + 7);
  d.setFontSize(11);
  d.setTextColor(110);
  d.text(plan.teamName, xTexto, y + 13.5);

  d.setFontSize(12);
  d.setTextColor(35);
  d.text("Plano de treino", PAG.w - PAG.m, y + 7, { align: "right" });
  if (currentSeason) {
    d.setFont("helvetica", "bold");
    d.setFontSize(10);
    d.text(`Época ${currentSeason}`, PAG.w - PAG.m, y + 13.5, { align: "right" });
    d.setFont("helvetica", "normal");
  }
  y += ALTO_EMBLEMA + 8;

  /* ---- A grelha dos factos ------------------------------------------------ */

  const minutos = Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 60_000));
  const semana = inicio.toLocaleDateString("pt-PT", { weekday: "long" });
  const objectivos = [plan.objective, ...plan.objectives].filter((x): x is string => Boolean(x?.trim()));

  y = grelha(d, y, [
    [
      { rotulo: "Data", valor: `${dataNumerica(inicio)} (${semana[0].toUpperCase()}${semana.slice(1)})` },
      { rotulo: "Hora", valor: `${time(inicio)} às ${time(fim)}` },
      { rotulo: "Duração", valor: `${minutos}'` },
    ],
    [
      { rotulo: "Local", valor: plan.venue || "—" },
      { rotulo: "Treinador", valor: plan.coachName || "—" },
      {
        rotulo: "Sessão",
        valor: [plan.sessionType, plan.intensity ? `intensidade ${plan.intensity}/5` : null].filter(Boolean).join(" · ") || "—",
      },
    ],
    [
      { rotulo: "Material", valor: plan.material || "—", span: 2 },
      { rotulo: "Atletas previstos", valor: plan.expectedAthletes ? String(plan.expectedAthletes) : "—" },
    ],
    plan.planNotes?.trim()
      ? [
          { rotulo: "Principais objectivos", valor: objectivos.join("; ") || "—", cabeca: true, span: 2 },
          { rotulo: "Notas do plano", valor: plan.planNotes.trim(), cabeca: true },
        ]
      : [{ rotulo: "Principais objectivos", valor: objectivos.join("; ") || "—", cabeca: true, span: 3 }],
  ]);

  /* ---- Os painéis, por fase ----------------------------------------------- */

  let acumulado = 0;
  let faseActual: string | null = null;

  for (const bloco of blocos) {
    const fase = bloco.ex?.phase?.trim() || null;
    if (fase && fase !== faseActual) {
      faseActual = fase;
      y = tituloDeFase(d, y, fase);
    }

    acumulado += bloco.b.durationMin || 0;
    y = painel(d, y, bloco, acumulado, LARG_IMG);
  }

  if (plan.postNotes?.trim()) {
    y = tituloDeFase(d, y, "Depois do treino");
    y = caixaDeTexto(d, y, "Notas", plan.postNotes.trim());
  }

  folha.fechar();
  d.save(nomeDoFicheiro("treino", `${plan.teamName}-${plan.startsAt.slice(0, 10)}`));
}

/* ---- As peças da folha --------------------------------------------------- */

type Celula = { rotulo: string; valor: string; span?: number; cabeca?: boolean };

/**
 * A grelha dos factos: três colunas, rótulo a negrito e valor a seguir na
 * mesma célula. Uma célula "cabeça" põe o rótulo numa linha própria e o valor
 * por baixo — para os objectivos, que são frases e não pares.
 */
function grelha(d: Doc, y0: number, linhas: Celula[][]): number {
  const colW = LARGURA / 3;
  const PAD = 2;
  let y = y0;

  for (const linha of linhas) {
    // A altura da linha é a da célula mais alta.
    const alturas = linha.map((c) => {
      const w = colW * (c.span ?? 1) - PAD * 2;
      const linhasTexto = textoDaCelula(d, c, w);
      return (c.cabeca ? 4.5 : 0) + linhasTexto.length * 3.6 + PAD * 2;
    });
    const h = Math.max(6.5, ...alturas);

    let x = PAG.m;
    linha.forEach((c, i) => {
      const w = colW * (c.span ?? 1);
      d.setFillColor(c.cabeca ? 255 : CINZA, c.cabeca ? 255 : CINZA, c.cabeca ? 255 : CINZA);
      d.setDrawColor(MOLDURA.cor);
      d.setLineWidth(MOLDURA.grossura);
      d.rect(x, y, w, h, "FD");

      d.setFontSize(8);
      d.setTextColor(30);
      if (c.cabeca) {
        d.setFont("helvetica", "bold");
        d.text(`${c.rotulo}:`, x + PAD, y + PAD + 2.8);
        d.setFont("helvetica", "normal");
        d.setTextColor(50);
        const ls = textoDaCelula(d, c, w - PAD * 2);
        d.text(ls, x + PAD, y + PAD + 2.8 + 4.5);
      } else {
        d.setFont("helvetica", "bold");
        const rot = `${c.rotulo}: `;
        d.text(rot, x + PAD, y + PAD + 2.8);
        const larguraRotulo = d.getTextWidth(rot);
        d.setFont("helvetica", "normal");
        const ls = d.splitTextToSize(c.valor, w - PAD * 2 - larguraRotulo) as string[];
        // A primeira linha a seguir ao rótulo; as restantes alinhadas com ele.
        d.text(ls[0] ?? "", x + PAD + larguraRotulo, y + PAD + 2.8);
        if (ls.length > 1) d.text(ls.slice(1), x + PAD + larguraRotulo, y + PAD + 2.8 + 3.6);
      }
      x += w;
      void i;
    });
    y += h;
  }
  d.setTextColor(0);
  return y + 6;
}

function textoDaCelula(d: Doc, c: Celula, largura: number): string[] {
  d.setFontSize(8);
  if (c.cabeca) return c.valor ? (d.splitTextToSize(c.valor, largura) as string[]) : [];
  d.setFont("helvetica", "bold");
  const larguraRotulo = d.getTextWidth(`${c.rotulo}: `);
  d.setFont("helvetica", "normal");
  return d.splitTextToSize(c.valor, largura - larguraRotulo) as string[];
}

/** `21/09/2023` — a data como se escreve numa folha de treino. */
function dataNumerica(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** "Fase inicial" — um título, com o filete por baixo. */
function tituloDeFase(d: Doc, y: number, texto: string): number {
  if (PAG.h - PAG.m - y < 40) {
    d.addPage();
    y = PAG.m;
  }
  d.setFont("helvetica", "bold");
  d.setFontSize(11);
  d.setTextColor(30);
  const t = texto[0].toUpperCase() + texto.slice(1);
  d.text(/^fase\b/i.test(t) ? t : `Fase: ${t}`, PAG.m, y + 4);
  d.setFont("helvetica", "normal");
  return y + 9;
}

/**
 * O painel de um bloco: barra de título, corpo em três colunas, e a linha das
 * observações com o tempo acumulado. Não se parte a meio — se não couber no
 * que resta da página, vai inteiro para a seguinte.
 */
function painel(d: Doc, y0: number, { b, ex, imagem }: Bloco, acumulado: number, largImg: number): number {
  const PAD = 2.2;
  const LARG_DIR = 26;
  const temImagem = Boolean(imagem);
  const xImg = PAG.m;
  const xMeio = temImagem ? PAG.m + largImg : PAG.m;
  const xDir = PAG.w - PAG.m - LARG_DIR;
  const largMeio = xDir - xMeio;

  /* O texto do meio: descrição e objectivos específicos. */
  const descricao = (ex?.description?.trim() || b.notes?.trim() || "").trim();
  const objectivos = [...new Set([b.objective?.trim() || null, ...(ex?.objectives ?? [])].filter((x): x is string => Boolean(x)))];
  const extras = [
    ex?.rules?.trim() ? ["Regras", ex.rules.trim()] : null,
    ex?.coachingPoints?.trim() ? ["Pontos de treino", ex.coachingPoints.trim()] : null,
  ].filter((x): x is [string, string] => Boolean(x));

  d.setFontSize(8);
  const corpo: { rotulo: string; linhas: string[] }[] = [];
  corpo.push({ rotulo: "Descrição", linhas: d.splitTextToSize(descricao, largMeio - PAD * 2) as string[] });
  corpo.push({ rotulo: "Objectivos específicos", linhas: d.splitTextToSize(objectivos.join("; "), largMeio - PAD * 2) as string[] });
  for (const [r, t] of extras) corpo.push({ rotulo: r, linhas: d.splitTextToSize(t, largMeio - PAD * 2) as string[] });

  const alturaMeio = corpo.reduce((h, s) => h + 4.2 + s.linhas.length * 3.5 + 1.5, PAD * 2);

  /* A coluna da direita: tempo, atletas, espaço, intensidade. */
  const direita: [string, string][] = [
    ["Tempo", `${b.durationMin || 0}'`],
    ["Atletas", b.players?.trim() || ex?.players?.trim() || "—"],
    ["Espaço", ex?.space?.trim() || "—"],
  ];
  if (b.intensity || ex?.intensity) direita.push(["Intensidade", `${b.intensity ?? ex?.intensity}/5`]);
  const alturaDir = PAD * 2 + direita.length * 8.5;

  const alturaImg = imagem ? imagem.h + PAD * 2 : 0;
  const alturaCorpo = Math.max(alturaMeio, alturaDir, alturaImg, 24);

  /* As observações — só do bloco, que a descrição já levou o exercício. */
  const obs = ex ? b.notes?.trim() || "" : "";
  const linhasObs = d.splitTextToSize(obs, LARGURA - LARG_DIR - PAD * 2 - 24) as string[];
  const alturaObs = Math.max(6.5, linhasObs.length * 3.5 + PAD * 2);

  const ALTURA_TITULO = 6.5;
  const total = ALTURA_TITULO + alturaCorpo + alturaObs;

  let y = y0;
  if (PAG.h - PAG.m - y < total) {
    d.addPage();
    y = PAG.m;
  }

  d.setDrawColor(MOLDURA.cor);
  d.setLineWidth(MOLDURA.grossura);

  /* Barra de título. */
  d.setFillColor(CINZA, CINZA, CINZA);
  d.rect(PAG.m, y, LARGURA, ALTURA_TITULO, "FD");
  d.setFont("helvetica", "bold");
  d.setFontSize(9);
  d.setTextColor(30);
  const titulo = b.name || ex?.name || "Bloco";
  d.text((d.splitTextToSize(titulo, LARGURA - PAD * 2) as string[])[0], PAG.m + PAD, y + 4.4);
  y += ALTURA_TITULO;

  /* Corpo: molduras das três colunas. */
  const yCorpo = y;
  if (temImagem) d.rect(xImg, yCorpo, largImg, alturaCorpo);
  d.rect(xMeio, yCorpo, largMeio, alturaCorpo);
  d.rect(xDir, yCorpo, LARG_DIR, alturaCorpo);

  if (imagem) {
    const xi = xImg + (largImg - imagem.w) / 2;
    d.addImage(imagem.dados, imagem.formato, xi, yCorpo + PAD, imagem.w, imagem.h);
  }

  let yy = yCorpo + PAD;
  for (const s of corpo) {
    d.setFont("helvetica", "bold");
    d.setFontSize(8);
    d.setTextColor(30);
    d.text(`${s.rotulo}:`, xMeio + PAD, yy + 2.8);
    d.setFont("helvetica", "normal");
    d.setTextColor(45);
    if (s.linhas.length) d.text(s.linhas, xMeio + PAD, yy + 2.8 + 4.2);
    yy += 4.2 + s.linhas.length * 3.5 + 1.5;
  }

  let yd = yCorpo + PAD;
  for (const [rot, val] of direita) {
    d.setFont("helvetica", "bold");
    d.setFontSize(8);
    d.setTextColor(30);
    d.text(rot, xDir + LARG_DIR - PAD, yd + 2.8, { align: "right" });
    d.setFont("helvetica", "normal");
    d.setTextColor(45);
    d.text((d.splitTextToSize(val, LARG_DIR - PAD * 2) as string[])[0] ?? "", xDir + LARG_DIR - PAD, yd + 6.6, { align: "right" });
    yd += 8.5;
  }
  y += alturaCorpo;

  /* Observações + tempo acumulado. */
  d.rect(PAG.m, y, LARGURA - LARG_DIR, alturaObs);
  d.rect(xDir, y, LARG_DIR, alturaObs);
  d.setFont("helvetica", "bold");
  d.setFontSize(8);
  d.setTextColor(30);
  d.text("Observações:", PAG.m + PAD, y + PAD + 2.8);
  d.setFont("helvetica", "normal");
  d.setTextColor(45);
  if (linhasObs.length) d.text(linhasObs, PAG.m + PAD + 24, y + PAD + 2.8);
  d.setFont("helvetica", "bold");
  d.setTextColor(30);
  d.text("TA:", xDir + PAD, y + PAD + 2.8);
  d.setFont("helvetica", "normal");
  d.text(`${acumulado}'`, xDir + PAD + 7, y + PAD + 2.8);
  y += alturaObs;

  d.setTextColor(0);
  return y + 5;
}

/** Uma caixa com rótulo e texto corrido — as notas de depois do treino. */
function caixaDeTexto(d: Doc, y: number, rotulo: string, texto: string): number {
  const PAD = 2.2;
  d.setFontSize(8);
  const linhas = d.splitTextToSize(texto, LARGURA - PAD * 2) as string[];
  const h = 4.5 + linhas.length * 3.5 + PAD * 2;
  if (PAG.h - PAG.m - y < h) {
    d.addPage();
    y = PAG.m;
  }
  d.setDrawColor(MOLDURA.cor);
  d.setLineWidth(MOLDURA.grossura);
  d.rect(PAG.m, y, LARGURA, h);
  d.setFont("helvetica", "bold");
  d.setTextColor(30);
  d.text(`${rotulo}:`, PAG.m + PAD, y + PAD + 2.8);
  d.setFont("helvetica", "normal");
  d.setTextColor(45);
  d.text(linhas, PAG.m + PAD, y + PAD + 2.8 + 4.5);
  d.setTextColor(0);
  return y + h + 5;
}

/**
 * A imagem de um exercício para o painel: o primeiro frame do desenho ou, sem
 * desenho, a primeira fotografia. Nula quando não há nenhum dos dois — o painel
 * dá o espaço à descrição.
 */
async function imagemDoExercicio(ex: ExercicioImprimivel, largura: number): Promise<Bloco["imagem"]> {
  const diag = asDiagram(ex.diagram);
  if (diag && diag.frames.length > 0) {
    const v = baseView(diag.field);
    const ratio = v.w / v.h;
    const w = largura - 4.4;
    const h = w / ratio;
    return { dados: await svgParaPng(svgDoFrame(ex.diagram, 0, ratio), w, h), formato: "PNG", w, h };
  }
  const foto = ex.images?.[0]?.url;
  if (foto) {
    const e = await carregarEmblema(foto);
    if (e) {
      const w = largura - 4.4;
      const h = Math.min(w * (e.altura / e.largura), 60);
      return { dados: e.dados, formato: e.formato, w: h * (e.largura / e.altura), h };
    }
  }
  return null;
}
