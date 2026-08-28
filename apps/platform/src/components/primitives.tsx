import type { ReactNode } from "react";

export const cx = (...xs: (string | false | undefined | null)[]) => xs.filter(Boolean).join(" ");

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx("panel", className)}>{children}</section>;
}

export function PanelHead({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <header className="panel-head">
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h2 className="text-panel text-ink">{title}</h2>
        {hint && <span className="truncate text-meta text-ink-3">{hint}</span>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-1.5">{children}</div>}
    </header>
  );
}

type Tone = "neutral" | "ok" | "warn" | "risk" | "signal";

const TONE: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  ok: "bg-[#e6f2e9] text-[#1f7a45]",
  warn: "bg-[#fdf1dd] text-[#8a5a12]",
  risk: "bg-[#fae9e7] text-[#a82a20]",
  signal: "bg-signal-soft text-signal-ink",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center justify-center rounded-full px-2 py-0.5 text-center text-[11px] leading-tight font-semibold", TONE[tone])}>
      {children}
    </span>
  );
}

/**
 * Um número grande com contexto.
 *
 * `note` não é opcional por acaso: um número sozinho não diz nada. "69 €" pode ser
 * bom ou catastrófico; "69 € · +2 este mês" já se lê.
 */
export function Metric({
  label,
  value,
  note,
  trend,
}: {
  label: string;
  value: string;
  note?: string;
  trend?: { value: number; good?: "up" | "down" };
}) {
  const good = trend ? (trend.good === "down" ? trend.value <= 0 : trend.value >= 0) : true;
  return (
    <div className="min-w-0 flex-1 border-r border-line px-5 py-4 last:border-r-0">
      <div className="text-meta text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-[26px] leading-none font-semibold text-ink tabular">{value}</span>
        {trend && trend.value !== 0 && (
          <span className={cx("text-meta font-medium tabular", good ? "text-[#1f7a45]" : "text-[#a82a20]")}>
            {trend.value > 0 ? "+" : ""}
            {trend.value}
          </span>
        )}
      </div>
      {note && <div className="mt-1 truncate text-meta text-ink-4">{note}</div>}
    </div>
  );
}

export function MetricRow({ children }: { children: ReactNode }) {
  return <div className="panel flex flex-wrap">{children}</div>;
}

/**
 * O emblema de um clube, ao lado do nome dele.
 *
 * ## Porque é que há sempre alguma coisa
 *
 * Metade dos clubes ainda não carregou emblema nenhum, e uma coluna com buracos
 * lê-se pior do que uma coluna sem imagens. Sem ficheiro desenha-se o monograma
 * sobre a cor do clube — que é a mesma peça que a consola e os emails usam, e
 * que já distingue um clube do outro numa lista.
 *
 * ## A cor do texto por cima
 *
 * Calculada, não fixa. Há clubes de amarelo, e branco sobre amarelo é invisível
 * — o mesmo problema que os emails tiveram. Aqui a lista é interna e o quadrado
 * é pequeno, por isso chega a conta simples da luminância; a versão a sério, com
 * contraste medido contra preto e contra branco, está em `common/contrast.ts` no
 * servidor.
 */
export function ClubMark({
  name,
  logoUrl,
  color,
  size = 30,
}: {
  name: string;
  logoUrl?: string | null;
  color?: string | null;
  size?: number;
}) {
  const fundo = /^#[0-9a-fA-F]{6}$/.test(color ?? "") ? (color as string) : "#0f6b62";

  return (
    <span
      aria-hidden
      style={{ width: size, height: size, background: logoUrl ? "var(--color-sunken)" : fundo, color: tintaSobre(fundo) }}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[7px] text-[11px] font-bold"
    >
      {logoUrl ? (
        <img src={logoUrl} alt="" className="size-full object-contain" />
      ) : (
        iniciais(name)
      )}
    </span>
  );
}

/** As duas letras de um nome: "Clube Desportivo de Loureiro" → "CL". */
function iniciais(name: string): string {
  const palavras = name.trim().split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return "?";
  if (palavras.length === 1) return palavras[0].slice(0, 2).toUpperCase();
  return (palavras[0][0] + palavras[palavras.length - 1][0]).toUpperCase();
}

/** Preto ou branco por cima de uma cor, pela luminância relativa. */
function tintaSobre(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? "#1c1a18" : "#ffffff";
}

export function Empty({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="px-5 py-14 text-center">
      <p className="text-body font-medium text-ink">{title}</p>
      {detail && <p className="mt-1 text-meta text-ink-3">{detail}</p>}
    </div>
  );
}

/** Barra de progresso fina — para o onboarding, onde a percentagem já está escrita. */
export function Progress({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{ width: `${percent}%`, background: percent === 100 ? "#1f7a45" : "var(--color-signal)" }}
      />
    </div>
  );
}
