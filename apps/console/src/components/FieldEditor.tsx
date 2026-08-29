import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARROW_LABEL,
  FORMAT_LABEL,
  FORMAT_PITCH,
  GAME_FORMATS,
  ITEM_LABEL,
  asDiagram,
  emptyDiagram,
  fieldFor,
  fieldSize,
  formatOf,
  isIndoorField,
  isHalfField,
  newId,
  type ArrowKind,
  type Diagram,
  type GameFormat,
  type PitchSpec,
  type DiagramArrow,
  type DiagramFrame,
  type DiagramItem,
  type FieldKind,
  type ItemKind,
} from "@/lib/training";
import { ChevronLeft, ChevronRight, Copy, Hand, Minus, Plus, RefreshCw, RotateCcw, RotateCw, Trash2 } from "@/lib/icons";
import { cx } from "@/components/primitives";

/**
 * O quadro tático.
 *
 * Três caras do mesmo desenho:
 *
 *  - `FieldView` — um frame, parado. É o que os cartões da biblioteca mostram.
 *  - `DiagramPlayer` — a animação: os frames encadeados, com as posições a
 *    deslizar de um para o seguinte. É a demonstração do exercício.
 *  - `FieldEditor` — o editor: paleta, arrastar, setas, frames, undo.
 *
 * ## As coordenadas são metros de campo
 *
 * 0–105 × 0–68, as medidas reais de um campo de onze. Não são pixels nem
 * percentagens: "um corredor de 12 metros" desenha-se com 12, e o desenho não
 * muda de proporções quando o ecrã muda. O SVG trata da projeção sozinho.
 *
 * ## Porque é que isto é SVG e não canvas
 *
 * O desenho é um documento pequeno — dezenas de elementos, não milhares — e em
 * SVG cada jogador é um nó com eventos próprios: seleção, arrasto e toque vêm
 * de graça, no tablet incluído (pointer events). Um canvas obrigava a fazer
 * hit-testing à mão para ganhar um desempenho de que isto não precisa.
 */

/* -------------------------------------------------------------------------- */
/* Cores e medidas                                                             */
/* -------------------------------------------------------------------------- */

/*
 * Paleta fixa, não a do clube: num quadro tático a cor distingue *quem é quem*
 * (nós, eles, guarda-redes), e a cor do clube podia calhar igual à relva. O
 * verde é deliberadamente dessaturado — olha-se para isto minutos seguidos.
 */
const PITCH = "#527a5e";
/*
 * O pavilhão é de madeira, não de relva. A cor não é decoração: é o que faz um
 * treinador perceber num relance, num cartão pequeno da biblioteca, se está a
 * olhar para um exercício de campo ou de pavilhão.
 */
const FUTSAL_FLOOR = "#a87d4f";
const FUTSAL_LINES = "rgba(255,255,255,0.85)";
const LINES = "rgba(255,255,255,0.75)";
const US = "#1d3a5f";
const THEM = "#f4f1ea";
const THEM_INK = "#3d3a34";
const GK = "#b97324";
const CONE = "#e0862e";
const ZONE = "rgba(255, 214, 90, 0.18)";
const ZONE_LINE = "rgba(255, 214, 90, 0.9)";

/**
 * A vista de um terreno, derivada das medidas dele.
 *
 * A margem é proporcional (3 m no campo de onze) — uma margem fixa de 3 m
 * sufocaria um campo de futsal e desapareceria num de onze.
 *
 * ## Porque é que o meio campo abre para lá da linha
 *
 * Leva o círculo central **inteiro**. Duas tentativas antes desta partiram de
 * um lado cada uma: a começar 3 m antes da linha, o semicírculo flutuava em
 * relva sem linha nenhuma; a começar na linha, via-se meio círculo cortado e
 * faltava-lhe o resto. A vista abre até ao bordo do círculo, que assim aparece
 * completo e encostado à esquerda — e o espaço que ele ocupa é útil, porque é
 * de lá que nasce a transição que acaba na baliza da direita.
 */
export function baseView(field: FieldKind) {
  const s = FORMAT_PITCH[formatOf(field)];
  const m = Math.max(1.2, s.w * 0.0286);
  if (!isHalfField(field)) return { x: -m, y: -m, w: s.w + 2 * m, h: s.h + 2 * m };
  const x = s.w / 2 - s.circle - m;
  return { x, y: -m, w: s.w + m - x, h: s.h + 2 * m };
}

/**
 * A escala dos símbolos por terreno.
 *
 * As coordenadas são metros, e os campos vão de 40×20 (futsal) a 105×68: um
 * círculo de 1,9 m que fica bem no campo de onze tapa meia área num campo de
 * futebol 5. Os símbolos encolhem com o campo — as **posições** continuam em
 * metros verdadeiros, e as zonas mantêm as medidas reais.
 *
 * O piso de 0,45 existe porque abaixo dele um número dentro de um círculo
 * deixa de se ler, e um quadro tático que não se lê não serve para nada.
 */
export function itemScale(field: FieldKind): number {
  return Math.max(0.45, fieldSize(field).w / 105);
}

/** A cor do piso — relva ou madeira. É o que preenche as barras de uma moldura
 *  de proporção fixa, para nenhuma miniatura ter cantos brancos. */
export function pitchBackground(field: FieldKind): string {
  return isIndoorField(field) ? FUTSAL_FLOOR : PITCH;
}

/**
 * A proporção das miniaturas da biblioteca.
 *
 * 4:3 é o compromisso entre os terrenos todos — um campo inteiro (1,5) perde
 * pouco em cima e em baixo, um meio campo (0,77) fica centrado com relva dos
 * lados, e nenhuma linha da grelha se estica pelo cartão mais alto.
 */
export const THUMB_RATIO = 4 / 3;

/* -------------------------------------------------------------------------- */
/* O campo                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * As marcações do terreno, desenhadas a partir das medidas da variante.
 *
 * Era um componente por modalidade, com as medidas do campo de onze e as do
 * futsal escritas à mão. Com cinco variantes isso seriam cinco cópias do mesmo
 * desenho a divergir umas das outras — por isso as marcações passaram a ser
 * **derivadas** de `FORMAT_PITCH`: quem acrescentar uma variante nova escreve
 * as medidas e não toca aqui.
 *
 * Exportado para os quadros que não são o editor — o sistema do modelo de jogo.
 */
export function Pitch({ field }: { field: FieldKind }) {
  const format = formatOf(field);
  const s = FORMAT_PITCH[format];
  const half = isHalfField(field);
  const v = baseView(field);
  const ink = s.indoor ? FUTSAL_LINES : LINES;
  // A espessura da linha acompanha o campo: 0,35 m num campo de 105 é a linha
  // real; a mesma medida num de 40 seria uma faixa pintada.
  const lw = Math.max(0.12, 0.35 * (s.w / 105));
  const l = { stroke: ink, strokeWidth: lw, fill: "none" } as const;
  const mid = s.w / 2;
  const cy = s.h / 2;
  const dot = lw * 1.4;
  /** O raio dos cantos, proporcional (1 m no campo de onze). */
  const corner = Math.max(0.4, s.w / 105);

  /** Uma área, à esquerda (`dir` −1) ou à direita (+1). */
  const boxAt = (dir: 1 | -1) => {
    const x0 = dir === 1 ? s.w : 0;
    return (
      <g>
        {s.box && (
          <rect
            x={dir === 1 ? x0 - s.box.depth : 0}
            y={cy - s.box.width / 2}
            width={s.box.depth}
            height={s.box.width}
            {...l}
          />
        )}
        {s.goalArea && (
          <rect
            x={dir === 1 ? x0 - s.goalArea.depth : 0}
            y={cy - s.goalArea.width / 2}
            width={s.goalArea.depth}
            height={s.goalArea.width}
            {...l}
          />
        )}
        {/* O futsal não tem retângulo: tem dois quartos de arco unidos por uma reta. */}
        {s.arc && (
          <path
            d={
              dir === 1
                ? `M ${s.w} ${cy - s.goal / 2 - s.arc} A ${s.arc} ${s.arc} 0 0 0 ${s.w - s.arc} ${cy - s.goal / 2} L ${s.w - s.arc} ${cy + s.goal / 2} A ${s.arc} ${s.arc} 0 0 0 ${s.w} ${cy + s.goal / 2 + s.arc}`
                : `M 0 ${cy - s.goal / 2 - s.arc} A ${s.arc} ${s.arc} 0 0 1 ${s.arc} ${cy - s.goal / 2} L ${s.arc} ${cy + s.goal / 2} A ${s.arc} ${s.arc} 0 0 1 0 ${cy + s.goal / 2 + s.arc}`
            }
            {...l}
          />
        )}
        {/* Marca de penálti, e a segunda marca onde existe (futsal). */}
        <circle cx={dir === 1 ? x0 - s.penalty : s.penalty} cy={cy} r={dot} fill={ink} />
        {s.secondPenalty && (
          <circle cx={dir === 1 ? x0 - s.secondPenalty : s.secondPenalty} cy={cy} r={dot} fill={ink} />
        )}
        {/* O arco da área — só onde a área é retangular e o círculo a ultrapassa. */}
        {s.box && s.circle > s.box.depth - s.penalty && (
          <path
            d={arcOutsideBox(s, dir)}
            {...l}
          />
        )}
        {/* A baliza, para fora da linha de fundo. */}
        <rect
          x={dir === 1 ? s.w : -s.goal * 0.25}
          y={cy - s.goal / 2}
          width={s.goal * 0.25}
          height={s.goal}
          {...l}
        />
      </g>
    );
  };

  return (
    <g>
      {/* O piso cobre a vista inteira, e não só o retângulo de jogo. */}
      <rect x={v.x} y={v.y} width={v.w} height={v.h} fill={s.indoor ? FUTSAL_FLOOR : PITCH} />
      {/* Pavilhão: tábuas ao alto, mal visíveis — chega para dizer "madeira". */}
      {s.indoor &&
        Array.from({ length: Math.ceil(v.w / 2) }, (_, i) => v.x + 2 * (i + 1)).map((x) => (
          <line key={x} x1={x} y1={v.y} x2={x} y2={v.y + v.h} stroke="rgba(0,0,0,0.05)" strokeWidth={lw * 0.6} />
        ))}

      <rect x={0} y={0} width={s.w} height={s.h} {...l} />

      {/* A linha de meio-campo e o círculo — inteiro também na vista de meio
          campo, que abre o suficiente para ele caber (ver `baseView`). */}
      <line x1={mid} y1={0} x2={mid} y2={s.h} {...l} />
      <circle cx={mid} cy={cy} r={s.circle} {...l} />
      <circle cx={mid} cy={cy} r={dot} fill={ink} />

      {/* A metade defensiva só se desenha na vista inteira. */}
      {!half && boxAt(-1)}
      {boxAt(1)}

      {/* Cantos */}
      <path d={`M ${s.w - corner} 0 A ${corner} ${corner} 0 0 0 ${s.w} ${corner}`} {...l} />
      <path d={`M ${s.w} ${s.h - corner} A ${corner} ${corner} 0 0 0 ${s.w - corner} ${s.h}`} {...l} />
      {!half && (
        <>
          <path d={`M 0 ${corner} A ${corner} ${corner} 0 0 0 ${corner} 0`} {...l} />
          <path d={`M ${corner} ${s.h} A ${corner} ${corner} 0 0 0 0 ${s.h - corner}`} {...l} />
        </>
      )}
    </g>
  );
}

/**
 * O arco à boca da área — a parte do círculo de penálti que fica de fora.
 *
 * Só existe quando o círculo centrado na marca ultrapassa a linha da área; num
 * campo de futebol 5, onde a área é curta e a marca está quase em cima dela,
 * não há arco nenhum a desenhar.
 */
function arcOutsideBox(s: PitchSpec, dir: 1 | -1): string {
  const box = s.box!;
  const cy = s.h / 2;
  const px = dir === 1 ? s.w - s.penalty : s.penalty;
  const bx = dir === 1 ? s.w - box.depth : box.depth;
  // Meia-corda do círculo à altura da linha da área.
  const dx = Math.abs(px - bx);
  const dy = Math.sqrt(Math.max(0, s.circle * s.circle - dx * dx));
  const sweep = dir === 1 ? 0 : 1;
  return `M ${bx} ${cy - dy} A ${s.circle} ${s.circle} 0 0 ${sweep} ${bx} ${cy + dy}`;
}

/* -------------------------------------------------------------------------- */
/* Elementos                                                                   */
/* -------------------------------------------------------------------------- */

function ItemShape({ item, selected, k = 1 }: { item: DiagramItem; selected?: boolean; k?: number }) {
  const label = item.label ?? "";

  switch (item.kind) {
    case "player":
    case "playerBall":
    case "gk":
    case "opponent": {
      const fill = item.kind === "gk" ? GK : item.kind === "opponent" ? THEM : US;
      const ink = item.kind === "opponent" ? THEM_INK : "#fff";
      return (
        // O `scale(k)` encolhe o símbolo no futsal; a **posição** fica em metros
        // verdadeiros, e as zonas (abaixo) mantêm as dimensões reais.
        <g transform={`scale(${k})`}>
          <circle r={1.9} fill={fill} stroke={selected ? "#ffd65a" : "rgba(255,255,255,0.85)"} strokeWidth={selected ? 0.45 : 0.25} />
          {label && (
            <text y={0.75} textAnchor="middle" fontSize={2.1} fontWeight={700} fill={ink} style={{ userSelect: "none" }}>
              {label}
            </text>
          )}
          {item.kind === "playerBall" && <circle cx={1.9} cy={1.6} r={0.8} fill="#fff" stroke="#1f2937" strokeWidth={0.18} />}
        </g>
      );
    }
    case "ball":
      return <circle r={0.9 * k} fill="#fff" stroke={selected ? "#ffd65a" : "#1f2937"} strokeWidth={(selected ? 0.4 : 0.2) * k} />;
    case "cone":
      return (
        <g transform={`scale(${k})`}>
          <path d="M 0 -1.3 L 1.2 1.1 L -1.2 1.1 Z" fill={CONE} stroke={selected ? "#ffd65a" : "rgba(0,0,0,0.25)"} strokeWidth={selected ? 0.4 : 0.15} />
        </g>
      );
    case "pole":
      return (
        <g transform={`scale(${k})`}>
          <line x1={0} y1={-1.6} x2={0} y2={1.6} stroke="#f3d34f" strokeWidth={0.55} />
          <circle cy={-1.6} r={0.45} fill="#f3d34f" {...(selected ? { stroke: "#ffd65a", strokeWidth: 0.45 } : {})} />
        </g>
      );
    case "barrier":
      return (
        <g transform={`scale(${k})`}>
          <rect x={-2.2} y={-0.5} width={4.4} height={1} rx={0.2} fill="#e8e4dc" stroke={selected ? "#ffd65a" : "#8b867c"} strokeWidth={selected ? 0.4 : 0.2} />
        </g>
      );
    case "goal":
      return (
        <g transform={`scale(${k})`}>
          <path d="M -3.66 -1.6 L -3.66 0 L 3.66 0 L 3.66 -1.6" fill="none" stroke={selected ? "#ffd65a" : "#fff"} strokeWidth={0.55} />
        </g>
      );
    case "miniGoal":
      return (
        <g transform={`scale(${k})`}>
          <path d="M -1.5 -1 L -1.5 0 L 1.5 0 L 1.5 -1" fill="none" stroke={selected ? "#ffd65a" : "#fff"} strokeWidth={0.45} />
        </g>
      );
    case "ladder":
      return (
        <g transform={`scale(${k})`} stroke={selected ? "#ffd65a" : "#f3d34f"} strokeWidth={0.22} fill="none">
          <rect x={-0.9} y={-2.4} width={1.8} height={4.8} />
          {[-1.6, -0.8, 0, 0.8, 1.6].map((y) => (
            <line key={y} x1={-0.9} y1={y} x2={0.9} y2={y} />
          ))}
        </g>
      );
    case "dummy":
      return (
        <g transform={`scale(${k})`} fill="#8f9aa8" stroke={selected ? "#ffd65a" : "rgba(0,0,0,0.3)"} strokeWidth={selected ? 0.4 : 0.15}>
          <circle cy={-1.5} r={0.7} />
          <rect x={-0.9} y={-0.8} width={1.8} height={2.6} rx={0.5} />
        </g>
      );
    case "zone": {
      // A zona é espaço a sério — "um corredor de 12 metros" mede 12 no futsal
      // como no futebol. Só a moldura e a letra acompanham a escala.
      const w = item.w ?? 12;
      const h = item.h ?? 10;
      return (
        <g>
          <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={0.4 * k} fill={ZONE} stroke={selected ? "#ffd65a" : ZONE_LINE} strokeWidth={(selected ? 0.45 : 0.3) * k} strokeDasharray={`${1.2 * k} ${0.8 * k}`} />
          {label && (
            <text y={-h / 2 + 2.2 * k} textAnchor="middle" fontSize={1.9 * k} fontWeight={600} fill="#fff" style={{ userSelect: "none" }}>
              {label}
            </text>
          )}
        </g>
      );
    }
    case "text":
      return (
        <text textAnchor="middle" fontSize={2.4 * k} fontWeight={700} fill={selected ? "#ffd65a" : "#fff"} style={{ userSelect: "none" }}>
          {label || "Texto"}
        </text>
      );
  }
}

/**
 * Uma seta. Cada tipo tem o seu traço — a convenção dos quadros táticos: passe
 * a cheio, deslocamento tracejado, condução ondulada, pressão pontilhada,
 * remate duplo, cruzamento curvo.
 */
function ArrowShape({ arrow, selected, k = 1 }: { arrow: DiagramArrow; selected?: boolean; k?: number }) {
  const { x1, y1, x2, y2, kind } = arrow;
  const color = selected ? "#ffd65a" : "#fff";
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // A ponta desenha-se à mão (não com markers): os markers não herdam a cor de
  // seleção e escalam mal com o zoom. `k` encolhe tudo no futsal, como os itens.
  const tipX = x2 - ux * 1.2 * k;
  const tipY = y2 - uy * 1.2 * k;
  const head = (
    <path
      d={`M ${x2} ${y2} L ${tipX - uy * 0.9 * k} ${tipY + ux * 0.9 * k} L ${tipX + uy * 0.9 * k} ${tipY - ux * 0.9 * k} Z`}
      fill={color}
    />
  );
  const common = { stroke: color, fill: "none" } as const;

  if (kind === "dribble") {
    // Onda: segmentos perpendiculares alternados ao longo da linha.
    const waves = Math.max(2, Math.floor(len / (2.2 * k)));
    let d = `M ${x1} ${y1}`;
    for (let i = 1; i <= waves; i++) {
      const t = i / waves;
      const px = x1 + dx * t;
      const py = y1 + dy * t;
      const side = i % 2 === 0 ? 1 : -1;
      const cx0 = x1 + dx * (t - 0.5 / waves) - uy * 1.1 * k * side;
      const cy0 = y1 + dy * (t - 0.5 / waves) + ux * 1.1 * k * side;
      d += ` Q ${cx0} ${cy0} ${px} ${py}`;
    }
    return (
      <g>
        <path d={d} {...common} strokeWidth={0.4 * k} />
        {head}
      </g>
    );
  }

  if (kind === "cross") {
    const mx = (x1 + x2) / 2 - uy * len * 0.25;
    const my = (y1 + y2) / 2 + ux * len * 0.25;
    return (
      <g>
        <path d={`M ${x1} ${y1} Q ${mx} ${my} ${tipX} ${tipY}`} {...common} strokeWidth={0.45 * k} strokeDasharray={`${2 * k} ${1 * k}`} />
        {head}
      </g>
    );
  }

  const dash = kind === "run" ? `${1.8 * k} ${1.1 * k}` : kind === "press" ? `${0.5 * k} ${0.9 * k}` : undefined;
  const width = (kind === "shot" ? 0.7 : kind === "press" ? 0.55 : 0.45) * k;
  return (
    <g>
      <line x1={x1} y1={y1} x2={tipX} y2={tipY} {...common} strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" />
      {kind === "shot" && (
        <line x1={x1 - uy * 0.5 * k} y1={y1 + ux * 0.5 * k} x2={tipX - uy * 0.5 * k} y2={tipY + ux * 0.5 * k} {...common} strokeWidth={0.25 * k} />
      )}
      {head}
    </g>
  );
}

/* -------------------------------------------------------------------------- */
/* Vista parada                                                                */
/* -------------------------------------------------------------------------- */

/** Um frame do desenho, parado — o cartão da biblioteca e a miniatura do bloco. */
export function FieldView({
  diagram,
  frame = 0,
  className,
  ratio,
}: {
  diagram: unknown;
  frame?: number;
  className?: string;
  /**
   * Proporção fixa da moldura (largura/altura) — para grelhas de cartões.
   *
   * Sem isto, cada cartão tomava a forma do seu terreno: um meio campo é
   * vertical (0,77) e um campo inteiro é horizontal (1,5), a linha da grelha
   * esticava-se pelo mais alto, e os cartões de campo inteiro ficavam com meia
   * caixa em branco por baixo do texto. Com uma moldura só, todos os cartões
   * têm a mesma altura e o desenho centra-se lá dentro.
   */
  ratio?: number;
}) {
  const d = asDiagram(diagram);
  if (!d) return null;
  const f = d.frames[Math.min(frame, d.frames.length - 1)];
  const v = baseView(d.field);
  const k = itemScale(d.field);
  return (
    <svg
      viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
      className={className}
      /*
       * O fundo é do elemento, não só do desenho.
       *
       * `meet` centra o desenho e deixa barras quando a moldura não tem a
       * proporção do terreno. Pintadas com a cor do piso, essas barras lêem-se
       * como mais relva (ou mais madeira) à volta do lance; em branco, liam-se
       * como um cartão partido.
       */
      style={{ background: pitchBackground(d.field), ...(ratio ? { aspectRatio: String(ratio) } : {}) }}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden
    >
      <Pitch field={d.field} />
      {f.arrows.map((a) => (
        <ArrowShape key={a.id} arrow={a} k={k} />
      ))}
      {f.items.map((i) => (
        <g key={i.id} transform={`translate(${i.x} ${i.y}) rotate(${i.rot ?? 0})`}>
          <ItemShape item={i} k={k} />
        </g>
      ))}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Animação                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * A animação do exercício: cada frame fica em cena o seu tempo e as posições
 * deslizam para o frame seguinte (interpolação por id — o jogador "7" do frame 2
 * é o mesmo "7" do frame 3). As setas são do frame de partida: são elas que
 * explicam o movimento que está a acontecer.
 */
export function DiagramPlayer({ diagram, className }: { diagram: unknown; className?: string }) {
  const d = asDiagram(diagram);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const raf = useRef(0);

  const frames = d?.frames ?? [];
  const many = frames.length > 1;

  useEffect(() => {
    if (!playing || !d) return;
    let start = performance.now();
    let i = index;

    const tick = (now: number) => {
      const dur = Math.max(300, frames[i]?.durationMs ?? 1200);
      const p = (now - start) / dur;
      if (p >= 1) {
        if (i >= frames.length - 1) {
          setPlaying(false);
          setT(0);
          setIndex(0);
          return;
        }
        i += 1;
        start = now;
        setIndex(i);
        setT(0);
      } else {
        // O primeiro terço é pausa (lê-se o frame), o resto desliza.
        setT(Math.max(0, (p - 0.35) / 0.65));
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  if (!d) return null;
  const v = baseView(d.field);
  const k = itemScale(d.field);
  const from = frames[index];
  const to = frames[Math.min(index + 1, frames.length - 1)];

  const items = from.items.map((item) => {
    const next = to.items.find((n) => n.id === item.id);
    if (!next || !playing) return item;
    return { ...item, x: item.x + (next.x - item.x) * t, y: item.y + (next.y - item.y) * t };
  });

  /*
   * A bola viaja — nunca se teletransporta.
   *
   * A interpolação por id resolve os jogadores, mas a bola muda de dono entre
   * frames: o "jogador c/ bola" do frame 1 passa a jogador simples no 2 e a
   * bolinha aparecia instantaneamente no pé de outro. Por isso as bolas
   * animam-se **por posição, não por id**: recolhem-se as posições de bola dos
   * dois frames (soltas e coladas a jogadores), emparelham-se, e durante a
   * reprodução desenha-se a bola a deslizar de uma para a outra — os
   * `playerBall` perdem a bolinha própria enquanto isso, senão viam-se duas.
   */
  const fromBalls = ballPositions(from, k);
  const toBalls = ballPositions(to, k);
  const movingBalls = playing
    ? fromBalls.map((b, i) => {
        const dest = toBalls[i] ?? b;
        return { x: b.x + (dest.x - b.x) * t, y: b.y + (dest.y - b.y) * t };
      })
    : [];

  return (
    <div className={className}>
      {/* O mesmo tecto de altura do editor: um meio campo é vertical, e sem
          limite a animação de um canto ocupava mil pixels de página. As barras
          que o tecto cria ficam com a cor do piso, como nas miniaturas. */}
      <svg
        viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
        className="w-full rounded-[var(--radius-control)]"
        style={{ maxHeight: 560, background: pitchBackground(d.field) }}
        preserveAspectRatio="xMidYMid meet"
      >
        <Pitch field={d.field} />
        {from.arrows.map((a) => (
          <ArrowShape key={a.id} arrow={a} k={k} />
        ))}
        {items
          .filter((i) => !(playing && i.kind === "ball"))
          .map((i) => (
            <g key={i.id} transform={`translate(${i.x} ${i.y}) rotate(${i.rot ?? 0})`}>
              <ItemShape item={playing && i.kind === "playerBall" ? { ...i, kind: "player" } : i} k={k} />
            </g>
          ))}
        {/* Durante a reprodução, as bolas estáticas escondem-se e estas viajam. */}
        {playing &&
          movingBalls.map((b, i) => (
            <circle key={i} cx={b.x} cy={b.y} r={0.9 * k} fill="#fff" stroke="#1f2937" strokeWidth={0.2 * k} />
          ))}
      </svg>

      {many && (
        <div className="mt-2 flex items-center justify-center gap-1.5">
          <button
            type="button"
            className="ctl-outline size-8 justify-center px-0"
            aria-label="Frame anterior"
            onClick={() => {
              setPlaying(false);
              setIndex((i) => Math.max(0, i - 1));
              setT(0);
            }}
          >
            <ChevronLeft className="size-4" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="ctl-primary h-8 px-3"
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? "Pausa" : "Reproduzir"}
          </button>
          <button
            type="button"
            className="ctl-outline size-8 justify-center px-0"
            aria-label="Frame seguinte"
            onClick={() => {
              setPlaying(false);
              setIndex((i) => Math.min(frames.length - 1, i + 1));
              setT(0);
            }}
          >
            <ChevronRight className="size-4" strokeWidth={1.75} />
          </button>
          <span className="ml-2 text-meta text-ink-3 tabular">
            {index + 1} / {frames.length}
          </span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Editor                                                                      */
/* -------------------------------------------------------------------------- */

type Tool =
  | { mode: "select" }
  /** A mão: arrastar move a vista, em cima do que for. É o pan explícito — o
   *  arrasto em campo vazio no modo de seleção passou a desenhar o laço. */
  | { mode: "pan" }
  | { mode: "stamp"; kind: ItemKind }
  | { mode: "arrow"; kind: ArrowKind };

/** O que tem orientação para rodar. Círculos e bola não — rodar não muda nada. */
const ROTATABLE = new Set<ItemKind>(["barrier", "goal", "miniGoal", "ladder", "dummy", "zone", "cone", "text"]);

const PALETTE: { kind: ItemKind; label: string }[] = (
  ["player", "opponent", "gk", "playerBall", "ball", "cone", "pole", "miniGoal", "goal", "barrier", "ladder", "dummy", "zone", "text"] as ItemKind[]
).map((kind) => ({ kind, label: ITEM_LABEL[kind] }));

const ARROWS: ArrowKind[] = ["pass", "run", "dribble", "shot", "press", "cross"];

/**
 * O editor. Não controlado de propósito: guarda o desenho enquanto se trabalha e
 * entrega-o em `onChange` a cada gesto concluído — quem grava é a página, quando
 * quiser. Mudar de exercício muda a `key` e o editor renasce limpo.
 */
export function FieldEditor({
  initial,
  onChange,
  className,
}: {
  initial: unknown;
  onChange: (d: Diagram) => void;
  className?: string;
}) {
  const [diagram, setDiagram] = useState<Diagram>(() => asDiagram(initial) ?? emptyDiagram("f11"));
  const [frameIx, setFrameIx] = useState(0);
  const [tool, setTool] = useState<Tool>({ mode: "select" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [view, setView] = useState(() => baseView((asDiagram(initial) ?? emptyDiagram()).field));
  const [history, setHistory] = useState<Diagram[]>([]);
  const [future, setFuture] = useState<Diagram[]>([]);
  const svgRef = useRef<SVGSVGElement>(null);

  const frame = diagram.frames[Math.min(frameIx, diagram.frames.length - 1)];
  const kScale = itemScale(diagram.field);

  /** Um gesto concluído: entra na história, sai para o pai. */
  const commit = useCallback(
    (next: Diagram) => {
      setHistory((h) => [...h.slice(-49), diagram]);
      setFuture([]);
      setDiagram(next);
      onChange(next);
    },
    [diagram, onChange],
  );

  const patchFrame = useCallback(
    (fn: (f: DiagramFrame) => DiagramFrame) => {
      const frames = diagram.frames.map((f, i) => (i === frameIx ? fn(f) : f));
      return { ...diagram, frames };
    },
    [diagram, frameIx],
  );

  /* ---- coordenadas ------------------------------------------------------- */

  const toField = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current!.getBoundingClientRect();
      // O SVG usa `meet`: a projeção é uniforme e pode deixar barras. A escala é
      // a menor das duas; o excesso reparte-se pelas margens.
      const scale = Math.min(rect.width / view.w, rect.height / view.h);
      const padX = (rect.width - view.w * scale) / 2;
      const padY = (rect.height - view.h * scale) / 2;
      return {
        x: view.x + (clientX - rect.left - padX) / scale,
        y: view.y + (clientY - rect.top - padY) / scale,
      };
    },
    [view],
  );

  /* ---- gestos ------------------------------------------------------------ */

  const drag = useRef<
    | { type: "move"; start: { x: number; y: number }; origin: Map<string, { x: number; y: number }>; moved: boolean }
    | { type: "pan"; start: { cx: number; cy: number }; view: ReturnType<typeof baseView> }
    | { type: "marquee"; start: { x: number; y: number }; shift: boolean }
    | { type: "arrow"; kind: ArrowKind; from: { x: number; y: number }; current: DiagramArrow }
    | { type: "resize"; id: string; start: { x: number; y: number }; w: number; h: number; rot: number }
    | null
  >(null);
  const [ghostArrow, setGhostArrow] = useState<DiagramArrow | null>(null);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const p = toField(e.clientX, e.clientY);

    // O alvo primeiro, o modo depois: tocar num elemento que já existe é sempre
    // selecionar/arrastar — mesmo com a paleta armada. Sem isto, quem acabava de
    // colocar um jogador e o queria ajustar carimbava outro em cima.
    const hitId = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
    const resize = (e.target as Element).closest("[data-resize]")?.getAttribute("data-resize");

    // A mão arrasta a vista por cima do que for; Alt+arrasto é o atalho de rato
    // para o mesmo gesto sem trocar de ferramenta.
    if (tool.mode === "pan" || e.altKey) {
      drag.current = { type: "pan", start: { cx: e.clientX, cy: e.clientY }, view: { ...view } };
      return;
    }

    if (tool.mode === "stamp" && !hitId && !resize) {
      const small = fieldSize(diagram.field).w < 60;
      const item: DiagramItem = {
        id: newId(),
        kind: tool.kind,
        x: p.x,
        y: p.y,
        // A zona nasce à medida do terreno: 14×10 num campo de onze é um bloco
        // de trabalho; num de 40×20 seria meio campo.
        ...(tool.kind === "zone" ? (small ? { w: 8, h: 6 } : { w: 14, h: 10 }) : {}),
        ...(tool.kind === "player" || tool.kind === "opponent" ? { label: nextNumber(frame.items, tool.kind) } : {}),
        ...(tool.kind === "text" ? { label: "Texto" } : {}),
      };
      commit(patchFrame((f) => ({ ...f, items: [...f.items, item] })));
      setSelected(new Set([item.id]));
      return;
    }

    // Uma seta pode — e costuma — começar em cima de um jogador: o passe parte
    // de alguém. Em modo seta, o toque desenha sempre, haja lá o que houver.
    if (tool.mode === "arrow") {
      const current: DiagramArrow = { id: newId(), kind: tool.kind, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
      drag.current = { type: "arrow", kind: tool.kind, from: p, current };
      setGhostArrow(current);
      return;
    }

    if (resize) {
      const z = frame.items.find((i) => i.id === resize)!;
      drag.current = { type: "resize", id: resize, start: p, w: z.w ?? 14, h: z.h ?? 10, rot: z.rot ?? 0 };
      return;
    }

    if (hitId) {
      const next = new Set(e.shiftKey ? selected : selected.has(hitId) ? selected : []);
      next.add(hitId);
      setSelected(next);
      const origin = new Map<string, { x: number; y: number }>();
      for (const it of frame.items) if (next.has(it.id)) origin.set(it.id, { x: it.x, y: it.y });
      for (const ar of frame.arrows)
        if (next.has(ar.id)) origin.set(ar.id, { x: ar.x1, y: ar.y1 });
      drag.current = { type: "move", start: p, origin, moved: false };
      return;
    }

    /*
     * Campo vazio em modo de seleção: arrastar desenha o laço — tudo o que
     * ficar dentro do retângulo fica selecionado, para mover, apagar ou
     * duplicar em bloco. Um toque simples continua a limpar a seleção; o pan
     * mudou-se para a ferramenta da mão (e Alt+arrasto).
     */
    drag.current = { type: "marquee", start: p, shift: e.shiftKey };
    setMarquee({ x1: p.x, y1: p.y, x2: p.x, y2: p.y });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toField(e.clientX, e.clientY);

    if (d.type === "arrow") {
      d.current = { ...d.current, x2: p.x, y2: p.y };
      setGhostArrow(d.current);
      return;
    }

    if (d.type === "pan") {
      const rect = svgRef.current!.getBoundingClientRect();
      const scale = Math.min(rect.width / d.view.w, rect.height / d.view.h);
      setView({
        ...d.view,
        x: d.view.x - (e.clientX - d.start.cx) / scale,
        y: d.view.y - (e.clientY - d.start.cy) / scale,
      });
      return;
    }

    if (d.type === "marquee") {
      setMarquee({ x1: d.start.x, y1: d.start.y, x2: p.x, y2: p.y });
      return;
    }

    if (d.type === "resize") {
      // Numa zona rodada, o delta do ponteiro projeta-se no referencial dela —
      // senão puxar o canto para a direita alargava-a na diagonal errada.
      const rad = (-d.rot * Math.PI) / 180;
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      const w = Math.max(3, d.w + lx * 2);
      const h = Math.max(3, d.h + ly * 2);
      setDiagram(patchFrame((f) => ({ ...f, items: f.items.map((i) => (i.id === d.id ? { ...i, w, h } : i)) })));
      return;
    }

    // move
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.15) d.moved = true;
    setDiagram(
      patchFrame((f) => ({
        ...f,
        items: f.items.map((i) => {
          const o = d.origin.get(i.id);
          return o ? { ...i, x: o.x + dx, y: o.y + dy } : i;
        }),
        arrows: f.arrows.map((a) => {
          const o = d.origin.get(a.id);
          return o ? { ...a, x1: o.x + dx, y1: o.y + dy, x2: a.x2 - a.x1 + o.x + dx, y2: a.y2 - a.y1 + o.y + dy } : a;
        }),
      })),
    );
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;

    if (!d) return;

    if (d.type === "arrow") {
      setGhostArrow(null);
      const len = Math.hypot(d.current.x2 - d.current.x1, d.current.y2 - d.current.y1);
      if (len > 1.5) {
        commit(patchFrame((f) => ({ ...f, arrows: [...f.arrows, d.current] })));
        setSelected(new Set([d.current.id]));
      }
      return;
    }

    if (d.type === "pan") return;

    if (d.type === "marquee") {
      setMarquee(null);
      const p = toField(e.clientX, e.clientY);
      const x1 = Math.min(d.start.x, p.x);
      const x2 = Math.max(d.start.x, p.x);
      const y1 = Math.min(d.start.y, p.y);
      const y2 = Math.max(d.start.y, p.y);

      // Um laço minúsculo é um toque: limpa a seleção, como sempre limpou.
      if (x2 - x1 < 0.6 && y2 - y1 < 0.6) {
        setSelected(new Set());
        return;
      }

      const inside = (x: number, y: number) => x >= x1 && x <= x2 && y >= y1 && y <= y2;
      const caught = new Set(d.shift ? selected : []);
      for (const it of frame.items) if (inside(it.x, it.y)) caught.add(it.id);
      // Uma seta entra quando as duas pontas entram — meia seta selecionada
      // moveria uma ponta que não se vê dentro do laço.
      for (const a of frame.arrows) if (inside(a.x1, a.y1) && inside(a.x2, a.y2)) caught.add(a.id);
      setSelected(caught);
      return;
    }

    if (d.type === "resize" || (d.type === "move" && d.moved)) {
      // O estado local já tem as posições finais; agora é história.
      setHistory((h) => [...h.slice(-49), diagramBefore(d, diagram, frameIx)]);
      setFuture([]);
      onChange(diagram);
    }
  };

  /* ---- ações ------------------------------------------------------------- */

  const removeSelected = useCallback(() => {
    if (selected.size === 0) return;
    commit(
      patchFrame((f) => ({
        ...f,
        items: f.items.filter((i) => !selected.has(i.id)),
        arrows: f.arrows.filter((a) => !selected.has(a.id)),
      })),
    );
    setSelected(new Set());
  }, [commit, patchFrame, selected]);

  /** Roda os selecionados com orientação, em passos de 15°. */
  const rotateSelected = useCallback(
    (delta: number) => {
      if (selected.size === 0) return;
      commit(
        patchFrame((f) => ({
          ...f,
          items: f.items.map((i) =>
            selected.has(i.id) && ROTATABLE.has(i.kind) ? { ...i, rot: (((i.rot ?? 0) + delta) % 360 + 360) % 360 } : i,
          ),
        })),
      );
    },
    [commit, patchFrame, selected],
  );

  const duplicateSelected = useCallback(() => {
    if (selected.size === 0) return;
    const clones: string[] = [];
    commit(
      patchFrame((f) => {
        const items = [...f.items];
        const arrows = [...f.arrows];
        for (const it of f.items)
          if (selected.has(it.id)) {
            const id = newId();
            clones.push(id);
            items.push({ ...it, id, x: it.x + 3, y: it.y + 3 });
          }
        for (const a of f.arrows)
          if (selected.has(a.id)) {
            const id = newId();
            clones.push(id);
            arrows.push({ ...a, id, x1: a.x1 + 3, y1: a.y1 + 3, x2: a.x2 + 3, y2: a.y2 + 3 });
          }
        return { ...f, items, arrows };
      }),
    );
    setSelected(new Set(clones));
  }, [commit, patchFrame, selected]);

  const undo = useCallback(() => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setFuture((f) => [diagram, ...f].slice(0, 50));
      setDiagram(prev);
      onChange(prev);
      setSelected(new Set());
      setFrameIx((i) => Math.min(i, prev.frames.length - 1));
      return h.slice(0, -1);
    });
  }, [diagram, onChange]);

  const redo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0];
      setHistory((h) => [...h, diagram].slice(-50));
      setDiagram(next);
      onChange(next);
      setSelected(new Set());
      setFrameIx((i) => Math.min(i, next.frames.length - 1));
      return f.slice(1);
    });
  }, [diagram, onChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selected.size) {
        e.preventDefault();
        removeSelected();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelected();
      }
      if (e.key === "Escape") setTool({ mode: "select" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, removeSelected, undo, redo, duplicateSelected]);

  // O zoom com a roda tem de ser um listener não-passivo — o React regista
  // `onWheel` passivo e o `preventDefault` (que trava o scroll da página) não
  // funcionaria lá.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
      setView((v) => {
        const w = Math.min(160, Math.max(18, v.w * factor));
        const h = (w / v.w) * v.h;
        const rect = svg.getBoundingClientRect();
        const fx = (e.clientX - rect.left) / rect.width;
        const fy = (e.clientY - rect.top) / rect.height;
        return { x: v.x + (v.w - w) * fx, y: v.y + (v.h - h) * fy, w, h };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ---- frames ------------------------------------------------------------ */

  const addFrame = () => {
    /*
     * O frame novo é uma cópia completa do atual — posições **e setas**.
     *
     * Nascia sem setas, com a lógica de "o movimento desenha-se novo" — e na
     * prática parecia que os passes desapareciam a cada frame, e quem só queria
     * acrescentar um movimento tinha de redesenhar os três anteriores. Copiar
     * custa um Delete a quem não as quer; não copiar custava o desenho inteiro
     * a quem as queria.
     */
    const clone: DiagramFrame = {
      id: newId(),
      durationMs: frame.durationMs ?? 1200,
      items: frame.items.map((i) => ({ ...i })),
      arrows: frame.arrows.map((a) => ({ ...a, id: newId() })),
    };
    const frames = [...diagram.frames];
    frames.splice(frameIx + 1, 0, clone);
    commit({ ...diagram, frames });
    setFrameIx(frameIx + 1);
    setSelected(new Set());
  };

  const removeFrame = () => {
    if (diagram.frames.length <= 1) return;
    const frames = diagram.frames.filter((_, i) => i !== frameIx);
    commit({ ...diagram, frames });
    setFrameIx(Math.max(0, frameIx - 1));
    setSelected(new Set());
  };

  const setField = (field: FieldKind) => {
    /*
     * Mudar de modalidade converte as coordenadas.
     *
     * Um desenho feito num campo de 105×68 que passa para um de 40×20 sem
     * conversão fica com toda a gente fora do terreno. A proporção mantém a
     * composição; dentro da mesma modalidade (inteiro ↔ meio) nada mexe.
     */
    const before = fieldSize(diagram.field);
    const after = fieldSize(field);
    const sx = after.w / before.w;
    const sy = after.h / before.h;
    const frames =
      sx === 1 && sy === 1
        ? diagram.frames
        : diagram.frames.map((f) => ({
            ...f,
            items: f.items.map((i) => ({
              ...i,
              x: i.x * sx,
              y: i.y * sy,
              ...(i.w !== undefined ? { w: i.w * sx } : {}),
              ...(i.h !== undefined ? { h: i.h * sy } : {}),
            })),
            arrows: f.arrows.map((a) => ({ ...a, x1: a.x1 * sx, y1: a.y1 * sy, x2: a.x2 * sx, y2: a.y2 * sy })),
          }));
    commit({ ...diagram, field, frames });
    setView(baseView(field));
    setSelected(new Set());
  };

  /* ---- seleção única ------------------------------------------------------ */

  const single = useMemo(() => {
    if (selected.size !== 1) return null;
    const id = [...selected][0];
    return frame.items.find((i) => i.id === id) ?? null;
  }, [selected, frame]);

  const labelled = single && ["player", "opponent", "gk", "playerBall", "zone", "text"].includes(single.kind);

  const setLabel = (label: string) => {
    if (!single) return;
    // Escrever letra a letra não é história — o commit fica para o blur.
    setDiagram(patchFrame((f) => ({ ...f, items: f.items.map((i) => (i.id === single.id ? { ...i, label } : i)) })));
  };

  const v = view;

  return (
    <div className={cx("select-none", className)}>
      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-1.5 pb-2">
        <ToolButton active={tool.mode === "select"} onClick={() => setTool({ mode: "select" })}>
          Selecionar
        </ToolButton>
        <ToolButton active={tool.mode === "pan"} onClick={() => setTool({ mode: "pan" })}>
          <Hand className="size-3.5" strokeWidth={1.75} />
          Mover vista
        </ToolButton>
        <span className="mx-1 h-5 w-px bg-line" />
        {ARROWS.map((k) => (
          <ToolButton
            key={k}
            active={tool.mode === "arrow" && tool.kind === k}
            onClick={() => setTool({ mode: "arrow", kind: k })}
          >
            <svg viewBox="0 0 24 10" className="h-2.5 w-6">
              <ArrowShape arrow={{ id: "x", kind: k, x1: 1, y1: 5, x2: 22, y2: 5 }} />
            </svg>
            {ARROW_LABEL[k]}
          </ToolButton>
        ))}
        <span className="mx-1 h-5 w-px bg-line" />
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Desfazer" title="Desfazer (Ctrl+Z)" onClick={undo} disabled={history.length === 0}>
            <RefreshCw className="size-3.5 -scale-x-100" strokeWidth={1.75} />
          </button>
          <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Refazer" title="Refazer (Ctrl+Y)" onClick={redo} disabled={future.length === 0}>
            <RefreshCw className="size-3.5" strokeWidth={1.75} />
          </button>
          <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Aproximar" onClick={() => setView((x) => zoomBy(x, 1 / 1.25))}>
            <Plus className="size-4" strokeWidth={1.75} />
          </button>
          <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Afastar" onClick={() => setView((x) => zoomBy(x, 1.25))}>
            <Minus className="size-4" strokeWidth={1.75} />
          </button>
          <button type="button" className="ctl-outline h-8" onClick={() => setView(baseView(diagram.field))}>
            Ajustar
          </button>
          {/*
            Duas perguntas, dois controlos.

            Eram quatro pílulas em fila — "Campo inteiro · Meio campo · Futsal ·
            Meio futsal" — e isso misturava duas decisões diferentes: em que
            jogo se joga, e quanto do terreno se quer ver. Com cinco variantes
            as pílulas deixaram de caber, por isso a variante é um select (é
            uma escolha por exercício) e a extensão fica em pílulas (troca-se a
            meio do desenho, e o gesto tem de ser imediato).
          */}
          <select
            aria-label="Variante"
            value={formatOf(diagram.field)}
            onChange={(e) => setField(fieldFor(e.target.value as GameFormat, isHalfField(diagram.field)))}
            className="h-8 cursor-pointer rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta font-medium text-ink-2 hover:border-line-strong focus:outline-none"
          >
            {GAME_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
          <SelectPill
            value={isHalfField(diagram.field) ? "half" : "full"}
            options={[
              { value: "full", label: "Inteiro" },
              { value: "half", label: "Meio campo" },
            ]}
            onChange={(e) => setField(fieldFor(formatOf(diagram.field), e === "half"))}
          />
        </div>
      </div>

      <div className="flex gap-2">
        {/* Paleta */}
        <div className="flex w-28 shrink-0 flex-col gap-1 overflow-y-auto rounded-[var(--radius-control)] border border-line bg-sunken/40 p-1.5" style={{ maxHeight: 480 }}>
          {PALETTE.map(({ kind, label }) => (
            <button
              key={kind}
              type="button"
              onClick={() => setTool(tool.mode === "stamp" && tool.kind === kind ? { mode: "select" } : { mode: "stamp", kind })}
              className={cx(
                "flex items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 py-1 text-left text-[11px] font-medium transition-colors",
                tool.mode === "stamp" && tool.kind === kind ? "bg-signal-soft text-signal-ink" : "text-ink-2 hover:bg-sunken",
              )}
            >
              <svg viewBox="-3 -3 6 6" className="size-5 shrink-0 rounded bg-[#527a5e]">
                <g transform="scale(0.9)">
                  <ItemShape item={{ id: "p", kind, x: 0, y: 0, w: 5, h: 4, label: kind === "player" ? "7" : kind === "opponent" ? "9" : undefined }} />
                </g>
              </svg>
              <span className="leading-tight">{label}</span>
            </button>
          ))}
        </div>

        {/* Campo */}
        <div className="min-w-0 flex-1">
          <svg
            ref={svgRef}
            viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`}
            className={cx(
              "w-full touch-none rounded-[var(--radius-control)]",
              tool.mode === "select" ? "cursor-default" : tool.mode === "pan" ? "cursor-grab" : "cursor-crosshair",
            )}
            style={{ aspectRatio: `${baseView(diagram.field).w} / ${baseView(diagram.field).h}`, maxHeight: 560 }}
            preserveAspectRatio="xMidYMid meet"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <Pitch field={diagram.field} />
            {frame.arrows.map((a) => (
              <g key={a.id} data-id={a.id}>
                {/* Uma zona de toque generosa por baixo do traço fino. */}
                <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} stroke="transparent" strokeWidth={2.5 * kScale} />
                <ArrowShape arrow={a} selected={selected.has(a.id)} k={kScale} />
              </g>
            ))}
            {frame.items.map((i) => (
              <g key={i.id} data-id={i.id} transform={`translate(${i.x} ${i.y}) rotate(${i.rot ?? 0})`} className="cursor-move">
                <ItemShape item={i} selected={selected.has(i.id)} k={kScale} />
                {i.kind === "zone" && selected.has(i.id) && (
                  <circle
                    data-resize={i.id}
                    cx={(i.w ?? 14) / 2}
                    cy={(i.h ?? 10) / 2}
                    r={1.2 * kScale}
                    fill="#ffd65a"
                    stroke="#8a6a2f"
                    strokeWidth={0.2 * kScale}
                    className="cursor-nwse-resize"
                  />
                )}
              </g>
            ))}
            {ghostArrow && <ArrowShape arrow={ghostArrow} k={kScale} />}
            {marquee && (
              <rect
                x={Math.min(marquee.x1, marquee.x2)}
                y={Math.min(marquee.y1, marquee.y2)}
                width={Math.abs(marquee.x2 - marquee.x1)}
                height={Math.abs(marquee.y2 - marquee.y1)}
                fill="rgba(255,214,90,0.12)"
                stroke="#ffd65a"
                strokeWidth={0.25 * kScale}
                strokeDasharray={`${1 * kScale} ${0.7 * kScale}`}
              />
            )}
          </svg>

          {/* Barra de seleção */}
          <div className="mt-1.5 flex min-h-8 flex-wrap items-center gap-1.5">
            {selected.size > 0 ? (
              <>
                <span className="text-meta text-ink-3">
                  {selected.size === 1 && single ? ITEM_LABEL[single.kind] : `${selected.size} selecionados`}
                </span>
                {labelled && (
                  <input
                    value={single?.label ?? ""}
                    onChange={(e) => setLabel(e.target.value.slice(0, single?.kind === "text" || single?.kind === "zone" ? 30 : 3))}
                    onBlur={() => commit(diagram)}
                    placeholder={single?.kind === "text" ? "Texto" : single?.kind === "zone" ? "Nome da zona" : "Nº"}
                    className="h-7 w-32 rounded-[var(--radius-control)] border border-line bg-surface px-2 text-meta text-ink focus:border-line-strong focus:outline-none"
                  />
                )}
                {/* Rodar só aparece quando há algo com orientação na seleção. */}
                {[...selected].some((id) => {
                  const it = frame.items.find((x) => x.id === id);
                  return it && ROTATABLE.has(it.kind);
                }) && (
                  <>
                    <button type="button" className="ctl-ghost size-7 justify-center px-0" aria-label="Rodar para a esquerda" title="Rodar 15° para a esquerda" onClick={() => rotateSelected(-15)}>
                      <RotateCcw className="size-3.5" strokeWidth={1.75} />
                    </button>
                    <button type="button" className="ctl-ghost size-7 justify-center px-0" aria-label="Rodar para a direita" title="Rodar 15° para a direita" onClick={() => rotateSelected(15)}>
                      <RotateCw className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </>
                )}
                <button type="button" className="ctl-ghost h-7" onClick={duplicateSelected}>
                  <Copy className="size-3.5" strokeWidth={1.75} /> Duplicar
                </button>
                <button type="button" className="ctl-ghost h-7 text-risk hover:bg-risk-soft hover:text-risk" onClick={removeSelected}>
                  <Trash2 className="size-3.5" strokeWidth={1.75} /> Remover
                </button>
              </>
            ) : (
              <span className="text-meta text-ink-4">
                {tool.mode === "stamp"
                  ? `Toca no campo para colocar: ${ITEM_LABEL[tool.kind]}`
                  : tool.mode === "arrow"
                    ? `Arrasta no campo para desenhar: ${ARROW_LABEL[tool.kind]}`
                    : tool.mode === "pan"
                      ? "Arrasta para mover a vista · roda para aproximar"
                      : "Toca para selecionar · arrasta no vazio para laçar vários · roda para aproximar"}
              </span>
            )}
          </div>

          {/* Frames */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-sunken/40 px-2 py-1.5">
            <span className="text-meta font-medium text-ink-3">Frames</span>
            {diagram.frames.map((f, i) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFrameIx(i);
                  setSelected(new Set());
                }}
                className={cx(
                  "size-7 rounded-[var(--radius-control)] text-meta font-semibold tabular transition-colors",
                  i === frameIx ? "bg-ink text-surface" : "bg-surface text-ink-2 border border-line hover:border-line-strong",
                )}
              >
                {i + 1}
              </button>
            ))}
            <button type="button" className="ctl-outline size-7 justify-center px-0" aria-label="Novo frame" title="Novo frame (continua deste)" onClick={addFrame}>
              <Plus className="size-3.5" strokeWidth={1.75} />
            </button>
            {diagram.frames.length > 1 && (
              <button type="button" className="ctl-ghost size-7 justify-center px-0 text-risk" aria-label="Remover frame" onClick={removeFrame}>
                <Trash2 className="size-3.5" strokeWidth={1.75} />
              </button>
            )}
            {diagram.frames.length > 1 && (
              <label className="ml-auto flex items-center gap-1.5 text-meta text-ink-3">
                Duração
                <input
                  type="range"
                  min={500}
                  max={3000}
                  step={100}
                  value={frame.durationMs ?? 1200}
                  onChange={(e) =>
                    setDiagram(patchFrame((f) => ({ ...f, durationMs: Number(e.target.value) })))
                  }
                  onPointerUp={() => commit(diagram)}
                  className="w-24 accent-[var(--color-signal)]"
                />
                <span className="tabular">{((frame.durationMs ?? 1200) / 1000).toFixed(1)}s</span>
              </label>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ToolButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-2 text-meta font-medium transition-colors",
        active ? "bg-ink text-surface" : "text-ink-2 hover:bg-sunken",
      )}
    >
      {children}
    </button>
  );
}

function SelectPill<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-[var(--radius-control)] border border-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "h-8 px-2.5 text-meta font-medium transition-colors",
            o.value === value ? "bg-ink text-surface" : "bg-surface text-ink-2 hover:bg-sunken",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** As posições de bola de um frame: as soltas e as coladas ao pé de um jogador
 *  (`playerBall` desenha a bolinha em +1,9/+1,6, escalado — o mesmo offset). */
function ballPositions(f: DiagramFrame, k: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const i of f.items) {
    if (i.kind === "ball") out.push({ x: i.x, y: i.y });
    else if (i.kind === "playerBall") out.push({ x: i.x + 1.9 * k, y: i.y + 1.6 * k });
  }
  return out;
}

/** O número livre seguinte para um jogador acabado de colocar. */
function nextNumber(items: DiagramItem[], kind: ItemKind): string {
  const used = new Set(items.filter((i) => i.kind === kind).map((i) => i.label));
  for (let n = 1; n <= 30; n++) if (!used.has(String(n))) return String(n);
  return "";
}

function zoomBy(v: { x: number; y: number; w: number; h: number }, factor: number) {
  const w = Math.min(160, Math.max(18, v.w * factor));
  const h = (w / v.w) * v.h;
  return { x: v.x + (v.w - w) / 2, y: v.y + (v.h - h) / 2, w, h };
}

/**
 * A história de um arrasto guarda o estado **anterior** ao gesto. Durante o
 * movimento o estado local já foi mudando; reconstituir o "antes" exato exigiria
 * uma cópia no pointerdown — que é o que `origin` é para os elementos movidos.
 */
function diagramBefore(
  d: { type: "move"; origin: Map<string, { x: number; y: number }> } | { type: "resize"; id: string; w: number; h: number },
  current: Diagram,
  frameIx: number,
): Diagram {
  const frames = current.frames.map((f, i) => {
    if (i !== frameIx) return f;
    if (d.type === "resize") {
      return { ...f, items: f.items.map((it) => (it.id === d.id ? { ...it, w: d.w, h: d.h } : it)) };
    }
    return {
      ...f,
      items: f.items.map((it) => {
        const o = d.origin.get(it.id);
        return o ? { ...it, x: o.x, y: o.y } : it;
      }),
      arrows: f.arrows.map((a) => {
        const o = d.origin.get(a.id);
        return o ? { ...a, x2: a.x2 - a.x1 + o.x, y2: a.y2 - a.y1 + o.y, x1: o.x, y1: o.y } : a;
      }),
    };
  });
  return { ...current, frames };
}
