import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Trash2, TriangleAlert } from "@/lib/icons";

/**
 * Uma pergunta antes de uma ação que não se desfaz: apagar, sobretudo.
 *
 * Em vez do `confirm()` do browser, que sai com o endereço da página no
 * título, em inglês nalguns sistemas, e com a cara do sistema operativo em
 * vez da do produto. Este fica igual aos outros diálogos da consola, diz o que
 * acontece e o que fica, e mostra o erro ali mesmo se a ação falhar.
 *
 * `onConfirm` pode ser assíncrono: o botão fica ocupado enquanto corre, e o
 * diálogo só fecha quando acaba bem.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = "Apagar",
  danger = true,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  /** Vermelho, com o ícone do caixote. É o caso normal: quase tudo o que se confirma é apagar. */
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setBusy(true);
    setErro(null);
    try {
      await onConfirm();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível concluir.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={title}
      onClose={() => !busy && onClose()}
      width={420}
      icon={danger ? <TriangleAlert className="size-4 text-risk" strokeWidth={1.75} /> : undefined}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirmar()}
            disabled={busy}
            className={cx("ctl-primary", danger && "bg-risk hover:bg-risk")}
            autoFocus
          >
            {danger && <Trash2 className="size-3.5" strokeWidth={1.75} />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 px-5 py-4 text-body leading-relaxed text-ink-2">
        {children}
        {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
      </div>
    </Dialog>
  );
}
