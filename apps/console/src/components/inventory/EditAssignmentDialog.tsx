import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { Pencil, TriangleAlert, Undo2 } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { reloadFees } from "@/lib/store";
import { useSession } from "@/session";
import { updateAssignment, type Assignment } from "@/lib/inventory";
import {
  PagamentoDaEntregaField,
  PagamentoPill,
  pagamentoValido,
  pedidoDe,
  valorDe,
  type ValorDoPagamento,
} from "./PagamentoDaEntrega";

/**
 * Editar uma entrega de equipamento: o pagamento e as notas.
 *
 * O pagamento é o mesmo cartão de quando se entregou (\`PagamentoDaEntregaField\`):
 * passar de "por pagar" a "pago" quando a família paga ao balcão, mandar para os
 * Pagamentos da app quando o clube decide pedir, ou tirar o pagamento de todo.
 * O servidor larga a cobrança que deixa de servir (\`definirPagamento\`).
 *
 * Devolver continua a ser outro gesto, com o estado da peça: o botão está no
 * fundo, para não se ter de fechar isto e procurar a linha outra vez.
 */
export function EditAssignmentDialog({
  assignment,
  onClose,
  onDone,
  onDevolver,
}: {
  assignment: Assignment;
  onClose: () => void;
  onDone: () => void;
  /** Abrir a devolução desta entrega. Só nas que estão com o atleta. */
  onDevolver?: () => void;
}) {
  const { session } = useSession();
  const podeCobrar = can(session, "billing:write");

  const inicial = valorDe(assignment.pagamento);
  const [pagamento, setPagamento] = useState<ValorDoPagamento>(inicial);
  const [notas, setNotas] = useState(assignment.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const pagamentoMudou =
    pagamento.modo !== inicial.modo ||
    (pagamento.modo !== "nenhum" && pagamento.valor !== inicial.valor) ||
    (pagamento.modo === "pago" && pagamento.metodo !== inicial.metodo);
  const notasMudaram = notas.trim() !== (assignment.notes ?? "").trim();
  const valido = (!pagamentoMudou || pagamentoValido(pagamento)) && (pagamentoMudou || notasMudaram);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await updateAssignment(assignment.id, {
        ...(notasMudaram ? { notes: notas.trim() } : {}),
        ...(pagamentoMudou && podeCobrar ? { pagamento: pedidoDe(pagamento) } : {}),
      });
      if (pagamentoMudou) void reloadFees();
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="editar-entrega"
      title="Editar entrega"
      subtitle={`${assignment.itemName} · ${assignment.variantLabel} · ${assignment.athleteName}`}
      icon={<Pencil className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <>
          {onDevolver && assignment.status === "ACTIVE" && (
            <button type="button" className="ctl-ghost mr-auto" onClick={onDevolver} disabled={busy}>
              <Undo2 className="size-3.5" strokeWidth={1.75} />
              Devolver
            </button>
          )}
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-editar-entrega" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </>
      }
    >
      <form id="form-editar-entrega" onSubmit={guardar} className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
          <span>
            {assignment.quantity} {assignment.quantity === 1 ? "unidade" : "unidades"} · entregue a{" "}
            {shortDate(new Date(assignment.assignedAt))}
            {assignment.assignedBy ? ` por ${assignment.assignedBy}` : ""}
          </span>
          <PagamentoPill p={assignment.pagamento} />
        </div>

        {podeCobrar ? (
          <PagamentoDaEntregaField
            value={pagamento}
            onChange={setPagamento}
            primeiroNome={assignment.athleteName.split(" ")[0]}
            athleteId={assignment.athleteId}
          />
        ) : (
          <p className="rounded-[var(--radius-control)] bg-sunken/60 px-3 py-2.5 text-meta text-ink-3">
            O pagamento muda-o quem trata das mensalidades.
          </p>
        )}

        <DialogField label="Observações" hint="opcional">
          <input
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Equipamento de treino época 26/27"
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
