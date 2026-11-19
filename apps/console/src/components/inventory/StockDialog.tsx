import { useState } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { TriangleAlert } from "@/lib/icons";
import { comAtletasTexto, hojeISO, moveStock, type Variant } from "@/lib/inventory";

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
  /*
   * A contagem é do que está **no clube** (prontas mais as guardadas para
   * atletas): é o que se consegue contar na arrecadação. O que está em casa
   * dos atletas soma-se aqui, porque o servidor fixa o total. Antes pedia-se o
   * total, e quem contava a prateleira apagava sem querer o que estava com eles.
   */
  const reservadas = variant.reserved ?? 0;
  const comAtletas = variant.assigned - reservadas;
  const noClube = variant.available + reservadas;

  const [tipo, setTipo] = useState<Tipo>(inicial);
  const [quantidade, setQuantidade] = useState(String(quantidadeInicial ?? (inicial === "ADJUSTMENT" ? noClube : 1)));
  const [razao, setRazao] = useState("");
  /** O dia em que aconteceu: hoje por omissão, para o histórico ficar com o dia certo. */
  const [dia, setDia] = useState(hojeISO());
  const diaOk = /^\d{4}-\d{2}-\d{2}$/.test(dia) && dia <= hojeISO();
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const n = Number(quantidade) || 0;
  const valido = diaOk && (tipo === "ADJUSTMENT" ? n >= reservadas : n >= 1 && (tipo !== "EXIT" || n <= variant.available));

  // O que fica pronto a entregar, dito antes de confirmar.
  const futuro = tipo === "ENTRY" ? variant.total + n : tipo === "EXIT" ? variant.total - n : n + comAtletas;
  const prontas = futuro - variant.assigned;

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await moveStock(variant.id, {
        type: tipo,
        quantity: tipo === "ADJUSTMENT" ? futuro : n,
        reason: razao.trim() || undefined,
        ...(dia !== hojeISO() ? { on: dia } : {}),
      });
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
      subtitle={`${variant.available} disponíveis de ${variant.total} · ${comAtletasTexto(variant, "nenhum com atletas")}`}
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
                ["ADJUSTMENT", "Contagem"],
              ] as const
            ).map(([v, l]) => (
              <button
                key={v}
                type="button"
                onClick={() => {
                  setTipo(v);
                  if (v === "ADJUSTMENT") setQuantidade(String(noClube));
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
          label={tipo === "ADJUSTMENT" ? "Quantas contaste no clube" : "Quantas unidades"}
          hint={`ficam ${Math.max(0, prontas)} prontas a entregar`}
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

        <DialogField
          label={tipo === "ENTRY" ? "Chegou a" : tipo === "EXIT" ? "Saiu a" : "Contado a"}
          hint={dia === hojeISO() ? "hoje" : diaOk ? undefined : "não pode ser depois de hoje"}
        >
          <input
            type="date"
            value={dia}
            max={hojeISO()}
            onChange={(e) => setDia(e.target.value)}
            className={cx(dialogInputClass, "tabular", !diaOk && "border-risk")}
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

        {tipo === "ADJUSTMENT" && (
          <p className="text-meta leading-relaxed text-ink-3">
            Conta o que está no clube{reservadas > 0 ? `, incluindo as ${reservadas} guardadas para atletas` : ""}.
            {comAtletas > 0 && ` As ${comAtletas} que estão com atletas juntam-se sozinhas.`}
          </p>
        )}

        {tipo === "EXIT" && n > variant.available && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            Só há {variant.available} prontas a sair.
          </p>
        )}
        {tipo === "ADJUSTMENT" && n < reservadas && (
          <p className="flex items-start gap-1.5 text-meta text-risk">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
            Há {reservadas} guardadas para atletas no clube; conta-as também.
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
