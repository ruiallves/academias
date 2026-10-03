import { useEffect, useId, useRef } from "react";
import { cx } from "@/components/primitives";
import { FORMAT_PITCH, type GameFormat } from "@/lib/training";

/**
 * O campo do Match Center: o relvado, as linhas e os jogadores.
 *
 * ## Desenhado aqui, e não reaproveitado do editor
 *
 * O editor de exercícios tem o seu campo, feito para se desenhar por cima. Este
 * é para se olhar: de pé (ataca-se para cima, como numa folha de equipa), com
 * as faixas do corte da relva, as linhas a branco e os jogadores como peças
 * com fotografia, número e nome. As medidas vêm da mesma tabela
 * (`FORMAT_PITCH`), por isso um futebol 7 continua a ter a área de um futebol 7.
 *
 * ## As coordenadas
 *
 * As posições guardam-se no sistema do campo deitado (x ao comprido, da nossa
 * baliza para a deles; y de uma linha lateral à outra), que é o dos modelos de
 * jogo. Aqui roda-se: o x passa a subir no ecrã. O basquetebol fica deitado,
 * porque um sistema de basquetebol é meio campo.
 *
 * É uma peça só de desenho: recebe as posições e os jogadores já resolvidos, e
 * devolve o que o utilizador fez. Não sabe de jogos nem de planos.
 */

export type PecaNoCampo = {
  id: string;
  label: string;
  x: number;
  y: number;
  jogador?: { numero: number | null; nome: string; foto?: string | null; marca?: "C" | "SC" | null; aviso?: boolean } | null;
};

const RELVA = ["#3f9a63", "#388f5a"] as const;
const PISO = ["#3d78a8", "#3d78a8"] as const;
const MADEIRA = ["#d9a566", "#d39d5c"] as const;
const LINHA = "rgba(255,255,255,0.92)";

export function PitchBoard({
  format,
  pecas,
  escolhida,
  onEscolher,
  onMover,
  onLargar,
  aReceber,
  alvo,
  compacto,
  className,
}: {
  format: GameFormat;
  pecas: PecaNoCampo[];
  escolhida?: string | null;
  /** Sem isto, o campo é só de leitura. */
  onEscolher?: (id: string | null) => void;
  onMover?: (id: string, x: number, y: number) => void;
  /** Um jogador largado numa posição (arrastado da lista). */
  onLargar?: (athleteId: string, slotId: string) => void;
  /** Há um jogador a ser arrastado: as posições mostram que o recebem. */
  aReceber?: boolean;
  /** A posição por cima da qual o jogador arrastado está. */
  alvo?: string | null;
  /** Sem nomes por baixo das peças: para a miniatura da visão geral. */
  compacto?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const arrasto = useRef<{ id: string; dx: number; dy: number; moveu: boolean } | null>(null);

  /*
   * No telemóvel, a relva rola a página e só os jogadores se agarram.
   *
   * O campo inteiro com `touch-none` prendia o dedo: quem o tinha à frente
   * não conseguia descer. Agora só as peças recusam rolar, e com uma peça na
   * mão o `touchmove` é travado aqui, porque o Safari nem sempre respeita o
   * `touch-action` dentro de um SVG.
   */
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const travar = (e: TouchEvent) => {
      if (arrasto.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", travar, { passive: false });
    return () => el.removeEventListener("touchmove", travar);
  }, []);
  const s = FORMAT_PITCH[format] ?? FORMAT_PITCH.f11;
  // O basquetebol desenha-se em meio campo: os sistemas são de ataque posicional, junto ao cesto.
  const meioCampo = s.kind === "basketball";
  const editavel = Boolean(onEscolher);

  // O tamanho no ecrã: de pé, a largura é a largura do campo.
  const W = s.h;
  const H = meioCampo ? s.w / 2 : s.w;
  const m = W * (meioCampo ? 0.07 : 0.045);
  /** Do campo (x ao comprido, y ao largo) para o ecrã: o x passa a subir. */
  const tela = (x: number, y: number) => ({ X: y, Y: Math.min(H, s.w - x) });
  /** Do ecrã para o campo. */
  const campo = (X: number, Y: number) => ({ x: s.w - Y, y: X });

  // As peças são maiores quando há menos jogadores no campo.
  const n = pecas.length;
  const r = W * (meioCampo ? 0.062 : n <= 5 ? 0.082 : n <= 7 ? 0.074 : n <= 9 ? 0.064 : 0.056);
  const t = 0.0032 * W + 0.12; // espessura das linhas

  const doRato = (clientX: number, clientY: number) => {
    const b = svg.current!.getBoundingClientRect();
    const vw = W + 2 * m;
    const vh = H + 2 * m;
    const e = Math.min(b.width / vw, b.height / vh);
    return { X: -m + (clientX - b.left - (b.width - vw * e) / 2) / e, Y: -m + (clientY - b.top - (b.height - vh * e) / 2) / e };
  };

  const cores = meioCampo ? MADEIRA : s.indoor ? PISO : RELVA;
  const faixas = meioCampo || s.indoor ? 1 : 12;

  return (
    <svg
      ref={svg}
      viewBox={`${-m} ${-m} ${W + 2 * m} ${H + 2 * m}`}
      className={cx("block w-full select-none", className)}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="O campo e os jogadores"
      onPointerMove={(e) => {
        const d = arrasto.current;
        if (!d || !onMover) return;
        const p = doRato(e.clientX, e.clientY);
        const X = Math.max(r * 0.6, Math.min(W - r * 0.6, p.X + d.dx));
        const Y = Math.max(r * 0.6, Math.min(H - r * 0.6, p.Y + d.dy));
        const peca = pecas.find((z) => z.id === d.id);
        if (!peca) return;
        const onde = tela(peca.x, peca.y);
        // Um toque não é um arrasto: só mexe depois de sair do sítio.
        if (!d.moveu && Math.hypot(X - onde.X, Y - onde.Y) < r * 0.45) return;
        d.moveu = true;
        const c = campo(X, Y);
        onMover(d.id, c.x, c.y);
      }}
      onPointerUp={() => {
        const d = arrasto.current;
        arrasto.current = null;
        if (d && !d.moveu) onEscolher?.(d.id === escolhida ? null : d.id);
      }}
      onPointerLeave={() => {
        arrasto.current = null;
      }}
      onPointerCancel={() => {
        arrasto.current = null;
      }}
    >
      <defs>
        <clipPath id={`campo-${uid}`}>
          <rect x={-m} y={-m} width={W + 2 * m} height={H + 2 * m} rx={m * 1.1} />
        </clipPath>
        <clipPath id={`foto-${uid}`}>
          <circle r={r * 0.86} />
        </clipPath>
      </defs>

      {/* O piso: as faixas do corte da relva, ou o piso liso de um pavilhão. */}
      <g clipPath={`url(#campo-${uid})`}>
        <rect x={-m} y={-m} width={W + 2 * m} height={H + 2 * m} fill={cores[0]} />
        {Array.from({ length: faixas }, (_, i) =>
          i % 2 === 1 ? <rect key={i} x={-m} y={(H / faixas) * i} width={W + 2 * m} height={H / faixas} fill={cores[1]} /> : null,
        )}
      </g>

      {/* As linhas. */}
      <g fill="none" stroke={LINHA} strokeWidth={t} strokeLinecap="round" strokeLinejoin="round">
        {meioCampo ? <Quadra s={s} /> : <Relvado s={s} t={t} />}
      </g>

      {/* Os jogadores. */}
      {pecas.map((p) => {
        const { X, Y } = tela(p.x, p.y);
        const on = p.id === escolhida;
        const j = p.jogador;
        const nome = j ? j.nome : "";
        const fonte = r * 0.5;
        const largura = Math.min(W * 0.3, Math.max(r * 2.2, nome.length * fonte * 0.56 + fonte * 1.1));
        return (
          <g
            key={p.id}
            transform={`translate(${X} ${Y})`}
            className={cx("outline-none", editavel && "cursor-pointer touch-none", "[&:focus-visible_.anel]:opacity-100")}
            role={editavel ? "button" : undefined}
            tabIndex={editavel ? 0 : undefined}
            aria-label={`${p.label}: ${j ? j.nome : "por preencher"}`}
            data-drop={`slot:${p.id}`}
            onPointerDown={(e) => {
              if (!editavel) return;
              (e.currentTarget.ownerSVGElement as Element).setPointerCapture(e.pointerId);
              const q = doRato(e.clientX, e.clientY);
              arrasto.current = { id: p.id, dx: X - q.X, dy: Y - q.Y, moveu: false };
            }}
            onKeyDown={(e) => {
              if (editavel && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onEscolher?.(on ? null : p.id);
              }
            }}
            onDragOver={(e) => onLargar && e.preventDefault()}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("text/plain");
              if (id) onLargar?.(id, p.id);
            }}
          >
            {/* O anel de "escolhida" (e de foco pelo teclado). */}
            <circle className="anel transition-opacity duration-150" r={r * 1.42} fill="rgba(255,255,255,0.18)" stroke="#fff" strokeWidth={t * 1.4} opacity={on || alvo === p.id ? 1 : 0} />
            {/* Com um jogador no ar, cada posição pulsa: "podes largar aqui". */}
            {aReceber && alvo !== p.id && <circle className="mc-pulso" r={r * 1.3} fill="none" stroke="#fff" strokeWidth={t * 1.2} />}

            {/* A peça cresce quando o jogador está por cima, e salta ao entrar. */}
            <g key={j ? `${j.numero}-${j.nome}` : "vazia"} className="mc-pop">
            <g style={{ transform: alvo === p.id ? "scale(1.16)" : "scale(1)", transformBox: "fill-box", transformOrigin: "center", transition: "transform 160ms cubic-bezier(0.22,1,0.36,1)" }}>

            {j ? (
              <>
                <ellipse cy={r * 1.02} rx={r * 0.8} ry={r * 0.22} fill="rgba(0,0,0,0.22)" />
                <circle r={r} fill="#fff" />
                {j.foto ? (
                  <image href={j.foto} x={-r * 0.86} y={-r * 0.86} width={r * 1.72} height={r * 1.72} preserveAspectRatio="xMidYMid slice" clipPath={`url(#foto-${uid})`} />
                ) : (
                  <>
                    <circle r={r * 0.86} fill="var(--color-signal-strong)" />
                    <text y={r * 0.3} textAnchor="middle" fontSize={r * 0.86} fontWeight={700} fill="var(--color-signal-on)" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {j.numero ?? "–"}
                    </text>
                  </>
                )}
                {/* Com fotografia, o número vai num selo ao canto. */}
                {j.foto && (
                  <g transform={`translate(${-r * 0.74} ${r * 0.66})`}>
                    <circle r={r * 0.42} fill="#14130f" stroke="#fff" strokeWidth={t} />
                    <text y={r * 0.15} textAnchor="middle" fontSize={r * 0.44} fontWeight={700} fill="#fff" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {j.numero ?? "–"}
                    </text>
                  </g>
                )}
                {j.marca && (
                  <g transform={`translate(${r * 0.76} ${-r * 0.7})`}>
                    <circle r={r * 0.42} fill="#f4c542" stroke="#fff" strokeWidth={t} />
                    <text y={r * 0.15} textAnchor="middle" fontSize={j.marca === "C" ? r * 0.48 : r * 0.36} fontWeight={800} fill="#14130f">
                      {j.marca}
                    </text>
                  </g>
                )}
                {j.aviso && <circle cx={r * 0.78} cy={r * 0.62} r={r * 0.24} fill="#e0892b" stroke="#fff" strokeWidth={t} />}
                {!compacto && (
                  <g transform={`translate(0 ${r * 1.62})`}>
                    <rect x={-largura / 2} y={-fonte * 0.82} width={largura} height={fonte * 1.64} rx={fonte * 0.82} fill="#fff" />
                    <text y={fonte * 0.34} textAnchor="middle" fontSize={fonte} fontWeight={600} fill="#14130f">
                      {nome}
                    </text>
                  </g>
                )}
              </>
            ) : (
              <>
                <circle r={r} fill="rgba(255,255,255,0.16)" stroke="#fff" strokeWidth={t * 1.2} strokeDasharray={`${r * 0.34} ${r * 0.26}`} />
                <text y={r * 0.26} textAnchor="middle" fontSize={r * 0.72} fontWeight={700} fill="#fff" letterSpacing={r * 0.02}>
                  {p.label}
                </text>
              </>
            )}
            </g>
            </g>
          </g>
        );
      })}
    </svg>
  );
}

type Spec = (typeof FORMAT_PITCH)[GameFormat];

/** As linhas de um campo de futebol (ou de futsal), de pé. */
function Relvado({ s, t }: { s: Spec; t: number }) {
  const W = s.h;
  const H = s.w;
  const cx0 = W / 2;
  /** Uma área, encostada à linha de fundo de cima (`topo`) ou de baixo. */
  const area = (depth: number, width: number, topo: boolean) => (
    <rect x={cx0 - width / 2} y={topo ? 0 : H - depth} width={width} height={depth} />
  );
  const marca = (dist: number, topo: boolean) => <circle cx={cx0} cy={topo ? dist : H - dist} r={t * 0.9} fill={LINHA} stroke="none" />;

  return (
    <>
      <rect x={0} y={0} width={W} height={H} />
      <path d={`M0 ${H / 2}H${W}`} />
      <circle cx={cx0} cy={H / 2} r={s.circle} />
      <circle cx={cx0} cy={H / 2} r={t * 0.9} fill={LINHA} stroke="none" />

      {[true, false].map((topo) => (
        <g key={String(topo)}>
          {s.box && area(s.box.depth, s.box.width, topo)}
          {s.goalArea && area(s.goalArea.depth, s.goalArea.width, topo)}
          {s.penalty > 0 && marca(s.penalty, topo)}
          {s.secondPenalty && marca(s.secondPenalty, topo)}

          {/* A meia-lua, onde o círculo de 9,15 m sai da área. */}
          {s.box && s.penalty > 0 && s.circle > s.box.depth - s.penalty && (() => {
            const dy = s.box.depth - s.penalty;
            const dx = Math.sqrt(s.circle * s.circle - dy * dy);
            const y = topo ? s.box.depth : H - s.box.depth;
            return <path d={`M${cx0 - dx} ${y}A${s.circle} ${s.circle} 0 0 ${topo ? 0 : 1} ${cx0 + dx} ${y}`} />;
          })()}

          {/* O futsal: a área são dois quartos de círculo e uma reta. */}
          {s.arc && (() => {
            const a = s.arc;
            const g = s.goal / 2;
            const y0 = topo ? 0 : H;
            const y1 = topo ? a : H - a;
            return <path d={`M${cx0 - g - a} ${y0}A${a} ${a} 0 0 ${topo ? 0 : 1} ${cx0 - g} ${y1}H${cx0 + g}A${a} ${a} 0 0 ${topo ? 0 : 1} ${cx0 + g + a} ${y0}`} />;
          })()}

          {/* A baliza, por fora da linha. */}
          {s.goal > 0 && <rect x={cx0 - s.goal / 2} y={topo ? -W * 0.022 : H} width={s.goal} height={W * 0.022} />}
        </g>
      ))}

      {/* Os cantos. */}
      {!s.indoor &&
        [
          [0, 0, 1, 0],
          [W, 0, 0, 1],
          [0, H, 0, 0],
          [W, H, 1, 1],
        ].map(([x, y], i) => {
          const q = W * 0.016;
          const sx = x === 0 ? 1 : -1;
          const sy = y === 0 ? 1 : -1;
          return <path key={i} d={`M${x + sx * q} ${y}A${q} ${q} 0 0 ${sx * sy > 0 ? 1 : 0} ${x} ${y + sy * q}`} />;
        })}
    </>
  );
}

/**
 * As linhas de meio campo de basquetebol, de pé: o cesto em cima, a linha de
 * meio campo em baixo.
 */
function Quadra({ s }: { s: Spec }) {
  const c = s.court;
  if (!c) return null;
  const W = s.h;
  const H = s.w / 2;
  const cx0 = W / 2;
  // Onde a linha de três deixa de ser reta e passa a arco.
  const dx = cx0 - c.three.side;
  const dy = Math.sqrt(Math.max(0, c.three.radius ** 2 - dx ** 2));
  const yArco = c.basket + dy;
  return (
    <>
      <rect x={0} y={0} width={W} height={H} />
      {/* O garrafão e o semicírculo de lance livre. */}
      <rect x={cx0 - c.key.width / 2} y={0} width={c.key.width} height={c.key.depth} />
      <path d={`M${cx0 - c.freeThrow} ${c.key.depth}A${c.freeThrow} ${c.freeThrow} 0 0 0 ${cx0 + c.freeThrow} ${c.key.depth}`} />
      {/* A linha de três pontos: duas retas e o arco. */}
      <path d={`M${c.three.side} 0V${yArco}A${c.three.radius} ${c.three.radius} 0 0 0 ${W - c.three.side} ${yArco}V0`} />
      {/* A tabela e o aro. */}
      <path d={`M${cx0 - c.board.width / 2} ${c.board.at}H${cx0 + c.board.width / 2}`} />
      <circle cx={cx0} cy={c.basket} r={c.ring} />
      {/* Meio círculo central, na linha de meio campo. */}
      <path d={`M${cx0 - s.circle} ${H}A${s.circle} ${s.circle} 0 0 1 ${cx0 + s.circle} ${H}`} />
    </>
  );
}
