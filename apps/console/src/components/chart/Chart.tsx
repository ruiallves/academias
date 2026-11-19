import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/primitives";

/**
 * O motor dos gráficos da consola.
 *
 * Vem do painel da plataforma (`apps/platform/src/components/chart/Chart.tsx`),
 * com o que as Contas de um clube pedem a mais: duas séries opostas lado a lado
 * (o que entrou e o que saiu em cada mês), a linha do saldo que muda de cor no
 * zero, e uma linha pequena para dentro de um cartão de número.
 *
 * ## O que este ficheiro garante
 *
 * - **Mede-se antes de desenhar.** A largura vem de um `ResizeObserver` e o SVG
 *   desenha em pixéis reais — por isso os pontos são redondos e as barras têm a
 *   largura que têm.
 * - **Uma escala, sempre.** Duas séries no mesmo gráfico só quando são a mesma
 *   grandeza (euros com euros). Dois eixos nunca.
 * - **A grelha é fina, contínua e discreta**, e os rótulos do eixo levam os
 *   valores que não estão escritos no desenho.
 * - **O cursor encontra o X.** Uma linha vertical agarra-se ao mês mais próximo
 *   e o tooltip diz os valores — com o rato e com as setas do teclado.
 * - **O texto nunca veste a cor da série.** A cor vive na marca; os números e os
 *   rótulos usam a tinta do produto.
 *
 * ## As duas cores do dinheiro
 *
 * Receitas a verde e despesas a laranja queimado — e não ao vermelho dos
 * avisos. O par verde/vermelho do produto não se distingue para quem não vê o
 * verde (ΔE 4,8 em deuteranopia); este par passa a verificação (ΔE 8,0) e
 * continua a ler-se como "entra" e "sai". A legenda e a posição (a receita é
 * sempre a barra da esquerda) dizem o resto.
 */

export const VERDE = "#1f7a45";
export const LARANJA = "#c2410c";

/* -------------------------------------------------------------------------- */
/* Medidas                                                                     */
/* -------------------------------------------------------------------------- */

/** Margens do desenho: o que sobra para o eixo e para os rótulos. */
const M = { top: 12, right: 14, bottom: 22, left: 56 };

export type Ponto = {
  /** Chave única e estável (o mês). */
  key: string;
  /** O que aparece no eixo dos X. */
  label: string;
  value: number;
  /** A linha do tooltip. Sem ela, escreve-se o rótulo e o valor formatado. */
  detalhe?: ReactNode;
};

/** A largura real do elemento, medida e mantida a par. */
function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return { ref, largura };
}

/**
 * Os valores do eixo dos Y, arredondados a números que se leem.
 *
 * Nunca "0, 3,33, 6,67": a escala sobe para o passo redondo seguinte (1, 2, 5,
 * 10, 20, 50…) e é esse tecto que fecha o gráfico em cima.
 */
function escala(max: number, alvo = 4): { tecto: number; marcas: number[] } {
  if (max <= 0) return { tecto: 1, marcas: [0, 1] };
  const bruto = max / alvo;
  const magnitude = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((p) => p >= bruto) ?? 10 * magnitude;
  const tecto = Math.ceil(max / passo) * passo;
  const marcas: number[] = [];
  for (let v = 0; v <= tecto + passo / 2; v += passo) marcas.push(Number(v.toFixed(6)));
  return { tecto, marcas };
}

/**
 * A mesma escala, quando há valores dos dois lados do zero.
 *
 * O zero tem de ser uma marca, sempre: é a linha que separa ganhar de perder, e
 * uma grelha que não a contenha faz o gráfico mentir sobre onde ela está.
 */
function escalaComZero(min: number, max: number, alvo = 4): { topo: number; fundo: number; marcas: number[] } {
  const extremo = Math.max(Math.abs(min), Math.abs(max), 1);
  const bruto = extremo / alvo;
  const magnitude = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((p) => p >= bruto) ?? 10 * magnitude;
  const topo = Math.max(Math.ceil(max / passo) * passo, 0);
  const fundo = Math.min(Math.floor(min / passo) * passo, 0);
  const marcas: number[] = [];
  for (let v = fundo; v <= topo + passo / 2; v += passo) marcas.push(Number(v.toFixed(6)));
  return { topo, fundo, marcas };
}

/** Quais os rótulos do eixo dos X que cabem sem virar uma mancha cinzenta. */
function rotulosVisiveis(n: number, largura: number): Set<number> {
  if (n === 0) return new Set();
  const cabem = Math.max(2, Math.floor((largura - M.left - M.right) / 54));
  if (n <= cabem) return new Set(Array.from({ length: n }, (_, i) => i));
  const salto = Math.ceil(n / cabem);
  const mostra = new Set<number>();
  for (let i = n - 1; i >= 0; i -= salto) mostra.add(i);
  mostra.add(n - 1);
  return mostra;
}

/* -------------------------------------------------------------------------- */
/* Peças comuns                                                                */
/* -------------------------------------------------------------------------- */

/** A grelha e o eixo dos Y. Fina, contínua, e por baixo de tudo. */
function Grelha({
  marcas,
  y,
  largura,
  formato,
}: {
  marcas: number[];
  y: (v: number) => number;
  largura: number;
  formato: (v: number) => string;
}) {
  return (
    <g aria-hidden>
      {marcas.map((m) => (
        <g key={m}>
          <line
            x1={M.left}
            x2={largura - M.right}
            y1={y(m)}
            y2={y(m)}
            stroke={m === 0 ? "var(--color-line-strong)" : "var(--color-line)"}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text x={M.left - 8} y={y(m) + 3} textAnchor="end" className="fill-[var(--color-ink-4)] text-[10px] tabular">
            {formato(m)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Os rótulos do eixo dos X, já desbastados. */
function EixoX({
  dados,
  x,
  largura,
  altura,
}: {
  dados: { key: string; label: string }[];
  x: (i: number) => number;
  largura: number;
  altura: number;
}) {
  const mostra = rotulosVisiveis(dados.length, largura);
  return (
    <g aria-hidden>
      {dados.map((d, i) =>
        mostra.has(i) ? (
          <text
            key={d.key}
            x={x(i)}
            y={altura - 6}
            textAnchor={i === 0 ? "start" : i === dados.length - 1 ? "end" : "middle"}
            className="fill-[var(--color-ink-4)] text-[10px]"
          >
            {d.label}
          </text>
        ) : null,
      )}
    </g>
  );
}

/**
 * O tooltip, em HTML por cima do SVG.
 *
 * HTML e não `<text>`: leva várias linhas com pesos diferentes, sombra e cantos,
 * e é o mesmo objecto que o teclado mostra ao navegar com as setas. Empurra-se
 * para dentro da caixa quando está perto das bordas.
 */
function Tooltip({ x, largura, titulo, linhas }: { x: number; largura: number; titulo: string; linhas: ReactNode }) {
  const LARG = 190;
  const esquerda = Math.min(Math.max(x - LARG / 2, 4), Math.max(largura - LARG - 4, 4));
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 rounded-[10px] bg-ink px-3 py-2 text-surface shadow-[var(--shadow-pop)]"
      style={{ left: esquerda, width: LARG }}
    >
      <p className="text-[10px] leading-tight text-surface/70">{titulo}</p>
      <div className="mt-1 text-[12px] leading-snug font-semibold tabular">{linhas}</div>
    </div>
  );
}

/** O que o teclado e o rato partilham: qual o ponto activo. */
function useActivo(n: number) {
  const [activo, setActivo] = useState<number | null>(null);

  const porTeclado = useCallback(
    (e: React.KeyboardEvent) => {
      if (n === 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        setActivo((cur) => {
          const base = cur ?? (e.key === "ArrowRight" ? -1 : n);
          return Math.min(Math.max(base + (e.key === "ArrowRight" ? 1 : -1), 0), n - 1);
        });
      }
      if (e.key === "Escape") setActivo(null);
    },
    [n],
  );

  return { activo, setActivo, porTeclado };
}

/** A chave de uma série: a marca colorida ao lado do texto, nunca o texto pintado. */
export function Chave({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5 text-meta text-ink-3">
      <span aria-hidden className="block size-2.5 rounded-[3px]" style={{ background: cor }} />
      {texto}
    </span>
  );
}

/** Um gráfico sem dados chegados ainda — e a dizer porquê. */
export function ChartEmpty({ height, texto = "Ainda não há movimentos suficientes." }: { height: number; texto?: string }) {
  return (
    <div className="flex items-center justify-center px-5 text-meta text-ink-4" style={{ height }}>
      {texto}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Duas séries lado a lado                                                     */
/* -------------------------------------------------------------------------- */

export type PontoDuplo = { key: string; label: string; a: number; b: number };

/**
 * O que entrou e o que saiu em cada mês, em duas barras lado a lado.
 *
 * Lado a lado e não empilhadas: são grandezas opostas e o que se lê é a
 * diferença entre as duas no mesmo mês. As barras partem da mesma base, têm
 * 2px de fundo entre elas e um tecto de 18px de largura — a casa que sobra é
 * ar. A legenda está sempre presente: a cor nunca é a única forma de saber
 * qual é qual.
 */
export function BarrasDuplas({
  dados,
  height = 220,
  formato = (v) => String(v),
  formatoEixo,
  rotuloA,
  rotuloB,
  corA = VERDE,
  corB = LARANJA,
  /** A terceira linha do tooltip: a diferença, tipicamente. */
  resumo,
}: {
  dados: PontoDuplo[];
  height?: number;
  formato?: (v: number) => string;
  formatoEixo?: (v: number) => string;
  rotuloA: string;
  rotuloB: string;
  corA?: string;
  corB?: string;
  resumo?: (p: PontoDuplo) => ReactNode;
}) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const { activo, setActivo, porTeclado } = useActivo(dados.length);

  const eixo = formatoEixo ?? formato;
  const maximo = Math.max(...dados.flatMap((d) => [d.a, d.b]), 0);
  const { tecto, marcas } = escala(maximo);

  const util = Math.max(largura - M.left - M.right, 0);
  const casa = dados.length > 0 ? util / dados.length : 0;
  /* Duas barras e um intervalo de 2px têm de caber na casa, com ar à volta. */
  const barra = Math.min(18, Math.max((casa - 10) / 2, 2));
  const centro = (i: number) => M.left + casa * (i + 0.5);
  const y = (v: number) => M.top + (1 - v / tecto) * (height - M.top - M.bottom);
  const base = y(0);

  const aoMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dados.length === 0 || casa === 0) return;
    const caixa = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - caixa.left - M.left) / casa);
    setActivo(Math.min(Math.max(i, 0), dados.length - 1));
  };

  const ponto = activo === null ? null : dados[activo];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 px-5 pb-2">
        <Chave cor={corA} texto={rotuloA} />
        <Chave cor={corB} texto={rotuloB} />
      </div>
      <div
        ref={ref}
        className="relative pb-1 outline-none"
        tabIndex={0}
        role="img"
        aria-label={`${rotuloA} e ${rotuloB}, por mês`}
        onPointerMove={aoMover}
        onPointerLeave={() => setActivo(null)}
        onKeyDown={porTeclado}
        onBlur={() => setActivo(null)}
      >
        {largura > 0 && (
          <svg width={largura} height={height} className="block">
            <Grelha marcas={marcas} y={y} largura={largura} formato={eixo} />

            {dados.map((d, i) => {
              const altoA = d.a > 0 ? Math.max(base - y(d.a), 2) : 0;
              const altoB = d.b > 0 ? Math.max(base - y(d.b), 2) : 0;
              const opacidade = activo === null || activo === i ? 1 : 0.5;
              const xA = centro(i) - barra - 1;
              const xB = centro(i) + 1;
              return (
                <g key={d.key} opacity={opacidade}>
                  {/* A casa inteira é o alvo do rato, não só as barras pintadas. */}
                  <rect x={centro(i) - casa / 2} y={M.top} width={casa} height={height - M.top - M.bottom} fill="transparent" />
                  {altoA > 0 && <rect x={xA} y={base - altoA} width={barra} height={altoA} rx={Math.min(4, barra / 2)} fill={corA} />}
                  {altoB > 0 && <rect x={xB} y={base - altoB} width={barra} height={altoB} rx={Math.min(4, barra / 2)} fill={corB} />}
                </g>
              );
            })}

            <EixoX dados={dados} x={centro} largura={largura} altura={height} />
          </svg>
        )}

        {ponto && (
          <Tooltip
            x={centro(activo!)}
            largura={largura}
            titulo={ponto.label}
            linhas={
              <>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-normal text-surface/80">
                    <span className="size-2 rounded-[2px]" style={{ background: corA }} />
                    {rotuloA}
                  </span>
                  {formato(ponto.a)}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-normal text-surface/80">
                    <span className="size-2 rounded-[2px]" style={{ background: corB }} />
                    {rotuloB}
                  </span>
                  {formato(ponto.b)}
                </span>
                {resumo && <span className="mt-1 block border-t border-surface/20 pt-1">{resumo(ponto)}</span>}
              </>
            }
          />
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O saldo: uma linha que muda de cor no zero                                  */
/* -------------------------------------------------------------------------- */

/**
 * Uma linha ao longo do tempo que se lê pelo sinal: verde acima de zero,
 * laranja abaixo.
 *
 * O gráfico responde a uma pergunta de sim ou não — "o clube está a ganhar ou
 * a perder?" — e o zero é a fronteira. Pintar a linha conforme o lado em que
 * está poupa a leitura do eixo: vê-se o mês em que atravessa sem procurar o
 * número. Um recorte por cima e outro por baixo do zero desenham a mesma linha
 * duas vezes, cada um com a sua cor, e a mudança acontece no ponto exacto.
 */
export function SaldoChart({
  dados,
  height = 220,
  formato = (v) => String(v),
  formatoEixo,
}: {
  dados: Ponto[];
  height?: number;
  formato?: (v: number) => string;
  formatoEixo?: (v: number) => string;
}) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const { activo, setActivo, porTeclado } = useActivo(dados.length);
  const id = useRef(`saldo-${Math.random().toString(36).slice(2, 9)}`).current;

  const eixo = formatoEixo ?? formato;
  const valores = dados.map((d) => d.value);
  const { topo, fundo, marcas } = escalaComZero(Math.min(...valores, 0), Math.max(...valores, 0));

  const x = (i: number) =>
    dados.length === 1
      ? (M.left + largura - M.right) / 2
      : M.left + (i / Math.max(dados.length - 1, 1)) * (largura - M.left - M.right);
  const y = (v: number) => M.top + ((topo - v) / (topo - fundo || 1)) * (height - M.top - M.bottom);
  const zero = y(0);

  const linha = dados.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = dados.length
    ? `${linha} L${x(dados.length - 1).toFixed(1)},${zero.toFixed(1)} L${x(0).toFixed(1)},${zero.toFixed(1)} Z`
    : "";

  const aoMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dados.length === 0 || largura === 0) return;
    const caixa = e.currentTarget.getBoundingClientRect();
    const passo = (largura - M.left - M.right) / Math.max(dados.length - 1, 1);
    const i = Math.round((e.clientX - caixa.left - M.left) / passo);
    setActivo(Math.min(Math.max(i, 0), dados.length - 1));
  };

  const ponto = activo === null ? null : dados[activo];
  const ultimo = dados[dados.length - 1];

  return (
    <div
      ref={ref}
      className="relative pb-1 outline-none"
      tabIndex={0}
      role="img"
      aria-label="Saldo no fim de cada mês"
      onPointerMove={aoMover}
      onPointerLeave={() => setActivo(null)}
      onKeyDown={porTeclado}
      onBlur={() => setActivo(null)}
    >
      {largura > 0 && dados.length > 0 && (
        <svg width={largura} height={height} className="block">
          <defs>
            {/* Um recorte para cada lado do zero: a cor muda onde a linha cruza. */}
            <clipPath id={`${id}-acima`}>
              <rect x={0} y={0} width={largura} height={Math.max(zero, 0)} />
            </clipPath>
            <clipPath id={`${id}-abaixo`}>
              <rect x={0} y={zero} width={largura} height={Math.max(height - zero, 0)} />
            </clipPath>
            <linearGradient id={`${id}-verde`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={VERDE} stopOpacity={0.16} />
              <stop offset="100%" stopColor={VERDE} stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`${id}-laranja`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={LARANJA} stopOpacity={0.16} />
              <stop offset="100%" stopColor={LARANJA} stopOpacity={0} />
            </linearGradient>
          </defs>

          <Grelha marcas={marcas} y={y} largura={largura} formato={eixo} />

          <path d={area} fill={`url(#${id}-verde)`} clipPath={`url(#${id}-acima)`} />
          <path d={area} fill={`url(#${id}-laranja)`} clipPath={`url(#${id}-abaixo)`} />
          <path d={linha} fill="none" stroke={VERDE} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${id}-acima)`} />
          <path d={linha} fill="none" stroke={LARANJA} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" clipPath={`url(#${id}-abaixo)`} />

          {/* O último ponto marcado: é o saldo de hoje, e é onde o olho cai. */}
          <circle
            cx={x(dados.length - 1)}
            cy={y(ultimo.value)}
            r={4}
            fill={ultimo.value < 0 ? LARANJA : VERDE}
            stroke="var(--color-surface)"
            strokeWidth={2}
          />

          {ponto && (
            <g>
              <line x1={x(activo!)} x2={x(activo!)} y1={M.top} y2={height - M.bottom} stroke="var(--color-ink-4)" strokeWidth={1} strokeOpacity={0.6} />
              <circle cx={x(activo!)} cy={y(ponto.value)} r={5} fill={ponto.value < 0 ? LARANJA : VERDE} stroke="var(--color-surface)" strokeWidth={2} />
            </g>
          )}

          <EixoX dados={dados} x={x} largura={largura} altura={height} />
        </svg>
      )}

      {ponto && <Tooltip x={x(activo!)} largura={largura} titulo={ponto.label} linhas={ponto.detalhe ?? formato(ponto.value)} />}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* A linha pequena de um cartão                                                */
/* -------------------------------------------------------------------------- */

/**
 * Doze pontos numa linha de 1,5px, sem eixos: a tendência de um número, ao
 * lado do número. O último ponto leva um marcador — é o período corrente.
 */
export function Sparkline({ valores, cor = "var(--color-ink-3)", height = 28 }: { valores: number[]; cor?: string; height?: number }) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const n = valores.length;
  const max = Math.max(...valores, 1);
  const min = Math.min(...valores, 0);
  const x = (i: number) => (n === 1 ? largura / 2 : 2 + (i / (n - 1)) * (largura - 4));
  const y = (v: number) => 3 + (1 - (v - min) / (max - min || 1)) * (height - 6);
  const d = valores.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <div ref={ref} className="h-full w-full" aria-hidden>
      {largura > 0 && n > 1 && (
        <svg width={largura} height={height} className="block">
          <path d={d} fill="none" stroke={cor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(n - 1)} cy={y(valores[n - 1])} r={2.5} fill={cor} stroke="var(--color-surface)" strokeWidth={1.5} />
        </svg>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Barras horizontais ordenadas                                                */
/* -------------------------------------------------------------------------- */

/**
 * Categorias da maior para a menor, numa cor só.
 *
 * Barras numa base comum comparam-se melhor do que fatias de um círculo, e
 * aguentam dez categorias sem perder a leitura. O valor e a parte do total
 * ficam ao lado do nome, em texto da cor do texto; a barra só carrega a
 * proporção.
 */
export function BarrasOrdenadas({
  linhas,
  cor,
  formato,
  max: maxLinhas = 8,
}: {
  linhas: { label: string; value: number }[];
  cor: string;
  formato: (v: number) => string;
  max?: number;
}) {
  const total = linhas.reduce((s, l) => s + l.value, 0);
  const ordenadas = [...linhas].sort((a, b) => b.value - a.value);
  const visiveis = ordenadas.slice(0, maxLinhas);
  const resto = ordenadas.slice(maxLinhas);
  const outras = resto.reduce((s, l) => s + l.value, 0);
  const todas = outras > 0 ? [...visiveis, { label: `Outras (${resto.length})`, value: outras }] : visiveis;
  const maior = Math.max(...todas.map((l) => l.value), 1);

  return (
    <ul className="space-y-2.5">
      {todas.map((l) => {
        const parte = total > 0 ? l.value / total : 0;
        return (
          <li key={l.label} className="group" title={`${l.label}: ${formato(l.value)}`}>
            <div className="flex items-baseline justify-between gap-3 text-meta">
              <span className="truncate font-medium text-ink">{l.label}</span>
              <span className="shrink-0 text-ink-2 tabular">
                {formato(l.value)}
                <span className="ml-1.5 text-ink-4">{Math.round(parte * 100)}%</span>
              </span>
            </div>
            <div className="mt-1 h-[6px] overflow-hidden rounded-full bg-sunken">
              <span
                className={cx("block h-full rounded-full transition-[width] duration-300")}
                style={{ width: `${Math.max(1.5, (l.value / maior) * 100)}%`, background: cor }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
