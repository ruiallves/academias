import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement, type ReactNode } from "react";
import QRCode from "qrcode";
import { X } from "lucide-react";
import { cx } from "@/components/primitives";

/**
 * Peças partilhadas pelos ecrãs comerciais.
 *
 * Seguem a linguagem do painel (linhas finas, cantos de 8–10 px, tinta quase
 * preta, verde da marca só onde há uma ação) e acrescentam o que este trabalho
 * pede: alvos de toque grandes, atalhos de teclado e um QR para ligar.
 */

export const INPUT =
  "h-10 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 text-body text-ink placeholder:text-ink-4 transition-colors duration-150 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15";

export const TEXTAREA =
  "w-full resize-y rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 text-body text-ink placeholder:text-ink-4 transition-colors duration-150 focus:border-signal focus:outline-none focus:ring-2 focus:ring-signal/15";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  const id = useId();
  const soUmCampo =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type) &&
    !(children.props as { id?: string }).id;
  return (
    <div className={cx("min-w-0", className)}>
      <label {...(soUmCampo ? { htmlFor: id } : {})} className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-meta font-medium text-ink-2">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </label>
      {soUmCampo ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
    </div>
  );
}

/** Um atalho de teclado, discreto. Só aparece onde há teclado (computador). */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="hidden min-w-[18px] items-center justify-center rounded-[4px] border border-line bg-canvas px-1 font-mono text-[10px] leading-[16px] text-ink-4 [@media(hover:hover)]:inline-flex">
      {children}
    </kbd>
  );
}

/** Abas de um só nível: texto com um traço por baixo da ativa. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; count?: number }[];
}) {
  return (
    <div role="tablist" className="flex min-w-0 gap-5 overflow-x-auto">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={cx(
              "relative -mb-px flex h-10 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 text-body font-medium transition-colors duration-150",
              on ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 && <span className="tabular text-ink-4">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * O número em QR, para ligar com o telemóvel.
 *
 * O comercial trabalha no computador e liga do telemóvel: apontar a câmara abre
 * o marcador com o número já escrito, sem o copiar à mão.
 */
export function QrLigar({ phone, size = 104 }: { phone: string; size?: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    let vivo = true;
    QRCode.toString(`tel:${phone.replace(/[^\d+]/g, "")}`, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#1a1917", light: "#00000000" } })
      .then((s) => vivo && setSvg(s))
      .catch(() => vivo && setSvg(""));
    return () => {
      vivo = false;
    };
  }, [phone]);
  return (
    <div
      aria-label={`Código QR para ligar para ${phone}`}
      role="img"
      style={{ width: size, height: size }}
      className="shrink-0 [&>svg]:size-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * O anel da comissão: quantas reuniões já há no bloco atual.
 *
 * Um arco de traço grosso sobre um trilho claro, com os números ao centro. O
 * arco anda quando muda (400 ms), e fica parado para quem pediu menos movimento.
 */
export function AnelComissao({ feito, total, size = 132 }: { feito: number; total: number; size?: number }) {
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.min(1, feito / total) : 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-sunken)" strokeWidth={9} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-signal)"
          strokeWidth={9}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] leading-none font-semibold tracking-tight text-ink tabular">
          {feito}
          <span className="text-ink-4">/{total}</span>
        </span>
        <span className="mt-1 text-[11px] text-ink-3">reuniões</span>
      </div>
    </div>
  );
}

/** A moldura de um diálogo: fundo, Escape, folha no telemóvel. */
export function Dialog({
  title,
  subtitle,
  onClose,
  width = 600,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 py-10 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{ maxWidth: width }}
        className="com-rise w-full overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
            {subtitle && <div className="mt-0.5 truncate text-meta text-ink-3">{subtitle}</div>}
          </div>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 shrink-0 cursor-pointer justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>
        <div className="max-h-[78vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/**
 * Uma fila de números (2 por linha no telemóvel, todos numa linha no computador).
 * As linhas entre eles são o fundo a espreitar por um intervalo de 1 px, para
 * ficarem certas em qualquer número de colunas.
 */
export function Numeros({ items }: { items: { label: string; value: string; note?: string }[] }) {
  return (
    <div
      className={cx(
        "grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-panel)] border border-line bg-line",
        items.length === 3 ? "md:grid-cols-3" : "md:grid-cols-4",
      )}
    >
      {items.map((i) => (
        <div key={i.label} className="min-w-0 bg-surface px-5 py-4 max-md:px-4">
          <div className="truncate text-meta text-ink-3">{i.label}</div>
          <div className="mt-1 text-[24px] leading-none font-semibold tracking-[-0.01em] text-ink tabular">{i.value}</div>
          {i.note && <div className="mt-1.5 truncate text-meta text-ink-4">{i.note}</div>}
        </div>
      ))}
    </div>
  );
}

/** Uma linha "rótulo — valor" para fichas de leitura. */
export function Linha({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-3 border-b border-line py-2.5 last:border-b-0">
      <dt className="text-meta text-ink-3">{label}</dt>
      <dd className="min-w-0 text-body break-words text-ink">{children}</dd>
    </div>
  );
}
