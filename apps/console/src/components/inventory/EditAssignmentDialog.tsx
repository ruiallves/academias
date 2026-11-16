import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { cx } from "@/components/primitives";
import { Pencil, TriangleAlert, Undo2 } from "@/lib/icons";
import { shortDate } from "@/lib/format";
import { can } from "@/lib/permissions";
import { reloadFees } from "@/lib/store";
import { useSession } from "@/session";
import { naoEntregar, updateAssignment, type Assignment } from "@/lib/inventory";
import { CampoDaEntrega } from "./PorEntregar";
import {
  PagamentoDaEntregaField,
  pagamentoValido,
  pedidoDe,
  valorDe,
  type ValorDoPagamento,
} from "./PagamentoDaEntrega";

/**
 * Editar uma peça de equipamento: se já foi entregue, o pagamento e as notas.
 *
 * ## As duas perguntas, no mesmo sítio
 *
 * Em cima, Entregue ou Por entregar; por baixo, o pagamento. São os mesmos dois
 * seletores do "Entregar equipamento", e mudam-se para os dois lados: passar a
 * entregue quando o atleta leva a peça, voltar a por entregar quando se marcou
 * por engano, passar de "por pagar" a "pago" quando a família paga ao balcão
 * (Rui, 16/11/2026: "devia dar para alterar tanto no perfil do atleta como no
 * Com atletas"). Abre-se igual nos dois sítios, tocando na linha, no "Editar"
 * ou nas pastilhas do estado e do pagamento. O servidor larga a cobrança que
 * deixa de servir (`definirPagamento`).
 *
 * ## O que mexe no stock fica à parte
 *
 * Devolver (entregue) e "Não vai ser entregue" (por entregar) estão no fundo,
 * à esquerda: põem unidades de volta na prateleira. O segundo pede um segundo
 * toque, porque a linha sai.
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
  const primeiroNome = assignment.athleteName.split(" ")[0];

  /* Só o que ainda é assunto muda de estado; o que foi devolvido já fechou. */
  const aberta = assignment.status === "ACTIVE" || assignment.status === "RESERVED";
  const entregueInicial = assignment.status !== "RESERVED";
  const [entregue, setEntregue] = useState(entregueInicial);

  const inicial = valorDe(assignment.pagamento);
  const [pagamento, setPagamento] = useState<ValorDoPagamento>(inicial);
  const [notas, setNotas] = useState(assignment.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  /** "Não vai ser entregue" pede um segundo toque: a linha sai e a peça volta ao stock. */
  const [confirmarNao, setConfirmarNao] = useState(false);

  const entregaMudou = aberta && entregue !== entregueInicial;
  const pagamentoMudou =
    pagamento.modo !== inicial.modo ||
    (pagamento.modo !== "nenhum" && pagamento.valor !== inicial.valor) ||
    (pagamento.modo === "pago" && pagamento.metodo !== inicial.metodo);
  const notasMudaram = notas.trim() !== (assignment.notes ?? "").trim();
  const algoMudou = entregaMudou || pagamentoMudou || notasMudaram;
  const valido = algoMudou && (!pagamentoMudou || pagamentoValido(pagamento));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      await updateAssignment(assignment.id, {
        ...(notasMudaram ? { notes: notas.trim() } : {}),
        ...(pagamentoMudou && podeCobrar ? { pagamento: pedidoDe(pagamento) } : {}),
        ...(entregaMudou ? { entregue } : {}),
      });
      if (pagamentoMudou) void reloadFees();
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
      setBusy(false);
    }
  }

  async function naoVaiSerEntregue() {
    if (busy) return;
    if (!confirmarNao) {
      setConfirmarNao(true);
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      await naoEntregar(assignment.id);
      void reloadFees();
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível tirar a peça.");
      setConfirmarNao(false);
      setBusy(false);
    }
  }

  const rotuloGuardar = busy
    ? "A guardar…"
    : entregaMudou && entregue && !pagamentoMudou && !notasMudaram
      ? "Marcar entregue"
      : "Guardar";

  return (
    <Dialog
      labelledBy="editar-entrega"
      title="Editar equipamento"
      subtitle={`${assignment.itemName} · ${assignment.variantLabel} · ${assignment.athleteName}`}
      icon={<Pencil className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      footer={
        <>
          {onDevolver && assignment.status === "ACTIVE" && !entregaMudou && (
            <button type="button" className="ctl-ghost mr-auto" onClick={onDevolver} disabled={busy}>
              <Undo2 className="size-3.5" strokeWidth={1.75} />
              Devolver
            </button>
          )}
          {assignment.status === "RESERVED" && (
            <button
              type="button"
              className={cx("ctl-ghost mr-auto", confirmarNao ? "text-risk" : "text-ink-3")}
              onClick={() => void naoVaiSerEntregue()}
              onBlur={() => setConfirmarNao(false)}
              disabled={busy}
            >
              {confirmarNao ? "Confirmar: volta ao stock" : "Não vai ser entregue"}
            </button>
          )}
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-editar-entrega" className="ctl-primary" disabled={!valido || busy}>
            {rotuloGuardar}
          </button>
        </>
      }
    >
      <form id="form-editar-entrega" onSubmit={guardar} className="space-y-4 p-5">
        <p className="text-meta text-ink-3">
          {assignment.quantity} {assignment.quantity === 1 ? "unidade" : "unidades"} ·{" "}
          {assignment.status === "RESERVED" ? "guardado a " : "entregue a "}
          {shortDate(new Date(assignment.assignedAt))}
          {assignment.assignedBy ? ` por ${assignment.assignedBy}` : ""}
        </p>

        {aberta && <CampoDaEntrega value={entregue} onChange={setEntregue} primeiroNome={primeiroNome} />}

        {podeCobrar ? (
          <PagamentoDaEntregaField
            value={pagamento}
            onChange={setPagamento}
            primeiroNome={primeiroNome}
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
