import { signalOnSurface } from "@academia/ui/tokens";
import { academy } from "@/lib/store";
import { carregarEmblema } from "@/lib/callup-sheet";
import { longDate, time } from "@/lib/format";
import { loadLabel, sessionLoad, type PlanBlock, type PlanSummary } from "@/lib/training";
import {
  addDays,
  cycleLength,
  daysBetween,
  daysIn,
  dayKey,
  defaultColor,
  matchDayLabel,
  mesoOf,
  microLabel,
  monthShort,
  rangeLabel,
  type Cycle,
} from "@/lib/cycles";

/**
 * A periodização em papel: o macrociclo, um mesociclo ou um microciclo.
 *
 * Três níveis, e é o nível que decide o que interessa ler:
 *
 *  - **a época** (o macrociclo): a barra da época desenhada, os mesociclos e
 *    todos os microciclos numa tabela. É a folha que se leva à reunião de coordenação;
 *  - **um mesociclo**: o objetivo e o foco dele, os números do bloco (treinos,
 *    volume, carga média), cada semana, e depois cada treino com data, dia em
 *    relação ao jogo, local, objetivo, blocos e carga. A folha do treinador
 *    para o mês que aí vem;
 *  - **uma semana** (o microciclo): os sete dias lado a lado, com o dia em
 *    relação ao jogo, os jogos, os treinos e os blocos de cada treino. A folha
 *    que fica afixada no balneário.
 *
 * Horizontal (A4 deitado): uma época e uma semana são coisas largas.
 *
 * Como o PDF do plano de treino, é gerado no browser com `jspdf` carregado só
 * quando se exporta, e com a cor do clube escurecida até se ler no branco
 * (`signalOnSurface`).
 */

export type TreinoParaPapel = {
  id: string;
  start: string;
  end: string;
  venue: string;
};

export type JogoParaPapel = {
  id: string;
  startsAt: string;
  opponent: string;
  isHome: boolean;
};

export type Periodizacao = {
  teamName: string;
  season: string;
  epoca: { from: string; to: string };
  cycles: Cycle[];
  treinos: TreinoParaPapel[];
  jogos: JogoParaPapel[];
  planos: Map<string, PlanSummary>;
  /** Os blocos de cada treino — na folha da semana e na do mesociclo. */
  blocos?: Map<string, PlanBlock[]>;
};

export type Nivel = { tipo: "EPOCA" } | { tipo: "FASE"; meso: Cycle } | { tipo: "MICRO"; micro: Cycle };

/* -------------------------------------------------------------------------- */
/* Medidas e cores                                                             */
/* -------------------------------------------------------------------------- */

const PAG = { w: 297, h: 210, m: 14 };
const LARGURA = PAG.w - PAG.m * 2;
const TOPO = PAG.m + 6;

type Doc = import("jspdf").jsPDF;
type RGB = [number, number, number];

function rgb(hex: string): RGB {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** A cor misturada com branco: `k` 0 é a cor, 1 é branco. As faixas vão claras. */
const clara = (c: RGB, k: number): RGB => c.map((v) => Math.round(v + (255 - v) * k)) as RGB;

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const diaCurto = (k: string) => DIAS[new Date(`${k}T12:00:00Z`).getUTCDay()];
const dataCurta = (k: string) => `${Number(k.slice(8, 10))} ${monthShort(k)}`;
const semanas = (c: Cycle) => Math.max(1, Math.round(cycleLength(c) / 7));

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

  /** O clube à esquerda e o contexto à direita, em todas as páginas: as folhas separam-se. */
  private cabecalho() {
    const d = this.doc;
    d.setFontSize(8.5);
    d.setTextColor(120);
    d.text(academy.shortName || academy.name || "Academia", PAG.m, PAG.m - 4);
    d.text(this.direita, PAG.w - PAG.m, PAG.m - 4, { align: "right" });
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

  titulo(texto: string, sub?: string) {
    const d = this.doc;
    d.setFont("helvetica", "bold");
    d.setFontSize(18);
    d.setTextColor(25);
    d.text(texto, PAG.m, this.y + 5);
    this.y += 9;
    d.setFont("helvetica", "normal");
    if (sub) {
      d.setFontSize(10);
      d.setTextColor(110);
      d.text(sub, PAG.m, this.y + 2);
      this.y += 6;
    }
    d.setTextColor(0);
  }

  seccao(texto: string) {
    this.garante(16);
    const d = this.doc;
    this.y += 4;
    d.setFont("helvetica", "bold");
    d.setFontSize(9.5);
    d.setTextColor(...this.cor);
    d.text(texto.toUpperCase(), PAG.m, this.y);
    d.setDrawColor(225);
    d.setLineWidth(0.3);
    d.line(PAG.m, this.y + 1.6, PAG.w - PAG.m, this.y + 1.6);
    d.setFont("helvetica", "normal");
    d.setTextColor(0);
    this.y += 5;
  }

  /** Pares rótulo e valor, lado a lado, só os que têm valor. */
  factos(pares: [string, string | null | undefined][]) {
    const cheios = pares.filter((p): p is [string, string] => Boolean(p[1]?.trim()));
    if (cheios.length === 0) return;
    const d = this.doc;
    const colW = LARGURA / Math.min(cheios.length, 3);
    for (let i = 0; i < cheios.length; i += 3) {
      const linha = cheios.slice(i, i + 3);
      const alturas = linha.map(([, v]) => (d.splitTextToSize(v, colW - 6) as string[]).length);
      const alto = 5 + Math.max(...alturas) * 4.4;
      this.garante(alto + 2);
      linha.forEach(([r, v], col) => {
        const x = PAG.m + col * colW;
        d.setFontSize(7.5);
        d.setTextColor(140);
        d.text(r.toUpperCase(), x, this.y + 3);
        d.setFontSize(10);
        d.setTextColor(30);
        d.text(d.splitTextToSize(v, colW - 6) as string[], x, this.y + 7.6);
      });
      this.y += alto + 2;
    }
    d.setTextColor(0);
  }

  /**
   * Uma tabela que parte páginas e repete o cabeçalho. As larguras são em
   * frações da largura útil; o texto de cada célula quebra dentro dela.
   */
  tabela(colunas: { titulo: string; larg: number }[], linhas: string[][], opcoes: { corDaLinha?: (i: number) => RGB | null } = {}) {
    const d = this.doc;
    const larguras = colunas.map((c) => c.larg * LARGURA);
    const PAD = 1.8;
    const LH = 3.9;

    const cabeca = () => {
      this.garante(10);
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
    linhas.forEach((linha, li) => {
      d.setFontSize(8.8);
      const partes = linha.map((t, i) => d.splitTextToSize(t || "—", larguras[i] - PAD * 2) as string[]);
      const alto = Math.max(...partes.map((p) => p.length)) * LH + PAD * 2;
      if (this.y + alto > PAG.h - PAG.m) {
        this.novaPagina();
        cabeca();
      }
      // A página nova e o cabeçalho da tabela mudaram o tamanho da letra.
      d.setFontSize(8.8);
      const cor = opcoes.corDaLinha?.(li);
      if (cor) {
        d.setFillColor(...cor);
        d.rect(PAG.m, this.y, 1.4, alto, "F");
      }
      let x = PAG.m;
      partes.forEach((p, i) => {
        d.setTextColor(i === 0 ? 25 : 55);
        d.text(p, x + PAD + (i === 0 && cor ? 1.2 : 0), this.y + PAD + 2.9);
        x += larguras[i];
      });
      d.setDrawColor(230);
      d.setLineWidth(0.2);
      d.line(PAG.m, this.y + alto, PAG.w - PAG.m, this.y + alto);
      this.y += alto;
    });
    d.setTextColor(0);
    this.y += 2;
  }

  /** O rodapé com a data e a numeração, escrito no fim sobre todas as páginas. */
  fechar() {
    const d = this.doc;
    const total = d.getNumberOfPages();
    const hoje = longDate(new Date());
    for (let i = 1; i <= total; i += 1) {
      d.setPage(i);
      d.setFontSize(7.5);
      d.setTextColor(150);
      d.text(`Gerado a ${hoje}`, PAG.m, PAG.h - 6);
      d.text(`${i}/${total}`, PAG.w - PAG.m, PAG.h - 6, { align: "right" });
    }
  }
}

/* -------------------------------------------------------------------------- */
/* As contas de cada semana                                                    */
/* -------------------------------------------------------------------------- */

function treinosDe(p: Periodizacao, from: string, to: string) {
  return p.treinos
    .filter((t) => {
      const k = dayKey(new Date(t.start));
      return k >= from && k <= to;
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

function jogosDe(p: Periodizacao, from: string, to: string) {
  return p.jogos
    .filter((j) => {
      const k = dayKey(new Date(j.startsAt));
      return k >= from && k <= to;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

const jogoCurto = (j: JogoParaPapel) => `${diaCurto(dayKey(new Date(j.startsAt)))} ${j.isHome ? "vs" : "@"} ${j.opponent}`;

function volume(p: Periodizacao, ids: string[]) {
  let min = 0;
  for (const id of ids) min += (p.planos.get(id)?.blocks ?? []).reduce((a, b) => a + b.durationMin, 0);
  return min;
}

/* -------------------------------------------------------------------------- */
/* A barra da época, desenhada                                                 */
/* -------------------------------------------------------------------------- */

function barraDaEpoca(f: Folha, p: Periodizacao, destaque?: Cycle) {
  const d = f.doc;
  const { from, to } = p.epoca;
  const total = daysBetween(from, to) + 1;
  const x = (k: string) => PAG.m + (Math.min(Math.max(daysBetween(from, k), 0), total) / total) * LARGURA;
  const larg = (a: string, b: string) => ((daysBetween(a < from ? from : a, b > to ? to : b) + 1) / total) * LARGURA;
  f.garante(34);
  const y0 = f.y;

  // Os meses
  d.setFontSize(7);
  d.setTextColor(140);
  let k = `${from.slice(0, 7)}-01`;
  if (k < from) k = addDays(k, 32).slice(0, 7) + "-01";
  while (k <= to) {
    d.setDrawColor(225);
    d.setLineWidth(0.2);
    d.line(x(k), y0, x(k), y0 + 26);
    d.text(monthShort(k).toUpperCase(), x(k) + 1, y0 + 3);
    k = addDays(k, 32).slice(0, 7) + "-01";
  }

  // As fases
  const mesos = p.cycles.filter((c) => c.level === "MESO" && c.endsOn >= from && c.startsOn <= to);
  mesos.forEach((m, i) => {
    const cor = rgb(m.color ?? defaultColor(m.phase, i));
    const apagada = destaque && destaque.id !== m.id;
    d.setFillColor(...clara(cor, apagada ? 0.88 : 0.72));
    d.rect(x(m.startsOn), y0 + 5, larg(m.startsOn, m.endsOn), 8, "F");
    d.setFillColor(...cor);
    d.rect(x(m.startsOn), y0 + 5, 1.1, 8, "F");
    d.setFont("helvetica", "bold");
    d.setFontSize(7.5);
    d.setTextColor(apagada ? 150 : 30);
    const nome = (d.splitTextToSize(m.name ?? m.phase ?? "Mesociclo", Math.max(4, larg(m.startsOn, m.endsOn) - 3)) as string[])[0];
    d.text(nome, x(m.startsOn) + 2.2, y0 + 10.2);
    d.setFont("helvetica", "normal");
  });

  // As semanas
  p.cycles
    .filter((c) => c.level === "MICRO" && c.endsOn >= from && c.startsOn <= to)
    .forEach((m) => {
      const dentro = !destaque || (destaque.level === "MESO" ? mesoOf(p.cycles, m)?.id === destaque.id : destaque.id === m.id);
      const tom = m.objective || m.focus.length ? 150 : 205;
      d.setFillColor(...((dentro ? [tom, tom, tom] : [232, 232, 232]) as RGB));
      d.rect(x(m.startsOn) + 0.25, y0 + 15, Math.max(0.5, larg(m.startsOn, m.endsOn) - 0.5), 4.5, "F");
    });

  // Os jogos
  d.setFillColor(...f.cor);
  for (const j of p.jogos) {
    const k2 = dayKey(new Date(j.startsAt));
    if (k2 < from || k2 > to) continue;
    d.circle(x(k2) + LARGURA / total / 2, y0 + 23, 0.9, "F");
  }
  d.setTextColor(0);
  f.y = y0 + 29;
}

/* -------------------------------------------------------------------------- */
/* Os três níveis                                                              */
/* -------------------------------------------------------------------------- */

function folhaDaEpoca(f: Folha, p: Periodizacao) {
  const mesos = p.cycles.filter((c) => c.level === "MESO").sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const micros = p.cycles.filter((c) => c.level === "MICRO").sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  f.titulo("Periodização da época", `${p.teamName} · Época ${p.season} · ${rangeLabel(p.epoca.from, p.epoca.to)}`);
  barraDaEpoca(f, p);

  f.seccao("Mesociclos");
  if (mesos.length === 0) f.factos([["Mesociclos", "A época ainda não está dividida em mesociclos."]]);
  else
    f.tabela(
      [
        { titulo: "Mesociclo", larg: 0.17 },
        { titulo: "Datas", larg: 0.14 },
        { titulo: "Semanas", larg: 0.08 },
        { titulo: "Objetivo", larg: 0.36 },
        { titulo: "Foco", larg: 0.25 },
      ],
      mesos.map((m) => [
        m.name ?? m.phase ?? "Mesociclo",
        rangeLabel(m.startsOn, m.endsOn),
        String(micros.filter((x) => mesoOf(p.cycles, x)?.id === m.id).length || semanas(m)),
        m.objective ?? "",
        m.focus.join(", "),
      ]),
      { corDaLinha: (i) => rgb(mesos[i].color ?? defaultColor(mesos[i].phase, i)) },
    );

  f.seccao("Microciclos");
  if (micros.length === 0) f.factos([["Microciclos", "Ainda não há microciclos nesta época."]]);
  else
    f.tabela(
      [
        { titulo: "Micro", larg: 0.08 },
        { titulo: "Datas", larg: 0.11 },
        { titulo: "Mesociclo", larg: 0.13 },
        { titulo: "Objetivo", larg: 0.3 },
        { titulo: "Foco", larg: 0.17 },
        { titulo: "Treinos", larg: 0.08 },
        { titulo: "Jogos", larg: 0.13 },
      ],
      micros.map((m) => {
        const ts = treinosDe(p, m.startsOn, m.endsOn);
        const min = volume(p, ts.map((t) => t.id));
        return [
          microLabel(p.cycles, m).replace("Micro ", ""),
          rangeLabel(m.startsOn, m.endsOn),
          mesoOf(p.cycles, m)?.name ?? "",
          m.objective ?? "",
          m.focus.join(", "),
          ts.length ? `${ts.length}${min ? ` · ${min}'` : ""}` : "",
          jogosDe(p, m.startsOn, m.endsOn).map(jogoCurto).join("\n"),
        ];
      }),
    );
}

function folhaDaFase(f: Folha, p: Periodizacao, meso: Cycle) {
  const micros = p.cycles
    .filter((c) => c.level === "MICRO" && mesoOf(p.cycles, c)?.id === meso.id)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));

  f.titulo(meso.name ?? meso.phase ?? "Mesociclo", `${p.teamName} · ${rangeLabel(meso.startsOn, meso.endsOn)} · ${micros.length || semanas(meso)} microciclos`);
  f.factos([
    ["Objetivo", meso.objective],
    ["Foco", meso.focus.join(", ")],
    ["Notas", meso.notes],
  ]);
  barraDaEpoca(f, p, meso);

  /*
   * O que o mesociclo é, em números, antes de se ler semana a semana: quantos
   * treinos, quanto tempo, que carga média, e quantos jogos lá dentro.
   */
  const todos = treinosDe(p, meso.startsOn, meso.endsOn);
  const comPlano = todos.filter((t) => p.planos.get(t.id));
  const cargas = comPlano.map((t) => sessionLoad(p.planos.get(t.id)!.blocks, p.planos.get(t.id)!.intensity));
  const media = cargas.length ? Math.round(cargas.reduce((a, c) => a + c.score, 0) / cargas.length) : null;
  f.factos([
    ["Treinos", `${todos.length}${comPlano.length !== todos.length ? ` (${comPlano.length} com plano)` : ""}`],
    ["Volume planeado", `${volume(p, todos.map((t) => t.id))} min`],
    ["Carga média", media === null ? "—" : `${media}/100 · ${loadLabel(media).label.toLowerCase()}`],
    ["Jogos", String(jogosDe(p, meso.startsOn, meso.endsOn).length)],
  ]);

  f.seccao("Os microciclos deste mesociclo");
  if (micros.length === 0) {
    f.factos([["Microciclos", "Este mesociclo ainda não tem microciclos."]]);
    return;
  }
  f.tabela(
    [
      { titulo: "Micro", larg: 0.07 },
      { titulo: "Datas", larg: 0.12 },
      { titulo: "Objetivo e foco", larg: 0.37 },
      { titulo: "Treinos", larg: 0.2 },
      { titulo: "Jogos", larg: 0.24 },
    ],
    micros.map((m) => {
      const ts = treinosDe(p, m.startsOn, m.endsOn);
      const min = volume(p, ts.map((t) => t.id));
      const cs = ts.filter((t) => p.planos.get(t.id)).map((t) => sessionLoad(p.planos.get(t.id)!.blocks, p.planos.get(t.id)!.intensity));
      const m2 = cs.length ? Math.round(cs.reduce((a, c) => a + c.score, 0) / cs.length) : null;
      return [
        microLabel(p.cycles, m).replace("Micro ", ""),
        rangeLabel(m.startsOn, m.endsOn),
        [m.objective, m.focus.length ? `Foco: ${m.focus.join(", ")}` : null].filter(Boolean).join("\n"),
        ts.length
          ? `${ts.length} ${ts.length === 1 ? "treino" : "treinos"} · ${min}'${m2 === null ? "" : `\ncarga ${loadLabel(m2).label.toLowerCase()} (${m2}/100)`}`
          : "",
        jogosDe(p, m.startsOn, m.endsOn).map(jogoCurto).join("\n"),
      ];
    }),
  );

  /*
   * E depois cada treino, um a um.
   *
   * A queixa era esta: o mesociclo saía com os treinos resumidos a "Sáb 18:00"
   * dentro da célula da semana, e quem lê a folha quer saber de cada treino o
   * dia, o que se vai treinar, quanto tempo e com que carga. O dia em relação
   * ao jogo (MD-n) vem do calendário de jogos, como na folha da semana.
   */
  f.seccao("Os treinos, um a um");
  if (todos.length === 0) {
    f.factos([["Treinos", "Ainda não há treinos marcados neste mesociclo."]]);
    return;
  }
  const diasDeJogo = [...new Set(p.jogos.map((j) => dayKey(new Date(j.startsAt))))];
  f.tabela(
    [
      { titulo: "Data", larg: 0.13 },
      { titulo: "MD", larg: 0.05 },
      { titulo: "Micro", larg: 0.06 },
      { titulo: "Local", larg: 0.11 },
      { titulo: "Objetivo principal", larg: 0.18 },
      /* "Pré-competitivo" é a palavra mais larga daqui: a coluna é dela. */
      { titulo: "Tipo", larg: 0.12 },
      { titulo: "Blocos", larg: 0.19 },
      { titulo: "Carga", larg: 0.15 },
    ],
    todos.map((t) => {
      const k = dayKey(new Date(t.start));
      const plano = p.planos.get(t.id);
      const c = plano ? sessionLoad(plano.blocks, plano.intensity) : null;
      const micro = micros.find((m) => k >= m.startsOn && k <= m.endsOn);
      const blocos = p.blocos?.get(t.id) ?? [];
      return [
        `${diaCurto(k)} ${dataCurta(k)} · ${time(new Date(t.start))}`,
        matchDayLabel(k, diasDeJogo) ?? "",
        micro ? microLabel(p.cycles, micro).replace("Micro ", "") : "",
        t.venue,
        plano?.objective ?? (plano ? "" : "por planear"),
        plano?.sessionType ?? "",
        blocos.length
          ? blocos.map((b) => `${b.name} ${b.durationMin}'`).join(" · ")
          : plano
            ? `${plano.blockCount} ${plano.blockCount === 1 ? "bloco" : "blocos"}`
            : "",
        c ? `${c.volume}' · ${c.label.toLowerCase()} (${c.score}/100)` : "",
      ];
    }),
  );
}

function folhaDaSemana(f: Folha, p: Periodizacao, micro: Cycle) {
  const d = f.doc;
  const meso = mesoOf(p.cycles, micro);
  const dias = daysIn(micro.startsOn, micro.endsOn);
  const diasDeJogo = [...new Set(p.jogos.map((j) => dayKey(new Date(j.startsAt))))];
  const ts = treinosDe(p, micro.startsOn, micro.endsOn);

  f.titulo(`${microLabel(p.cycles, micro)} · ${rangeLabel(micro.startsOn, micro.endsOn)}`, [p.teamName, meso?.name].filter(Boolean).join(" · "));
  f.factos([
    ["Objetivo", micro.objective],
    ["Foco", micro.focus.join(", ")],
    ["Notas", micro.notes],
  ]);

  // Os totais da semana, somados dos planos
  const planeados = ts.filter((t) => p.planos.get(t.id));
  const cargas = planeados.map((t) => sessionLoad(p.planos.get(t.id)!.blocks, p.planos.get(t.id)!.intensity));
  const media = cargas.length ? Math.round(cargas.reduce((a, c) => a + c.score, 0) / cargas.length) : null;
  f.factos([
    ["Treinos", `${ts.length}${planeados.length !== ts.length ? ` (${planeados.length} com plano)` : ""}`],
    ["Volume planeado", `${volume(p, ts.map((t) => t.id))} min`],
    ["Carga média", media === null ? "—" : `${media}/100`],
  ]);

  // Os sete dias, lado a lado
  const colW = LARGURA / dias.length;
  f.garante(40);
  const y0 = f.y + 2;
  const alturaCab = 9;

  // Primeiro o conteúdo, para saber a altura
  const conteudo = dias.map((k) => {
    const linhas: { texto: string; forte?: boolean; cor?: RGB }[] = [];
    for (const j of jogosDe(p, k, k)) linhas.push({ texto: `Jogo ${time(new Date(j.startsAt))} ${j.isHome ? "vs" : "@"} ${j.opponent}`, forte: true, cor: f.cor });
    for (const t of treinosDe(p, k, k)) {
      const plano = p.planos.get(t.id);
      linhas.push({ texto: `${time(new Date(t.start))} · ${plano?.objective ?? "Treino"}`, forte: true });
      const blocos = p.blocos?.get(t.id) ?? [];
      if (blocos.length) for (const b of blocos) linhas.push({ texto: `${b.name} ${b.durationMin}'` });
      else if (!plano) linhas.push({ texto: "por planear" });
      if (plano?.blocks.length) {
        const c = sessionLoad(plano.blocks, plano.intensity);
        linhas.push({ texto: `${c.volume}' · carga ${c.label.toLowerCase()}` });
      }
      linhas.push({ texto: "" });
    }
    if (linhas.length === 0) linhas.push({ texto: "Descanso" });
    return linhas.map((l) => ({ ...l, partes: (d.setFontSize(8), d.splitTextToSize(l.texto, colW - 4) as string[]) }));
  });
  const altura = Math.max(
    40,
    ...conteudo.map((ls) => alturaCab + 3 + ls.reduce((a, l) => a + Math.max(1, l.partes.length) * 3.7, 0)),
  );
  if (y0 + altura > PAG.h - PAG.m) f.novaPagina();
  const yy = f.y + 2;

  dias.forEach((k, i) => {
    const x = PAG.m + i * colW;
    d.setDrawColor(220);
    d.setLineWidth(0.25);
    d.rect(x, yy, colW, altura);
    d.setFillColor(245, 244, 241);
    d.rect(x, yy, colW, alturaCab, "F");
    d.setFont("helvetica", "bold");
    d.setFontSize(8.5);
    d.setTextColor(40);
    d.text(`${diaCurto(k)} ${dataCurta(k)}`, x + 2, yy + 5.8);
    const md = matchDayLabel(k, diasDeJogo);
    if (md) {
      d.setTextColor(...(md === "MD" ? f.cor : ([120, 120, 120] as RGB)));
      d.text(md === "MD" ? "Jogo" : md, x + colW - 2, yy + 5.8, { align: "right" });
    }
    d.setFont("helvetica", "normal");
    let y = yy + alturaCab + 4;
    for (const l of conteudo[i]) {
      d.setFont("helvetica", l.forte ? "bold" : "normal");
      d.setFontSize(8);
      d.setTextColor(...(l.cor ?? ((l.texto === "Descanso" || l.texto === "por planear" ? [150, 150, 150] : [45, 45, 45]) as RGB)));
      if (l.partes.length) d.text(l.partes, x + 2, y);
      y += Math.max(1, l.partes.length) * 3.7;
    }
    d.setFont("helvetica", "normal");
  });
  d.setTextColor(0);
  f.y = yy + altura + 4;
}

/* -------------------------------------------------------------------------- */

export async function exportarPeriodizacao(p: Periodizacao, nivel: Nivel): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const f = new Folha(doc, `${p.teamName} · Época ${p.season}`);

  // O emblema ao lado do título da primeira página, quando o há.
  const emblema = await carregarEmblema(academy.logoUrl ?? "");
  if (emblema) {
    const lado = 12;
    const k = Math.min(lado / emblema.largura, lado / emblema.altura);
    // Comprimido: sem isto o emblema sozinho fazia o PDF pesar um megabyte.
    doc.addImage(emblema.dados, emblema.formato, PAG.w - PAG.m - emblema.largura * k, TOPO, emblema.largura * k, emblema.altura * k, undefined, "FAST");
  }

  if (nivel.tipo === "EPOCA") folhaDaEpoca(f, p);
  else if (nivel.tipo === "FASE") folhaDaFase(f, p, nivel.meso);
  else folhaDaSemana(f, p, nivel.micro);

  f.fechar();
  const titulo =
    nivel.tipo === "EPOCA" ? `epoca-${p.season}` : nivel.tipo === "FASE" ? `mesociclo-${nivel.meso.name ?? nivel.meso.startsOn}` : `microciclo-${nivel.micro.startsOn}`;
  doc.save(nomeDoFicheiro(`periodizacao_${p.teamName}`, titulo));
}

/** `Sub-11 Futebol` + `época 2026/27` → `life-club_periodizacao_sub-11-futebol_epoca-2026-27.pdf` */
function nomeDoFicheiro(tipo: string, titulo: string): string {
  const limpa = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  const clube = limpa(academy.slug || academy.shortName || "academia");
  return `${clube}_${limpa(tipo)}_${limpa(titulo) || "sem-nome"}.pdf`;
}
