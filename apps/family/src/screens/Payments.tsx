import { useState } from "react";
import { CheckCircle2, Copy, Loader, Receipt, ShieldCheck } from "lucide-react";
import { useChild } from "@/App";
import { payments, today, type Payment } from "@/data";
import { Card, SectionTitle, Tag, cx, dateShort, money } from "@/ui";

/**
 * Pagamentos.
 *
 * A regra que atravessa este ecrã: **o telemóvel nunca decide que algo foi pago.**
 * Ao tocar em "Pagar", a app pede ao servidor que crie a cobrança na euPago e passa
 * a mostrar "a confirmar" — e fica assim até o webhook chegar ao NestJS e a base de
 * dados mudar de estado. É por isso que existe o estado `processing`: é honesto
 * sobre o que ainda não se sabe, em vez de mostrar um "pago" que pode não ser verdade.
 */
export default function Payments() {
  const { child } = useChild();
  const mine = payments.filter((p) => p.childId === child.id);
  const open = mine.find((p) => p.status === "overdue" || p.status === "pending" || p.status === "processing");
  const history = mine.filter((p) => p !== open);

  return (
    <div className="space-y-5 pt-2">
      <h1 className="px-1 text-[26px] leading-tight font-semibold tracking-[-0.02em] text-ink">Pagamentos</h1>

      {open ? <OpenPayment payment={open} /> : <AllSettled />}

      <section>
        <SectionTitle>Histórico</SectionTitle>
        <Card>
          <ul>
            {history.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-3.5 last:border-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
                  <CheckCircle2 className="size-[18px]" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-ink">{p.label}</p>
                  <p className="text-meta text-ink-3">
                    {p.method} · {p.paidAt ? dateShort(p.paidAt) : ""}
                  </p>
                </div>
                <span className="shrink-0 text-body font-semibold text-ink tabular">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <button type="button" className="tap-quiet mt-3 w-full">
          <Receipt className="size-[18px]" strokeWidth={1.75} />
          Pedir recibos por e-mail
        </button>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function OpenPayment({ payment }: { payment: Payment }) {
  const [state, setState] = useState<"idle" | "processing">(
    payment.status === "processing" ? "processing" : "idle",
  );
  const overdue = payment.status === "overdue";

  return (
    <Card className={cx("overflow-hidden", overdue && state === "idle" ? "border-risk/30" : "border-line")}>
      <div className={cx("px-4 py-3", state === "processing" ? "bg-signal-soft" : overdue ? "bg-risk-soft" : "bg-warn-soft")}>
        <div className="flex items-center gap-2">
          {state === "processing" ? (
            <>
              <Loader className="size-4 animate-spin text-signal" strokeWidth={2} />
              <span className="text-meta font-semibold text-signal-ink">A confirmar com o banco</span>
            </>
          ) : (
            <>
              <span className={cx("size-2 rounded-full", overdue ? "bg-risk" : "bg-warn")} />
              <span className={cx("text-meta font-semibold", overdue ? "text-risk" : "text-warn")}>
                {overdue ? `Vencida a ${dateShort(payment.dueDate)}` : `Vence a ${dateShort(payment.dueDate)}`}
              </span>
            </>
          )}
        </div>
      </div>

      <div className="p-4">
        <div className="text-[36px] leading-none font-semibold tracking-[-0.025em] text-ink tabular">
          {money(payment.amountCents)}
        </div>
        <p className="mt-1.5 text-meta text-ink-3">
          Mensalidade de {payment.label.toLowerCase()} · {today.getFullYear()}
        </p>

        {state === "processing" ? (
          <div className="mt-4 rounded-[11px] border border-line bg-sunken/50 p-3.5">
            <p className="text-meta leading-relaxed text-ink-2">
              O pagamento foi enviado. Assim que o banco confirmar, recebes uma notificação e o
              estado muda aqui — normalmente em poucos minutos.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-2">
              <button type="button" onClick={() => setState("processing")} className="tap-primary w-full">
                Pagar com MB Way
              </button>
              <button type="button" onClick={() => setState("processing")} className="tap-quiet w-full">
                Pagar com cartão
              </button>
            </div>

            {payment.reference && (
              <div className="mt-3 rounded-[11px] border border-line bg-sunken/50 p-3.5">
                <div className="mb-1.5 text-meta font-semibold text-ink">Ou por Multibanco</div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-body text-ink-2 tabular">
                    Ent. 21860 · Ref. {payment.reference}
                  </span>
                  <button
                    type="button"
                    className="ml-auto flex size-8 items-center justify-center rounded-[8px] text-ink-3 active:bg-sunken"
                    aria-label="Copiar referência"
                    onClick={() => navigator.clipboard?.writeText(payment.reference!)}
                  >
                    <Copy className="size-4" strokeWidth={1.75} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        <p className="mt-3 flex items-center gap-1.5 text-[12px] text-ink-4">
          <ShieldCheck className="size-3.5 shrink-0" strokeWidth={1.75} />
          Processado pela euPago. A academia nunca vê os teus dados bancários.
        </p>
      </div>
    </Card>
  );
}

function AllSettled() {
  return (
    <Card className="p-6 text-center">
      <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-ok-soft text-ok">
        <CheckCircle2 className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-body font-semibold text-ink">Está tudo pago</p>
      <p className="mt-1 text-meta text-ink-3">A próxima mensalidade vence a 8 do mês que vem.</p>
      <div className="mt-3 flex justify-center">
        <Tag tone="ok">Sem valores em dívida</Tag>
      </div>
    </Card>
  );
}
