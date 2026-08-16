import { useEffect, type ReactNode } from "react";
import { X } from "@/lib/icons";
import { cx } from "./primitives";

/**
 * A moldura partilhada por todos os formulários em janela flutuante — Novo evento,
 * Nova equipa, Novo atleta. Extraído depois de a terceira cópia repetir a mesma
 * marcação: cabeçalho com título e botão de fechar, Escape a fechar, clique no
 * fundo a fechar, rodapé de acções. Um sítio só para essa mecânica não mudar de
 * comportamento entre formulários por descuido.
 */
export function Dialog({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 460,
  labelledBy,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  labelledBy?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ maxWidth: width }}
        className="max-h-[85vh] w-full overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={labelledBy} className="text-panel text-ink">
              {title}
            </h2>
            {subtitle && <p className="truncate text-meta text-ink-3">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 shrink-0 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        {children}

        {footer && <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export const dialogInputClass =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none";

export function DialogField({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 flex items-baseline justify-between gap-1.5">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
