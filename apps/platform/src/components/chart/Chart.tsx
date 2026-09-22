import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/components/primitives";

/**
 * O motor dos gráficos do painel.
 *
 * ## Porquê SVG à mão, outra vez
 *
 * Continuam a ser meia dúzia de gráficos simples, e uma biblioteca trazia o seu
 * próprio sistema de temas, escalas e tooltips para depois se dobrar até se
 * parecer com o produto. O que mudou foi a ambição: antes eram `<div>`s com
 * altura em percentagem, que se leem mas não se medem — sem eixo, sem grelha,
 * sem saber o valor de um mês sem passar o rato por cima de um `title` do
 * browser.
 *
 * ## O que este ficheiro garante
 *
 * - **Mede-se antes de desenhar.** A largura vem de um `ResizeObserver`, e o SVG
 *   desenha em pixéis reais. É por isso que os pontos são redondos: a versão
 *   antiga esticava o `viewBox` com `preserveAspectRatio="none"` e transformava
 *   os marcadores em triângulos.
 * - **Uma escala, sempre.** Duas séries no mesmo gráfico só quando são a mesma
 *   grandeza (euros com euros, pessoas com pessoas). Dois eixos nunca.
 * - **A grelha é fina, contínua e discreta**, e os rótulos do eixo levam os
 *   valores que não estão escritos no desenho.
 * - **O cursor encontra o X.** Uma linha vertical agarra-se ao ponto mais
 *   próximo e o tooltip diz o valor — com o rato, e com as setas do teclado.
 * - **O texto nunca veste a cor da série.** A cor vive na marca; os números e os
 *   rótulos usam a tinta do produto.
 */

/* -------------------------------------------------------------------------- */
/* Medidas                                                                     */
/* -------------------------------------------------------------------------- */

/** Margens do desenho: o que sobra para o eixo e para os rótulos. */
const M = { top: 12, right: 14, bottom: 22, left: 52 };

export type Ponto = {
  /** Chave única e estável (o mês, a semana). */
  key: string;
  /** O que aparece no eixo dos X. */
  label: string;
  value: number;
  /** A linha do tooltip. Sem ela, escreve-se o rótulo e o valor formatado. */
  detalhe?: string;
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
/* Cabeçalho: o número que se lê primeiro                                      */
/* -------------------------------------------------------------------------- */

/**
 * O número grande do gráfico, com a variação por baixo.
 *
 * Um gráfico de painel responde a "quanto" e a "para onde vai". O "quanto" é
 * texto — ninguém lê um valor exacto de uma linha — e o desenho fica com a
 * segunda pergunta.
 */
export function ChartHero({
  valor,
  unidade,
  delta,
  acao,
}: {
  valor: string;
  unidade?: string;
  /** Sinalizada e comparada com um período dito por extenso. */
  delta?: { texto: string; bom: boolean | null };
  /** O selector de período, ou o que o gráfico ofereça. */
  acao?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {/* Proporcional, e não tabular: num número grande, a largura fixa dos
              algarismos deixa buracos. Ver `marks-and-anatomy`. */}
          <span className="text-[26px] leading-none font-semibold text-ink">{valor}</span>
          {unidade && <span className="text-meta text-ink-3">{unidade}</span>}
        </div>
        {delta && (
          <p
            className={cx(
              "mt-1 text-meta tabular",
              delta.bom === null ? "text-ink-3" : delta.bom ? "text-[#1f7a45]" : "text-[#b4453a]",
            )}
          >
            {delta.texto}
          </p>
        )}
      </div>
      {acao && <div className="shrink-0">{acao}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Peças comuns                                                                */
/* -------------------------------------------------------------------------- */

type Comum = {
  dados: Ponto[];
  height?: number;
  /** Como se escreve um valor: euros, pessoas, o que for. */
  formato?: (v: number) => string;
  /** Uma referência horizontal (os gastos fixos, uma meta). */
  referencia?: { valor: number; rotulo: string } | null;
};

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
            stroke="var(--color-line)"
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
  /** Só precisa da chave e do rótulo: serve a linha, as barras e as duas séries. */
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
 * HTML e não `<text>`: leva duas linhas com pesos diferentes, sombra e cantos, e
 * é o mesmo objecto que o teclado mostra ao navegar com as setas. Empurra-se
 * para dentro da caixa quando está perto das bordas — um tooltip cortado é pior
 * do que nenhum.
 */
function Tooltip({ x, largura, titulo, linhas }: { x: number; largura: number; titulo: string; linhas: ReactNode }) {
  const LARG = 150;
  const esquerda = Math.min(Math.max(x - LARG / 2, 4), Math.max(largura - LARG - 4, 4));
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 rounded-[10px] bg-ink px-3 py-2 text-surface shadow-[0_8px_24px_rgba(15,23,20,0.22)]"
      style={{ left: esquerda, width: LARG }}
    >
      <p className="text-[10px] leading-tight text-surface/70">{titulo}</p>
      <div className="mt-0.5 text-[13px] leading-tight font-semibold tabular">{linhas}</div>
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

/* -------------------------------------------------------------------------- */
/* A linha com área                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Uma série ao longo do tempo: linha de 2px, área em gradiente por baixo.
 *
 * A área não é decoração: dá massa à linha e faz a tendência ler-se de longe.
 * Vai a 18% no topo e a zero na base, porque uma área opaca compete com a linha
 * e com a grelha.
 */
export function AreaChart({
  dados,
  height = 200,
  formato = (v) => String(v),
  formatoEixo,
  referencia = null,
}: Comum & { formatoEixo?: (v: number) => string }) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const { activo, setActivo, porTeclado } = useActivo(dados.length);
  const gradiente = useRef(`grad-${Math.random().toString(36).slice(2, 9)}`).current;

  const eixo = formatoEixo ?? formato;
  const maximo = Math.max(...dados.map((d) => d.value), referencia?.valor ?? 0, 0);
  const { tecto, marcas } = escala(maximo);

  const x = (i: number) =>
    dados.length === 1
      ? (M.left + largura - M.right) / 2
      : M.left + (i / (dados.length - 1)) * (largura - M.left - M.right);
  const y = (v: number) => M.top + (1 - v / tecto) * (height - M.top - M.bottom);

  /* O rato: o ponto mais próximo do X, e não o ponto onde se acertou. */
  const aoMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dados.length === 0 || largura === 0) return;
    const caixa = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - caixa.left;
    const passo = (largura - M.left - M.right) / Math.max(dados.length - 1, 1);
    const i = Math.round((px - M.left) / passo);
    setActivo(Math.min(Math.max(i, 0), dados.length - 1));
  };

  const linha = dados.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const area = dados.length
    ? `${linha} L${x(dados.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`
    : "";
  const ponto = activo === null ? null : dados[activo];

  return (
    <div
      ref={ref}
      className="relative px-0 pb-1 outline-none"
      tabIndex={0}
      role="img"
      aria-label={`Gráfico de linha com ${dados.length} pontos`}
      onPointerMove={aoMover}
      onPointerLeave={() => setActivo(null)}
      onKeyDown={porTeclado}
      onBlur={() => setActivo(null)}
    >
      {largura > 0 && (
        <svg width={largura} height={height} className="block">
          <defs>
            <linearGradient id={gradiente} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-signal)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--color-signal)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <Grelha marcas={marcas} y={y} largura={largura} formato={eixo} />

          {referencia && referencia.valor > 0 && (
            <g>
              <line
                x1={M.left}
                x2={largura - M.right}
                y1={y(referencia.valor)}
                y2={y(referencia.valor)}
                stroke="var(--color-ink)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <text x={largura - M.right} y={y(referencia.valor) - 5} textAnchor="end" className="fill-[var(--color-ink-3)] text-[10px]">
                {referencia.rotulo}
              </text>
            </g>
          )}

          {dados.length > 0 && (
            <>
              <path d={area} fill={`url(#${gradiente})`} />
              <path
                d={linha}
                fill="none"
                stroke="var(--color-signal)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* O último ponto marcado: é o valor de hoje, e é onde o olho cai. */}
              <circle
                cx={x(dados.length - 1)}
                cy={y(dados[dados.length - 1].value)}
                r={4}
                fill="var(--color-signal)"
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            </>
          )}

          {ponto && (
            <g>
              <line
                x1={x(activo!)}
                x2={x(activo!)}
                y1={M.top}
                y2={height - M.bottom}
                stroke="var(--color-signal)"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
              <circle
                cx={x(activo!)}
                cy={y(ponto.value)}
                r={5}
                fill="var(--color-signal)"
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            </g>
          )}

          <EixoX dados={dados} x={x} largura={largura} altura={height} />
        </svg>
      )}

      {ponto && (
        <Tooltip x={x(activo!)} largura={largura} titulo={ponto.label} linhas={ponto.detalhe ?? formato(ponto.value)} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* As barras                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Barras para o que é contado por período fechado — uma semana, um mês.
 *
 * Linha só quando o meio dos pontos existe: entre duas semanas não há dias, e
 * uma linha inventava-os. As barras nunca enchem a casa (24px de tecto), e o
 * topo é arredondado só em cima, porque a base assenta no eixo.
 */
export function BarChart({
  dados,
  height = 200,
  formato = (v) => String(v),
  formatoEixo,
  referencia = null,
  /** A segunda série, desenhada por cima em linha. A mesma grandeza, sempre. */
  linha,
  /**
   * O que se acrescenta por cima de cada barra — a simulação, tipicamente.
   *
   * Empilhado, e com 2px de fundo a separar: é a mesma grandeza somada à
   * primeira, e o que se lê é o total. Vem mais claro e com um tracejado à
   * volta, porque não é dinheiro contratado.
   */
  empilhada,
}: Comum & {
  formatoEixo?: (v: number) => string;
  linha?: { valores: number[]; rotulo: string };
  empilhada?: { valores: number[]; rotulo: string };
}) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const { activo, setActivo, porTeclado } = useActivo(dados.length);

  const eixo = formatoEixo ?? formato;
  const totais = dados.map((d, i) => d.value + (empilhada?.valores[i] ?? 0));
  const maximo = Math.max(...totais, ...(linha?.valores ?? []), referencia?.valor ?? 0, 0);
  const { tecto, marcas } = escala(maximo);

  const util = Math.max(largura - M.left - M.right, 0);
  const casa = dados.length > 0 ? util / dados.length : 0;
  const larguraDaBarra = Math.min(24, Math.max(casa - 6, 2));
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
    <div
      ref={ref}
      className="relative pb-1 outline-none"
      tabIndex={0}
      role="img"
      aria-label={`Gráfico de barras com ${dados.length} colunas`}
      onPointerMove={aoMover}
      onPointerLeave={() => setActivo(null)}
      onKeyDown={porTeclado}
      onBlur={() => setActivo(null)}
    >
      {largura > 0 && (
        <svg width={largura} height={height} className="block">
          <Grelha marcas={marcas} y={y} largura={largura} formato={eixo} />

          {dados.map((d, i) => {
            const alto = d.value > 0 ? Math.max(base - y(d.value), 2) : 0;
            const extra = empilhada?.valores[i] ?? 0;
            const altoExtra = extra > 0 ? Math.max(base - y(extra), 2) : 0;
            const opacidade = activo === null || activo === i ? 1 : 0.55;
            return (
              <g key={d.key}>
                {/* A casa inteira é o alvo do rato, não só a barra pintada. */}
                <rect x={centro(i) - casa / 2} y={M.top} width={casa} height={height - M.top - M.bottom} fill="transparent" />
                {alto > 0 && (
                  <rect
                    x={centro(i) - larguraDaBarra / 2}
                    y={base - alto}
                    width={larguraDaBarra}
                    height={alto}
                    rx={Math.min(4, larguraDaBarra / 2)}
                    fill="var(--color-signal)"
                    opacity={opacidade}
                  />
                )}
                {altoExtra > 0 && (
                  <rect
                    /* 2px de fundo entre as duas: é o que as separa, e não um traço. */
                    x={centro(i) - larguraDaBarra / 2}
                    y={base - alto - altoExtra - 2}
                    width={larguraDaBarra}
                    height={altoExtra}
                    rx={Math.min(4, larguraDaBarra / 2)}
                    fill="var(--color-signal)"
                    fillOpacity={0.28}
                    stroke="var(--color-signal)"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    opacity={opacidade}
                  />
                )}
              </g>
            );
          })}

          {linha && (
            <path
              d={linha.valores
                .map((v, i) => `${i === 0 ? "M" : "L"}${centro(i).toFixed(1)},${y(v).toFixed(1)}`)
                .join(" ")}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {referencia && referencia.valor > 0 && (
            <g>
              <line
                x1={M.left}
                x2={largura - M.right}
                y1={y(referencia.valor)}
                y2={y(referencia.valor)}
                stroke="var(--color-ink)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <text x={largura - M.right} y={y(referencia.valor) - 5} textAnchor="end" className="fill-[var(--color-ink-3)] text-[10px]">
                {referencia.rotulo}
              </text>
            </g>
          )}

          <EixoX dados={dados} x={centro} largura={largura} altura={height} />
        </svg>
      )}

      {ponto && (
        <Tooltip x={centro(activo!)} largura={largura} titulo={ponto.label} linhas={ponto.detalhe ?? formato(ponto.value)} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Duas séries opostas                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Entradas para cima, saídas para baixo, a partir da mesma linha do zero.
 *
 * Empilhar seria mais compacto e mentiria: são grandezas opostas, e o que se lê
 * é de que lado o mês caiu. Duas séries pedem legenda — a cor nunca é a única
 * forma de saber qual é qual.
 */
export function DivergingBars({
  dados,
  height = 200,
  formato = (v) => String(v),
  acima,
  abaixo,
}: {
  dados: { key: string; label: string; acima: number; abaixo: number }[];
  height?: number;
  formato?: (v: number) => string;
  acima: string;
  abaixo: string;
}) {
  const { ref, largura } = useLargura<HTMLDivElement>();
  const { activo, setActivo, porTeclado } = useActivo(dados.length);

  const maximo = Math.max(...dados.map((d) => Math.max(d.acima, d.abaixo)), 1);
  const { tecto } = escala(maximo, 2);

  const util = Math.max(largura - M.left - M.right, 0);
  const casa = dados.length > 0 ? util / dados.length : 0;
  const larguraDaBarra = Math.min(20, Math.max(casa - 6, 2));
  const centro = (i: number) => M.left + casa * (i + 0.5);
  const meio = M.top + (height - M.top - M.bottom) / 2;
  const escalaY = (v: number) => (v / tecto) * ((height - M.top - M.bottom) / 2);

  const aoMover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dados.length === 0 || casa === 0) return;
    const caixa = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - caixa.left - M.left) / casa);
    setActivo(Math.min(Math.max(i, 0), dados.length - 1));
  };

  const ponto = activo === null ? null : dados[activo];

  return (
    <div>
      <div className="flex items-center gap-4 px-5 pb-1">
        <Chave cor="var(--color-signal)" texto={acima} />
        <Chave cor="#b4453a" texto={abaixo} />
      </div>

      <div
        ref={ref}
        className="relative pb-1 outline-none"
        tabIndex={0}
        role="img"
        aria-label={`${acima} e ${abaixo}, por mês`}
        onPointerMove={aoMover}
        onPointerLeave={() => setActivo(null)}
        onKeyDown={porTeclado}
        onBlur={() => setActivo(null)}
      >
        {largura > 0 && (
          <svg width={largura} height={height} className="block">
            {[tecto, 0, -tecto].map((m) => (
              <line
                key={m}
                x1={M.left}
                x2={largura - M.right}
                y1={meio - escalaY(m)}
                y2={meio - escalaY(m)}
                stroke={m === 0 ? "var(--color-line-strong)" : "var(--color-line)"}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            ))}
            <text x={M.left - 8} y={meio - escalaY(tecto) + 3} textAnchor="end" className="fill-[var(--color-ink-4)] text-[10px] tabular">
              {formato(tecto)}
            </text>
            <text x={M.left - 8} y={meio + 3} textAnchor="end" className="fill-[var(--color-ink-4)] text-[10px] tabular">
              0
            </text>

            {dados.map((d, i) => (
              <g key={d.key} opacity={activo === null || activo === i ? 1 : 0.55}>
                <rect x={centro(i) - casa / 2} y={M.top} width={casa} height={height - M.top - M.bottom} fill="transparent" />
                {d.acima > 0 && (
                  <rect
                    x={centro(i) - larguraDaBarra / 2}
                    y={meio - escalaY(d.acima)}
                    width={larguraDaBarra}
                    height={Math.max(escalaY(d.acima) - 1, 2)}
                    rx={Math.min(4, larguraDaBarra / 2)}
                    fill="var(--color-signal)"
                  />
                )}
                {d.abaixo > 0 && (
                  <rect
                    x={centro(i) - larguraDaBarra / 2}
                    y={meio + 1}
                    width={larguraDaBarra}
                    height={Math.max(escalaY(d.abaixo) - 1, 2)}
                    rx={Math.min(4, larguraDaBarra / 2)}
                    fill="#b4453a"
                  />
                )}
              </g>
            ))}

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
                <span className="block">
                  {formato(ponto.acima)} <span className="font-normal text-surface/70">{acima.toLowerCase()}</span>
                </span>
                <span className="block">
                  {formato(ponto.abaixo)} <span className="font-normal text-surface/70">{abaixo.toLowerCase()}</span>
                </span>
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

/** O vermelho do produto, para o que está abaixo de zero. */
const VERMELHO = "#b4453a";

/**
 * Uma linha ao longo do tempo que se lê pelo sinal: verde acima de zero,
 * vermelho abaixo.
 *
 * ## Porque é que a cor aqui é dados e não decoração
 *
 * O gráfico responde a uma pergunta de sim ou não — "isto está a ganhar ou a
 * perder?" — e o zero é a fronteira. Pintar a linha conforme o lado em que está
 * poupa a leitura do eixo: vê-se o mês em que atravessa sem procurar o número.
 *
 * Um recorte por cima e outro por baixo do zero desenham a mesma linha duas
 * vezes, cada um com a sua cor. É isso que faz a mudança acontecer **no ponto
 * exacto** em que a linha cruza, e não no mês seguinte.
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
      aria-label="Saldo previsto ao longo dos meses"
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
              <stop offset="0%" stopColor="var(--color-signal)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--color-signal)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id={`${id}-vermelho`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={VERMELHO} stopOpacity={0.18} />
              <stop offset="100%" stopColor={VERMELHO} stopOpacity={0} />
            </linearGradient>
          </defs>

          <Grelha marcas={marcas} y={y} largura={largura} formato={eixo} />

          {/* A linha do zero é a única que se vê melhor do que as outras. */}
          <line
            x1={M.left}
            x2={largura - M.right}
            y1={zero}
            y2={zero}
            stroke="var(--color-line-strong)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />

          <path d={area} fill={`url(#${id}-verde)`} clipPath={`url(#${id}-acima)`} />
          <path d={area} fill={`url(#${id}-vermelho)`} clipPath={`url(#${id}-abaixo)`} />
          <path
            d={linha}
            fill="none"
            stroke="var(--color-signal)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            clipPath={`url(#${id}-acima)`}
          />
          <path
            d={linha}
            fill="none"
            stroke={VERMELHO}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            clipPath={`url(#${id}-abaixo)`}
          />

          <circle
            cx={x(dados.length - 1)}
            cy={y(ultimo.value)}
            r={4}
            fill={ultimo.value < 0 ? VERMELHO : "var(--color-signal)"}
            stroke="var(--color-surface)"
            strokeWidth={2}
          />

          {ponto && (
            <g>
              <line
                x1={x(activo!)}
                x2={x(activo!)}
                y1={M.top}
                y2={height - M.bottom}
                stroke="var(--color-ink-4)"
                strokeWidth={1}
                strokeOpacity={0.6}
              />
              <circle
                cx={x(activo!)}
                cy={y(ponto.value)}
                r={5}
                fill={ponto.value < 0 ? VERMELHO : "var(--color-signal)"}
                stroke="var(--color-surface)"
                strokeWidth={2}
              />
            </g>
          )}

          <EixoX dados={dados} x={x} largura={largura} altura={height} />
        </svg>
      )}

      {ponto && (
        <Tooltip x={x(activo!)} largura={largura} titulo={ponto.label} linhas={ponto.detalhe ?? formato(ponto.value)} />
      )}
    </div>
  );
}

/** A chave de uma série: a marca colorida ao lado do texto, nunca o texto pintado. */
export function Chave({ cor, texto, tracejada }: { cor: string; texto: string; tracejada?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-meta text-ink-3">
      <span
        aria-hidden
        className="block h-[3px] w-4 rounded-full"
        style={tracejada ? { backgroundImage: `repeating-linear-gradient(90deg, ${cor} 0 4px, transparent 4px 7px)` } : { background: cor }}
      />
      {texto}
    </span>
  );
}

/** Um gráfico sem dados chegados ainda — e a dizer porquê. */
export function ChartEmpty({ height, texto = "Ainda não há histórico suficiente." }: { height: number; texto?: string }) {
  return (
    <div className="flex items-center justify-center px-5 text-meta text-ink-4" style={{ height: height + 60 }}>
      {texto}
    </div>
  );
}

/** Um selector de período, do tamanho de um controlo de cabeçalho. */
export function PeriodoSelect({
  valor,
  opcoes,
  onChange,
}: {
  valor: string;
  opcoes: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <select
      aria-label="Período"
      value={valor}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-full bg-sunken px-3 text-meta font-medium text-ink-2"
    >
      {opcoes.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
