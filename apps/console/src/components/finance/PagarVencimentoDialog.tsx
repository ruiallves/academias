import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "@/components/Dialog";
import { SelectField, cx } from "@/components/primitives";
import { TriangleAlert } from "@/lib/icons";
import { METHOD_LABEL, euros, mesLongo, paySalary, payMonth, type MesDeVencimento } from "@/lib/finance";

/**
 * Pagar um mês de vencimento — a uma pessoa, ou a toda a gente de uma vez.
 *
 * Pagar é registar uma despesa concluída com a pessoa e o mês ligados: entra
 * no saldo e nos movimentos como qualquer outra. O valor vem preenchido com o
 * do contrato e muda-se quando o que se pagou foi outro (um prémio, um mês
 * incompleto). A data é a de hoje, porque é quase sempre hoje — mas um
 * pagamento de sexta registado na segunda escreve-se com a data certa.
 */
export function PagarVencimentoDialog({
  alvo,
  onClose,
  onDone,
}: {
  alvo:
    | { modo: "um"; nome: string; mes: MesDeVencimento }
    /** O mês a toda a gente que ainda não o tem pago. */
    | { modo: "todos"; period: string; n: number; amountCents: number; salaryIds?: string[] };
  onClose: () => void;
  onDone: () => void;
}) {
  const um = alvo.modo === "um";
  const [valor, setValor] = useState(um ? paraEuros(alvo.mes.amountCents) : "");
  const [data, setData] = useState(hoje());
  const [metodo, setMetodo] = useState("TRANSFER");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const cents = um ? paraCentimos(valor) : null;
  const valido = Boolean(data) && (!um || (cents !== null && cents > 0));

  async function submeter(e: FormEvent) {
    e.preventDefault();
    if (!valido || busy) return;
    setBusy(true);
    setErro(null);
    try {
      if (alvo.modo === "um") {
        await paySalary(alvo.mes.salaryId, {
          period: alvo.mes.period,
          paidOn: data,
          amountCents: cents!,
          method: metodo || undefined,
          notes: notas.trim() || undefined,
        });
      } else {
        await payMonth({ period: alvo.period, salaryIds: alvo.salaryIds, paidOn: data, method: metodo || undefined });
      }
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível registar o pagamento.");
    } finally {
      setBusy(false);
    }
  }

  const period = um ? alvo.mes.period : alvo.period;

  return (
    <Dialog
      labelledBy="pagar-vencimento"
      title={um ? `Pagar a ${alvo.nome}` : `Pagar ${mesLongo(period)} a todos`}
      subtitle={
        um
          ? `Vencimento de ${mesLongo(period)}`
          : `${alvo.n} ${alvo.n === 1 ? "pessoa" : "pessoas"} por pagar · ${euros(alvo.amountCents)}`
      }
      onClose={onClose}
      width={460}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
            Cancelar
          </button>
          <button type="submit" form="form-pagar-vencimento" className="ctl-primary" disabled={!valido || busy}>
            {busy ? "A registar…" : um ? `Registar ${cents !== null ? euros(cents) : ""}` : `Registar ${alvo.n} ${alvo.n === 1 ? "pagamento" : "pagamentos"}`}
          </button>
        </>
      }
    >
      <form id="form-pagar-vencimento" onSubmit={submeter} className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          {um ? (
            <DialogField label="Valor pago (€)">
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                inputMode="decimal"
                autoFocus
                className={cx(dialogInputClass, "text-right tabular", valor && cents === null && "border-risk")}
              />
            </DialogField>
          ) : (
            <DialogField label="Valor">
              <div className="flex h-9 items-center text-body text-ink tabular">{euros(alvo.amountCents)}</div>
            </DialogField>
          )}
          <DialogField label="Data do pagamento">
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={dialogInputClass} />
          </DialogField>
        </div>
        <DialogField label="Método">
          <SelectField
            className="w-full"
            value={metodo}
            onChange={setMetodo}
            options={[
              { value: "", label: "—" },
              ...["TRANSFER", "CASH", "MBWAY", "MULTIBANCO", "CARD"].map((v) => ({ value: v, label: METHOD_LABEL[v] ?? v })),
            ]}
          />
        </DialogField>
        {um && (
          <DialogField label="Notas" hint="opcional">
            <input value={notas} onChange={(e) => setNotas(e.target.value)} className={dialogInputClass} />
          </DialogField>
        )}
        {!um && (
          <p className="text-meta leading-relaxed text-ink-3">
            Cada pessoa fica com um movimento próprio, pelo valor do seu vencimento. Quem já tem o mês pago fica como está.
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

function paraEuros(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function paraCentimos(v: string): number | null {
  const limpo = v.trim().replace(/\s/g, "").replace("€", "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function hoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
