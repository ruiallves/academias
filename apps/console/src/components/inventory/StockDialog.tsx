import { useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { TriangleAlert } from "@/lib/icons";
import { moveStock, type Variant } from "@/lib/inventory";

type Tipo = "ENTRY" | "EXIT" | "ADJUSTMENT";

/**
 * Mexer no stock de um tamanho.
 *
 * Três operações com nomes de coisas que acontecem no armazém ("chegou",
 * "saiu", "contei") e não os nomes técnicos do modelo. Quem arruma material
 * não pensa em `ADJUSTMENT`.
 *
 * Vive à parte da ficha porque a vista "A repor" do Inventário abre-o direto
 * em "Chegou", com a quantidade que falta para o mínimo.
 */
export function StockDialog({
  variant,
  itemName,
  inicial = "ENTRY",
  quantidadeInicial,
  onClose,
  onDone,
}: {
  variant: Variant;
  /** O nome do artigo, quando se abre fora da ficha dele. */
  itemName?: string;
  inicial?: Tipo;
  quantidadeInicial?: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [tipo, setTipo] = useState<Tipo>(inicial);
  const [quantidade, setQuantidade] = useState(String(quantidadeInicial ?? (inicial === "ADJUSTMENT" ? variant.total : 1)));
  const [razao, setRazao] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const n = Number(quantidade) || 0;
  const valido = tipo === "ADJUSTMENT" ? n >= 0 : n >= 1;

  // O que o total passa a ser, dito antes de confirmar: um ajuste que fixa em
  // vez de somar é a operação onde é mais fácil enganar-se.
  const futuro = tipo === "ENTRY" ? variant.total + n : tipo === "EXIT" ? variant.total - n : n;

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await moveStock(variant.id, { type: tipo, quantity: n, reason: razao.trim() || undefined });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="stock"
      title={itemName ? `${itemName} · ${variant.label}` : `Stock · ${variant.label}`}
      subtitle={`${variant.available} disponíveis de ${variant.total} · ${variant.assigned} com atletas`}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-stock" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A gravar…" : "Gravar"}
          </button>
        </>
      }
    >
      <form id="form-stock" onSubmit={submeter} className="space-y-4 p-5">
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">O que aconteceu</legend>
          <div className="inline-flex items-center gap-1 rounded-[var(--radius-control)] bg-sunken p-1">
            {(
              [
                ["ENTRY", "Chegou"],
                ["EXIT", "Saiu"],
                ["ADJUSTMENT", "Contei"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setTipo(v);
                  if (v === "ADJUSTMENT") setQuantidade(String(variant.total));
                }}
                aria-pressed={tipo === v}
                className={cx(
                  "h-8 rounded-[7px] px-3 text-meta font-semibold transition-colors duration-[120ms]",
                  tipo === v ? "bg-ink text-surface" : "text-ink-3 hover:bg-surface/60 hover:text-ink-2",
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </fieldset>

        <DialogField
          label={tipo === "ADJUSTMENT" ? "Quantas há, ao certo" : "Quantas unidades"}
          hint={`o total passa a ${Math.max(0, futuro)}`}
        >
          <input
            type="number"
            min={tipo === "ADJUSTMENT" ? 0 : 1}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            className={cx(dialogInputClass, "tabular")}
            autoFocus
          />
        </DialogField>

        <DialogField label="Motivo" hint="opcional, fica no histórico">
          <input
            value={razao}
            onChange={(e) => setRazao(e.target.value)}
            placeholder={tipo === "ENTRY" ? "Compra de época" : tipo === "EXIT" ? "Oferta ao clube visitante" : "Contagem de armazém"}
            className={dialogInputClass}
          />
        </DialogField>

        {futuro < variant.assigned && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            Há {variant.assigned} unidades com atletas, o total não pode ficar abaixo disso.
          </p>
        )}

        {erro && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            {erro}
          </p>
        )}
      </form>
    </Dialog>
  );
}
