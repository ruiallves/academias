import { cx } from "./primitives";

/**
 * As duas caras da área técnica, reconstruídas.
 *
 * Como as outras peças de `shots.tsx`: feitas a partir do produto real, com as
 * cores dele — o relvado dessaturado (#527a5e), o azul dos nossos (#1d3a5f), o
 * creme dos adversários, o laranja dos cones — e não uma paleta inventada para
 * o site. As medidas do campo são as verdadeiras (105×68, círculo de 9,15 m,
 * área de 16,5 m), porque um treinador olha para um campo desenhado e sabe em
 * meio segundo se quem o desenhou já pisou um.
 *
 * Cedem o lugar a capturas verdadeiras em `public/shots/` — ver o LEIA-ME.
 */

/* -------------------------------------------------------------------------- */
/* O editor tático                                                             */
/* -------------------------------------------------------------------------- */

/** Um jogador no quadro — círculo com número, como no editor a sério. */
function Dot({ x, y, n, tone = "us" }: { x: number; y: number; n?: string; tone?: "us" | "them" | "gk" }) {
  const fill = tone === "us" ? "#1d3a5f" : tone === "gk" ? "#b97324" : "#f4f1ea";
  const ink = tone === "them" ? "#3d3a34" : "#fff";
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={1.9} fill={fill} stroke="rgba(255,255,255,0.85)" strokeWidth={0.25} />
      {n && (
        <text y={0.75} textAnchor="middle" fontSize={2.1} fontWeight={700} fill={ink}>
          {n}
        </text>
      )}
    </g>
  );
}

/** Cone de treino — o triângulo laranja de qualquer campo de formação. */
function Cone({ x, y }: { x: number; y: number }) {
  return (
    <path
      d={`M ${x} ${y - 1.3} L ${x + 1.2} ${y + 1.1} L ${x - 1.2} ${y + 1.1} Z`}
      fill="#e0862e"
      stroke="rgba(0,0,0,0.25)"
      strokeWidth={0.15}
    />
  );
}

/** Seta de passe (cheia) ou de deslocamento (tracejada), com ponta. */
function Arrow({ x1, y1, x2, y2, dashed }: { x1: number; y1: number; x2: number; y2: number; dashed?: boolean }) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const tip = (da: number) => `${x2 - 2.1 * Math.cos(a + da)},${y2 - 2.1 * Math.sin(a + da)}`;
  return (
    <g stroke="#fff" strokeWidth={0.45} fill="none" opacity={0.95}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} strokeDasharray={dashed ? "1.4 1" : undefined} />
      <polygon points={`${x2},${y2} ${tip(0.42)} ${tip(-0.42)}`} fill="#fff" stroke="none" />
    </g>
  );
}

/**
 * O editor com um exercício a meio: pressão após perda no meio-campo ofensivo.
 *
 * A barra de ferramentas em cima, o campo de onze ao centro com uma zona
 * marcada, e a régua de frames em baixo com o play — os três planos do editor
 * real, à escala de um cartaz.
 */
export function CampoTaticoShot({ className }: { className?: string }) {
  const tools = ["Seleção", "Jogador", "Adversário", "Bola", "Cone", "Zona", "Passe", "Deslocamento", "Condução"];
  return (
    <div className={cx("shot flex flex-col bg-[#f6f5f2] text-[#1a1917]", className)} aria-hidden>
      {/* A barra de ferramentas */}
      <div className="flex items-center gap-1 overflow-hidden border-b border-[#e5e2dc] bg-white px-2.5 py-1.5">
        {tools.map((t, i) => (
          <span
            key={t}
            className={cx(
              "rounded-[3px] px-1.5 py-[3px] text-[7.5px] font-medium whitespace-nowrap",
              i === 6 ? "bg-[#1a1917] text-white" : "text-[#524f48]",
              i > 6 && "hidden sm:inline",
            )}
          >
            {t}
          </span>
        ))}
        <span className="ml-auto hidden items-center gap-1 text-[7.5px] text-[#8a867c] md:flex">
          <span className="rounded-[3px] border border-[#e5e2dc] px-1.5 py-[3px]">↶</span>
          <span className="rounded-[3px] border border-[#e5e2dc] px-1.5 py-[3px]">↷</span>
          <span className="rounded-[3px] border border-[#e5e2dc] px-1.5 py-[3px] font-medium">Guardar</span>
        </span>
      </div>

      {/* O campo — medidas reais de futebol 11, relva dessaturada do editor. */}
      <svg viewBox="-3 -3 111 74" className="block w-full flex-1" preserveAspectRatio="xMidYMid meet">
        <rect x={-3} y={-3} width={111} height={74} fill="#527a5e" />
        <g stroke="rgba(255,255,255,0.75)" strokeWidth={0.35} fill="none">
          <rect x={0} y={0} width={105} height={68} />
          <line x1={52.5} y1={0} x2={52.5} y2={68} />
          <circle cx={52.5} cy={34} r={9.15} />
          {/* Áreas: 16,5 × 40,32 e 5,5 × 18,32 — as verdadeiras. */}
          <rect x={0} y={13.84} width={16.5} height={40.32} />
          <rect x={0} y={24.84} width={5.5} height={18.32} />
          <rect x={88.5} y={13.84} width={16.5} height={40.32} />
          <rect x={99.5} y={24.84} width={5.5} height={18.32} />
        </g>
        <circle cx={52.5} cy={34} r={0.5} fill="rgba(255,255,255,0.75)" />
        <circle cx={11} cy={34} r={0.5} fill="rgba(255,255,255,0.75)" />
        <circle cx={94} cy={34} r={0.5} fill="rgba(255,255,255,0.75)" />

        {/* A zona de pressão, tracejada a amarelo como no editor. */}
        <rect
          x={58}
          y={12}
          width={30}
          height={26}
          rx={0.4}
          fill="rgba(255,214,90,0.18)"
          stroke="rgba(255,214,90,0.9)"
          strokeWidth={0.3}
          strokeDasharray="1.2 0.8"
        />
        <text x={73} y={14.6} textAnchor="middle" fontSize={1.9} fontWeight={600} fill="#fff">
          Zona de pressão
        </text>

        {/* Cones do corredor */}
        <Cone x={57} y={44} />
        <Cone x={66} y={48} />
        <Cone x={75} y={51} />

        {/* Os nossos, em pressão */}
        <Dot x={62} y={18} n="7" />
        <Dot x={66} y={30} n="10" />
        <Dot x={74} y={22} n="9" />
        <Dot x={60} y={36} n="8" />
        <Dot x={47} y={30} n="6" />

        {/* Eles, a tentar sair */}
        <Dot x={70} y={17} tone="them" />
        <Dot x={78} y={28} tone="them" />
        <Dot x={71} y={34} tone="them" />
        <Dot x={96} y={34} tone="gk" n="GR" />

        {/* Bola junto ao portador */}
        <circle cx={79.6} cy={29.4} r={0.9} fill="#fff" stroke="#1f2937" strokeWidth={0.2} />

        {/* Passe (cheio) e deslocamentos de pressão (tracejados). */}
        <Arrow x1={78} y1={28} x2={71.8} y2={33.2} />
        <Arrow x1={74} y1={22} x2={77} y2={26.4} dashed />
        <Arrow x1={66} y1={30} x2={70.2} y2={33} dashed />
        <Arrow x1={62} y1={18} x2={68.6} y2={17.2} dashed />
      </svg>

      {/* A régua de frames — a animação, com o play. */}
      <div className="flex items-center gap-2 border-t border-[#e5e2dc] bg-white px-2.5 py-1.5">
        <span className="flex size-[16px] items-center justify-center rounded-full bg-[#1a1917] text-[7px] text-white">
          ▶
        </span>
        {["1", "2", "3", "4"].map((f) => (
          <span
            key={f}
            className={cx(
              "flex h-[14px] w-[20px] items-center justify-center rounded-[2px] border text-[7px] font-medium tabular",
              f === "2" ? "border-[#1a1917] bg-[#efede8]" : "border-[#e5e2dc] text-[#8a867c]",
            )}
          >
            {f}
          </span>
        ))}
        <span className="text-[7px] text-[#8a867c]">Frame 2 de 4</span>
        <span className="ml-auto hidden text-[7.5px] font-medium text-[#524f48] sm:block">
          Pressão após perda · 3+GR v 5 · 18 min
        </span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* O plano de treino                                                           */
/* -------------------------------------------------------------------------- */

const BLOCOS = [
  { n: "1", t: "Ativação com bola", d: "12 min · Int 4 · Técnico" },
  { n: "2", t: "Rondo 4v2 — dois toques", d: "15 min · Int 6 · Técnico", img: true },
  { n: "3", t: "Pressão após perda 3+GR v 5", d: "18 min · Int 8 · Transições", img: true, on: true },
  { n: "4", t: "Jogo condicionado 7v7", d: "25 min · Int 7 · Org. ofensiva" },
  { n: "5", t: "Finalização e retorno à calma", d: "20 min · Int 5 · Técnico" },
];

const OBJETIVOS = [
  { t: "Transições", m: 33, c: "#a85a20" },
  { t: "Técnico", m: 27, c: "#1d5f8a" },
  { t: "Org. ofensiva", m: 25, c: "#0f6b62" },
  { t: "Físico", m: 5, c: "#7a5aa0" },
];

/**
 * O planeador de uma sessão: os blocos à esquerda — com a pega de arrastar e a
 * miniatura do exercício importado da biblioteca — e a carga derivada à
 * direita, com o tempo por objetivo em barras. É o ecrã `/treinos/:id` real,
 * condensado.
 */
export function PlanoTreinoShot({ className }: { className?: string }) {
  const total = OBJETIVOS.reduce((a, o) => a + o.m, 0);
  return (
    <div className={cx("shot bg-[#f6f5f2] p-3 text-[11px] text-[#1a1917]", className)} aria-hidden>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div>
          <div className="text-[7px] font-semibold tracking-[0.12em] text-[#8a867c] uppercase">Plano de treino</div>
          <div className="text-[12px] leading-tight font-semibold tracking-[-0.02em]">Sub-13 Futebol · Ter, 19:30</div>
        </div>
        <span className="rounded-[3px] bg-[#1a1917] px-2 py-1 text-[7.5px] font-medium text-white">Guardar plano</span>
      </div>

      <div className="grid gap-1.5 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* Os blocos */}
        <div className="overflow-hidden rounded-[3px] border border-[#e5e2dc] bg-white">
          <div className="flex items-baseline justify-between border-b border-[#e5e2dc] px-2.5 py-1.5">
            <span className="text-[9px] font-semibold">Blocos</span>
            <span className="text-[7.5px] text-[#8a867c]">90 min · arrasta para ordenar</span>
          </div>
          {BLOCOS.map((b) => (
            <div
              key={b.n}
              className={cx(
                "flex items-center gap-2 border-b border-[#efede8] px-2.5 py-[5px] last:border-0",
                b.on && "bg-[#f2f6f4]",
              )}
            >
              <span className="text-[8px] leading-none tracking-tight text-[#ada89d]">≡</span>
              <span className="w-3 text-[8px] font-semibold text-[#8a867c] tabular">{b.n}</span>
              {b.img && (
                <span className="h-[16px] w-[22px] shrink-0 overflow-hidden rounded-[2px] bg-[#527a5e]">
                  <svg viewBox="0 0 22 16" className="block h-full w-full">
                    <rect x={2} y={1.5} width={18} height={13} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={0.5} />
                    <circle cx={11} cy={8} r={2.6} fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth={0.5} />
                    <circle cx={7} cy={6} r={1.1} fill="#1d3a5f" />
                    <circle cx={14} cy={10} r={1.1} fill="#1d3a5f" />
                    <circle cx={12} cy={5} r={1.1} fill="#f4f1ea" />
                  </svg>
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[8.5px] font-medium">{b.t}</span>
                <span className="block truncate text-[7.5px] text-[#8a867c]">{b.d}</span>
              </span>
              {b.on && (
                <span className="shrink-0 rounded-[2px] border border-[#e5e2dc] px-1 py-[2px] text-[6.5px] font-medium text-[#524f48]">
                  Abrir no editor
                </span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 px-2.5 py-[5px] text-[7.5px] font-medium text-[#0f6b62]">
            + Novo bloco <span className="text-[#ada89d]">·</span> Importar da biblioteca
          </div>
        </div>

        {/* A carga derivada */}
        <div className="flex flex-col gap-1.5">
          <div className="rounded-[3px] border border-[#e5e2dc] bg-white px-2.5 py-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-semibold">Carga estimada</span>
              <span className="text-[7px] text-[#8a867c]">derivada dos blocos</span>
            </div>
            <div className="mt-1.5 grid grid-cols-3 gap-1.5">
              {[
                ["Volume", "90", "min"],
                ["Intensidade", "6,3", "/10"],
                ["Carga", "567", "u.a."],
              ].map(([l, v, u]) => (
                <div key={l}>
                  <div className="text-[6.5px] text-[#8a867c]">{l}</div>
                  <div className="text-[13px] leading-none font-semibold tracking-[-0.03em] tabular">
                    {v}
                    <span className="ml-0.5 text-[7px] font-normal text-[#ada89d]">{u}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 rounded-[3px] border border-[#e5e2dc] bg-white px-2.5 py-2">
            <div className="text-[9px] font-semibold">Tempo por objetivo</div>
            <div className="mt-1.5 space-y-1.5">
              {OBJETIVOS.map((o) => (
                <div key={o.t}>
                  <div className="flex items-baseline justify-between text-[7.5px]">
                    <span className="font-medium">{o.t}</span>
                    <span className="text-[#8a867c] tabular">{o.m} min</span>
                  </div>
                  <div className="mt-[2px] h-[4px] overflow-hidden rounded-full bg-[#efede8]">
                    <span className="block h-full rounded-full" style={{ width: `${(o.m / total) * 100}%`, background: o.c }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 border-t border-[#efede8] pt-1.5 text-[7px] leading-snug text-[#8a867c]">
              Visível para o clube · treinador Rui Machado
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
