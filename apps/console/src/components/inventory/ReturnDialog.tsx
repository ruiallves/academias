import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { TriangleAlert, Undo2 } from "@/lib/icons";
import { returnAssignment, type Assignment } from "@/lib/inventory";

/**
 * Receber equipamento de volta.
 *
 * ## O estado é a pergunta, e não tem resposta por omissão
 *
 * Em bom estado volta à prateleira; danificado ou perdido sai do stock e fica
 * contado como baixa. São consequências diferentes no armazém, e quem recebe tem
 * a peça na mão — é a única pessoa que sabe. Pré-seleccionar "bom estado" seria
 * pedir um clique para confirmar uma coisa que ninguém verificou, e ao fim de
 * uma época o clube teria stock que não existe.
 *
 * ## Devolver parte
 *
 * Entregaram-se três coletes e voltaram dois: o que falta continua com o atleta,
 * numa linha ainda por devolver. É o servidor que parte a entrega em duas — aqui
 * só se diz quantos voltaram.
 */
const ESTADOS = [
  { value: "GOOD", label: "Bom estado", hint: "volta à prateleira" },
  { value: "DAMAGED", label: "Danificado", hint: "sai do stock" },
  { value: "LOST", label: "Perdido", hint: "sai do stock" },
] as const;

export function ReturnDialog({
  assignment,
  onClose,
  onDone,
}: {
  assignment: Assignment;
  onClose: () => void;
  onDone: () => void;
}) {
  const [condition, setCondition] = useState<string>("");
  const [quantidade, setQuantidade] = useState(String(assignment.quantity));
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const n = Number(quantidade) || 0;
  const valido = Boolean(condition) && n >= 1 && n <= assignment.quantity;

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await returnAssignment(assignment.id, { condition, quantity: n, notes: notas.trim() || undefined });
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível registar a devolução.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="devolver"
      title="Devolver equipamento"
      subtitle={`${assignment.itemName} · ${assignment.variantLabel} — ${assignment.athleteName}`}
      icon={<Undo2 className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-devolver" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A registar…" : "Registar devolução"}
          </button>
        </>
      }
    >
      <form id="form-devolver" onSubmit={submeter} className="space-y-4 p-5">
        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Em que estado voltou</legend>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {ESTADOS.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => setCondition(e.value)}
                aria-pressed={condition === e.value}
                className={cx(
                  "rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors",
                  condition === e.value ? "border-ink bg-sunken" : "border-line hover:border-ink-4",
                )}
              >
                <span className="block text-body font-medium text-ink">{e.label}</span>
                <span className="block text-meta text-ink-3">{e.hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        {assignment.quantity > 1 && (
          <DialogField label="Quantas voltaram" hint={`foram entregues ${assignment.quantity}`}>
            <input
              type="number"
              min={1}
              max={assignment.quantity}
              value={quantidade}
              onChange={(e) => setQuantidade(e.target.value)}
              className={cx(dialogInputClass, "w-28 tabular")}
            />
          </DialogField>
        )}

        <DialogField label="Observações" hint="opcional, fica no histórico">
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Rasgou no jogo com o Fafe"
            className={dialogInputClass}
          />
        </DialogField>

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
