import type { ReactNode } from "react";
import { cx } from "@/components/primitives";

/**
 * As peças do Match Center.
 *
 * A área dos Jogos tem uma linguagem um pouco sua: cartões brancos de cantos
 * largos sobre o fundo da página, com uma sombra muito leve, letra grande nos
 * números e muito ar. É o desenho de uma aplicação de desporto moderna, sem
 * brilhos nem degradés. As cores, a letra e os controlos continuam a ser os da
 * consola: a diferença está na forma e na escala.
 *
 * Tudo aqui é só desenho. Nenhuma destas peças lê a sessão nem o armazém, e é
 * por isso que se conseguem ver e afinar fora da consola (ver `dev/harness`).
 */

export type Tom = "neutro" | "aviso" | "ok" | "vivo" | "risco";

/** Um cartão: a superfície base de tudo nesta área. */
export function Cartao({ className, children, as: Tag = "section" }: { className?: string; children: ReactNode; as?: "section" | "div" | "aside" }) {
  return (
    <Tag
      className={cx(
        "min-w-0 rounded-[20px] border border-line/80 bg-surface shadow-[0_1px_2px_rgb(26_25_23/0.04),0_16px_36px_-24px_rgb(26_25_23/0.22)]",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** O cabeçalho de um cartão: o título, uma linha de apoio e as ações à direita. */
export function CartaoTopo({ titulo, apoio, children }: { titulo: string; apoio?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 pt-4 pb-3">
      <div className="min-w-0">
        <h3 className="text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">{titulo}</h3>
        {apoio && <p className="mt-0.5 text-meta text-ink-3">{apoio}</p>}
      </div>
      {children && <div className="flex min-w-0 flex-wrap items-center gap-1.5 max-sm:w-full">{children}</div>}
    </header>
  );
}

const TOM: Record<Tom, string> = {
  neutro: "bg-sunken text-ink-2",
  aviso: "bg-warn-soft text-warn",
  ok: "bg-ok-soft text-ok",
  risco: "bg-risk-soft text-risk",
  vivo: "bg-ink text-surface",
};

/** O estado de um jogo, numa pastilha. */
export function EstadoChip({ texto, tom, grande }: { texto: string; tom: Tom; grande?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full font-medium whitespace-nowrap", grande ? "h-7 px-3 text-meta" : "h-6 px-2.5 text-[11.5px]", TOM[tom])}>
      <span aria-hidden className={cx("size-1.5 rounded-full bg-current", tom === "vivo" && "animate-pulse")} />
      {texto}
    </span>
  );
}

/** As iniciais de um nome de clube: "CD Loureiro" → "CL", "Ferreirense" → "FE". */
export function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter((p) => p.length > 1 || /\d/.test(p));
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * O emblema de uma equipa.
 *
 * O nosso é o símbolo do clube (ou as iniciais sobre a cor do clube). O do
 * adversário são as iniciais sobre cinzento: não temos o símbolo dele, e um
 * círculo com letras é mais honesto do que um escudo inventado.
 */
export function Emblema({ nome, logo, nosso, tamanho = 56 }: { nome: string; logo?: string | null; nosso?: boolean; tamanho?: number }) {
  const raio = Math.round(tamanho * 0.3);
  if (nosso && logo) {
    return (
      <span className="flex shrink-0 items-center justify-center overflow-hidden border border-line bg-surface" style={{ width: tamanho, height: tamanho, borderRadius: raio }}>
        <img src={logo} alt="" className="size-full object-contain p-[12%]" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cx("flex shrink-0 items-center justify-center font-semibold tracking-[-0.02em]", nosso ? "bg-signal-strong text-signal-on" : "bg-sunken text-ink-2")}
      style={{ width: tamanho, height: tamanho, borderRadius: raio, fontSize: tamanho * 0.34 }}
    >
      {iniciais(nome)}
    </span>
  );
}

/** Um anel de progresso, com o número ao centro. */
export function Anel({ valor, total, tamanho = 44, children }: { valor: number; total: number; tamanho?: number; children?: ReactNode }) {
  const r = (tamanho - 6) / 2;
  const c = 2 * Math.PI * r;
  const f = total > 0 ? Math.min(1, valor / total) : 0;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: tamanho, height: tamanho }}>
      <svg width={tamanho} height={tamanho} className="-rotate-90" aria-hidden>
        <circle cx={tamanho / 2} cy={tamanho / 2} r={r} fill="none" stroke="var(--color-sunken)" strokeWidth={5} />
        {f > 0 && <circle
          cx={tamanho / 2}
          cy={tamanho / 2}
          r={r}
          fill="none"
          stroke={f >= 1 ? "var(--color-ok)" : "var(--color-ink)"}
          strokeWidth={5}
          strokeLinecap="round"
          strokeDasharray={`${c * f} ${c}`}
          className="transition-[stroke-dasharray] duration-500"
        />}
      </svg>
      <span className="absolute text-[11px] font-semibold text-ink tabular">{children ?? `${valor}/${total}`}</span>
    </span>
  );
}

/** A fotografia de um jogador, ou o número dele num círculo. */
export function Camisola({ numero, foto, tom = "neutro", tamanho = 36 }: { numero: number | null; foto?: string | null; tom?: "clube" | "tinta" | "neutro"; tamanho?: number }) {
  return (
    <span className="relative inline-flex shrink-0" style={{ width: tamanho, height: tamanho }}>
      {foto ? (
        <img src={foto} alt="" className="size-full rounded-full object-cover" />
      ) : (
        <span
          className={cx(
            "flex size-full items-center justify-center rounded-full font-semibold tabular",
            tom === "clube" ? "bg-signal-strong text-signal-on" : tom === "tinta" ? "bg-ink text-surface" : "bg-sunken text-ink-2",
          )}
          style={{ fontSize: tamanho * 0.38 }}
        >
          {numero ?? "–"}
        </span>
      )}
      {foto && (
        <span
          className={cx(
            "absolute -right-1 -bottom-1 flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] leading-[18px] font-semibold ring-2 ring-surface tabular",
            tom === "clube" ? "bg-signal-strong text-signal-on" : "bg-ink text-surface",
          )}
        >
          {numero ?? "–"}
        </span>
      )}
    </span>
  );
}

/**
 * As áreas do jogo, numa barra de pastilhas.
 *
 * A que está aberta fica branca e elevada, como num seletor segmentado. Cada
 * uma leva um ponto verde quando está feita, para se ver o que falta sem abrir.
 * No telemóvel a barra rola para o lado.
 */
export function AbasDoJogo<T extends string>({
  abas,
  ativa,
  onIr,
}: {
  abas: { key: T; label: string; feito?: boolean; nota?: string }[];
  ativa: T;
  onIr: (key: T) => void;
}) {
  return (
    <nav aria-label="Áreas do jogo" className="scroll-x-clean -mx-1 overflow-x-auto px-1">
      <ol className="inline-flex min-w-full gap-1 rounded-[16px] bg-sunken p-1 sm:min-w-0">
        {abas.map((a) => {
          const on = a.key === ativa;
          return (
            <li key={a.key} className="shrink-0 grow sm:grow-0">
              <button
                type="button"
                aria-current={on ? "page" : undefined}
                onClick={() => onIr(a.key)}
                className={cx(
                  "flex h-10 w-full items-center justify-center gap-2 rounded-[12px] px-4 text-body font-medium whitespace-nowrap transition-all duration-150",
                  on ? "bg-surface text-ink shadow-[0_1px_2px_rgb(26_25_23/0.08),0_4px_12px_-6px_rgb(26_25_23/0.2)]" : "text-ink-3 hover:text-ink",
                )}
              >
                {a.label}
                {a.feito ? (
                  <span aria-label="feito" className="size-1.5 rounded-full bg-ok" />
                ) : a.nota ? (
                  <span className={cx("text-[11px] font-normal", on ? "text-ink-3" : "text-ink-4")}>{a.nota}</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** Um par rótulo e valor, para as listas de factos. */
export function Facto({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <dt className="shrink-0 text-meta text-ink-3">{rotulo}</dt>
      <dd className="min-w-0 text-right text-body font-medium text-ink">{children}</dd>
    </div>
  );
}

/** Um estado vazio, dentro de um cartão. */
export function Vazio({ icone, titulo, texto, children }: { icone?: ReactNode; titulo: string; texto?: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      {icone && <span className="mx-auto flex size-12 items-center justify-center rounded-[14px] bg-sunken text-ink-3">{icone}</span>}
      <h3 className={cx("text-[16px] font-semibold tracking-[-0.01em] text-ink", icone ? "mt-4" : null)}>{titulo}</h3>
      {texto && <p className="mx-auto mt-1 max-w-[440px] text-meta leading-relaxed text-ink-3">{texto}</p>}
      {children && <div className="mt-4 flex justify-center">{children}</div>}
    </div>
  );
}
