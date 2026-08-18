/**
 * Os gráficos do painel.
 *
 * Escritos em SVG à mão, e não com uma biblioteca. Não é teimosia: são dois
 * gráficos, ambos simples, e a alternativa era trazer 50 kB de código com o seu
 * próprio sistema de temas, de escalas e de tooltips — que depois é preciso
 * dobrar para se parecer com o resto do produto. Aqui herdam os tokens
 * directamente e não há nada a dobrar.
 *
 * ## O que estes gráficos recusam
 *
 * Sem eixos decorativos, sem grelhas de fundo densas, sem legendas a repetir o que
 * o título já diz. Um gráfico de painel é lido em dois segundos por alguém que
 * quer saber se a linha sobe — tudo o que não serve essa leitura está a atrapalhar.
 */

import { monthLabel } from "@/lib/format";
import type { SeriesPoint } from "@/lib/types";

const SIGNAL = "var(--color-signal)";

/* -------------------------------------------------------------------------- */

/**
 * Academias activas ao longo do tempo — área com linha.
 *
 * É a curva do negócio. Uma área e não barras porque o que interessa aqui é a
 * **forma**: se acelera, se estagna, se inflecte.
 */
export function GrowthChart({ data, height = 180 }: { data: SeriesPoint[]; height?: number }) {
  if (data.length < 2) return <ChartEmpty height={height} />;

  const values = data.map((d) => d.active_end);
  const max = Math.max(...values, 1);
  const w = 100;
  const h = 100;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    // 6% de folga no topo para a linha não encostar à moldura.
    const y = h - (v / max) * h * 0.94;
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const last = values[values.length - 1];
  const first = values[0];

  return (
    <div>
      <div className="flex items-baseline gap-2.5 px-5 pt-4">
        <span className="text-[26px] leading-none font-semibold text-ink tabular">{last}</span>
        <span className="text-meta text-ink-3">
          academias{" "}
          {last !== first && (
            <span className={last > first ? "text-[#1f7a45]" : "text-[#a82a20]"}>
              {last > first ? "+" : ""}
              {last - first} no período
            </span>
          )}
        </span>
      </div>

      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ height, width: "100%" }} role="img" aria-label="Academias activas ao longo do tempo">
        <defs>
          <linearGradient id="growth" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SIGNAL} stopOpacity="0.18" />
            <stop offset="100%" stopColor={SIGNAL} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#growth)" />
        {/* `vectorEffect` mantém a espessura constante apesar do viewBox esticado. */}
        <path d={line} fill="none" stroke={SIGNAL} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="2.5" fill={SIGNAL} vectorEffect="non-scaling-stroke" />
      </svg>

      <MonthAxis data={data} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Novas e canceladas por mês — barras nos dois sentidos do mesmo eixo.
 *
 * Empilhar seria mais compacto e mentiria: entradas e saídas são grandezas
 * opostas, e vê-las a crescer para lados contrários é a leitura certa. A linha do
 * zero é o que separa um mês bom de um mau, e por isso é a única linha desenhada.
 */
export function ChurnChart({ data, height = 180 }: { data: SeriesPoint[]; height?: number }) {
  if (data.length === 0) return <ChartEmpty height={height} />;

  const max = Math.max(...data.map((d) => Math.max(d.new_academies, d.cancelled)), 1);
  const totalNew = data.reduce((n, d) => n + d.new_academies, 0);
  const totalOut = data.reduce((n, d) => n + d.cancelled, 0);

  return (
    <div>
      <div className="flex items-baseline gap-2.5 px-5 pt-4">
        <span className="text-[26px] leading-none font-semibold text-ink tabular">
          {totalNew > 0 ? "+" : ""}
          {totalNew - totalOut}
        </span>
        <span className="text-meta text-ink-3">
          líquido · {totalNew} entraram, {totalOut} saíram
        </span>
      </div>

      <div className="flex items-stretch gap-1 px-5 pt-3" style={{ height }}>
        {data.map((d) => (
          <div key={d.month} className="flex flex-1 flex-col justify-center" title={`${monthLabel(d.month)}: +${d.new_academies} / −${d.cancelled}`}>
            <div className="flex flex-1 flex-col justify-end">
              <div
                className="rounded-t-[2px]"
                style={{ height: `${(d.new_academies / max) * 100}%`, background: SIGNAL, minHeight: d.new_academies > 0 ? 2 : 0 }}
              />
            </div>
            <div className="h-px bg-line-strong" />
            <div className="flex flex-1 flex-col justify-start">
              <div
                className="rounded-b-[2px] bg-[#d9776c]"
                style={{ height: `${(d.cancelled / max) * 100}%`, minHeight: d.cancelled > 0 ? 2 : 0 }}
              />
            </div>
          </div>
        ))}
      </div>

      <MonthAxis data={data} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Os meses, por baixo do gráfico.
 *
 * Só o primeiro, o último e um do meio quando há muitos: doze rótulos de três
 * letras em 400px viram uma mancha cinzenta que ninguém lê.
 */
function MonthAxis({ data }: { data: SeriesPoint[] }) {
  const show = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  return (
    <div className="flex px-5 pt-2 pb-4">
      {data.map((d, i) => (
        <span key={d.month} className="flex-1 text-center text-[10px] text-ink-4">
          {show.has(i) ? monthLabel(d.month) : ""}
        </span>
      ))}
    </div>
  );
}

function ChartEmpty({ height }: { height: number }) {
  return (
    <div className="flex items-center justify-center px-5 text-meta text-ink-4" style={{ height: height + 60 }}>
      Ainda não há histórico suficiente.
    </div>
  );
}
