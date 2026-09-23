import { cloneElement, isValidElement, useEffect, useId, useRef, type ReactElement, type ReactNode } from "react";
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
  /** Um ícone pequeno à esquerda do título — para diálogos que ganham com uma pista visual do que gerem. Opcional: a maioria não precisa. */
  icon,
  onClose,
  children,
  footer,
  width = 460,
  labelledBy,
}: {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  labelledBy?: string;
}) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Com dois diálogos abertos (uma confirmação por cima de um formulário), o
    // Escape fecha só o de cima: o último a entrar na página.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const abertos = document.querySelectorAll('[role="dialog"]');
      if (abertos[abertos.length - 1] !== caixa.current) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/20 p-4 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ maxWidth: width }}
        // Telemóvel: uma folha colada ao fundo, a toda a largura, com cantos só em cima.
        className="max-h-[85vh] w-full overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)] max-md:max-h-[92dvh] max-md:rounded-b-none max-md:rounded-t-[20px] max-md:border-x-0 max-md:border-b-0"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <div className="min-w-0">
            <h2 id={labelledBy} className="flex items-center gap-2 text-panel text-ink">
              {icon && <span className="shrink-0 text-ink-3">{icon}</span>}
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

/**
 * Um campo de formulário com rótulo por cima.
 *
 * ## Porque é que deixou de ser um `<label>` à volta de tudo
 *
 * Era `<label>{rótulo}{children}</label>`, que é o atalho habitual: o rótulo
 * fica ligado ao campo sem precisar de ids, e tocar no texto foca o campo.
 *
 * Só que alguns campos não são um campo — são um campo **mais uma lista de
 * escolher**. O selector de atleta do registo clínico é isso: escreve-se o nome
 * e aparecem nomes para tocar. E um `<label>` tem uma regra própria: um toque
 * dentro dele é reencaminhado para o campo que ele rotula. No telemóvel isso dá
 * exactamente a avaria que um clube relatou — *"toco no nome do atleta, ele não
 * selecciona e a lista desaparece"*: o toque acabava no campo de texto, o
 * teclado voltava a abrir e a lista fechava-se sem ter escolhido nada.
 *
 * Agora é uma `<div>`, e o `<label>` cobre só o texto do rótulo. A ligação ao
 * campo mantém-se para quem usa leitor de ecrã: quando o campo é um só e não
 * traz `id`, este dá-lhe um e aponta para ele. Quando são vários, ou há mais
 * coisas lá dentro, o rótulo fica sem ligação — que é melhor do que uma ligação
 * que rouba os toques.
 */
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
  const id = useId();

  /*
   * Um campo só, sem `id` seu, e dos que o HTML sabe rotular. Só nesse caso é
   * que se pode prometer a ligação — e é o caso da esmagadora maioria.
   */
  const soUmCampo =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type) &&
    !(children.props as { id?: string }).id;

  return (
    <div className={cx("block", className)}>
      <label
        {...(soUmCampo ? { htmlFor: id } : {})}
        className="mb-1.5 flex items-baseline justify-between gap-1.5"
      >
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </label>
      {soUmCampo ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
    </div>
  );
}
