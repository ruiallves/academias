import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, CreditCard, Loader, ShieldCheck, Smartphone } from "lucide-react";
import { children, payments, type Payment } from "@/data";
import { Avatar, Money, cx, dateShort, money } from "@/ui";

/**
 * Pagamentos — a carteira da família.
 *
 * Não é o ecrã de um filho: um pai paga por todos, e por isso vê aqui **tudo o que
 * está em dívida na família** e escolhe quantas mensalidades quiser pagar de uma
 * vez. O total soma-se em tempo real, e a acção é um gesto só.
 *
 * A regra que atravessa tudo: **o telemóvel nunca decide que algo foi pago.** Ao
 * confirmar, a app pede à euPago para criar a cobrança e passa a "a confirmar" — e
 * fica assim até o webhook chegar e a base de dados mudar. É por isso que existe o
 * estado `processing`: honesto sobre o que ainda não se sabe.
 */

const firstNameOf = (childId: string) => children.find((c) => c.id === childId)?.firstName ?? "";

export default function Payments() {
  const outstanding = payments.filter((p) => p.status === "overdue" || p.status === "pending");
  const history = payments.filter((p) => p.status === "paid");

  // Começa com as vencidas/por pagar de agosto escolhidas; as futuras (setembro)
  // ficam por marcar — quem quiser adiantá-las, toca.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(outstanding.filter((p) => p.status === "overdue").map((p) => p.id)),
  );
  const [phase, setPhase] = useState<"list" | "sheet" | "processing" | "done">("list");

  const chosen = outstanding.filter((p) => selected.has(p.id));
  const total = useMemo(() => chosen.reduce((n, p) => n + p.amountCents, 0), [chosen]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="pt-3">
      <h1 className="px-1 text-[30px] leading-tight font-semibold tracking-[-0.03em] text-ink">Pagamentos</h1>

      {outstanding.length === 0 ? (
        <AllSettled />
      ) : (
        <>
          {/* Total em dívida — número grande, tranquilizador na forma, claro no valor. */}
          <div className="mt-5 rounded-[var(--radius-xl)] bg-ink p-5 text-white" style={{ boxShadow: "var(--shadow-float)" }}>
            <p className="text-[13px] font-semibold text-white/60">
              {outstanding.length} {outstanding.length === 1 ? "mensalidade por pagar" : "mensalidades por pagar"}
            </p>
            <div className="mt-1.5">
              <Money cents={outstanding.reduce((n, p) => n + p.amountCents, 0)} size="xl" on />
            </div>
            <p className="mt-2 text-[13px] text-white/55">Escolhe abaixo quais pagar — podes juntar várias.</p>
          </div>

          {/* Lista seleccionável, agrupada por atleta na etiqueta de cada linha. */}
          <ul className="mt-4 space-y-2">
            {outstanding.map((p) => (
              <OutstandingRow key={p.id} payment={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />
            ))}
          </ul>
        </>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 px-1 text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">Histórico</h2>
          <ul className="space-y-0.5">
            {history.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
                  <CheckCircle2 className="size-5" strokeWidth={1.9} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body font-semibold text-ink">
                    {p.label} · {firstNameOf(p.childId)}
                  </p>
                  <p className="text-meta text-ink-3">
                    {p.method} · {p.paidAt ? dateShort(p.paidAt) : ""}
                  </p>
                </div>
                <span className="num shrink-0 text-body font-semibold text-ink">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Barra de pagamento — flutua acima da nav, aparece quando há algo escolhido. */}
      {phase === "list" && chosen.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[480px] justify-center px-4 pb-[calc(84px+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setPhase("sheet")}
            className="cta pointer-events-auto w-full max-w-[420px] justify-between gap-3 shadow-[var(--shadow-float)]"
          >
            <span className="text-[14px] font-medium text-white/70">
              {chosen.length} {chosen.length === 1 ? "mensalidade" : "mensalidades"}
            </span>
            <span className="num text-[17px] font-semibold">Pagar {money(total)}</span>
          </button>
        </div>
      )}

      {phase === "sheet" && <PaySheet count={chosen.length} total={total} onClose={() => setPhase("list")} onPay={() => setPhase("processing")} />}
      {(phase === "processing" || phase === "done") && (
        <ProcessingSheet chosen={chosen} total={total} done={phase === "done"} onArrive={() => setPhase("done")} onClose={() => setPhase("list")} />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function OutstandingRow({ payment, selected, onToggle }: { payment: Payment; selected: boolean; onToggle: () => void }) {
  const overdue = payment.status === "overdue";
  const name = firstNameOf(payment.childId);

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={selected}
        className={cx(
          "flex w-full items-center gap-3 rounded-[var(--radius-lg)] p-3.5 text-left transition-all duration-200 active:scale-[0.99]",
          selected ? "bg-surface shadow-[var(--shadow-soft)] ring-2 ring-signal/60" : "bg-surface/60 shadow-[var(--shadow-soft)]",
        )}
      >
        <Avatar name={name} size={44} />

        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-ink">
            {payment.label} · {name}
          </p>
          <p className={cx("text-meta font-medium", overdue ? "text-risk" : "text-ink-3")}>
            {overdue ? `Vencida a ${dateShort(payment.dueDate)}` : `Vence a ${dateShort(payment.dueDate)}`}
          </p>
        </div>

        <span className="num shrink-0 text-[17px] font-semibold text-ink">{money(payment.amountCents)}</span>

        <span
          className={cx(
            "flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
            selected ? "border-transparent bg-signal text-white" : "border-line-strong",
          )}
        >
          {selected && <Check className="size-3.5" strokeWidth={3} />}
        </span>
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Folha de pagamento                                                          */
/* -------------------------------------------------------------------------- */

function Sheet({ children: kids, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className="relative mx-auto w-full max-w-[480px] rounded-t-[var(--radius-xl)] bg-canvas px-4 pt-3 pb-[calc(20px+env(safe-area-inset-bottom))]"
        style={{ boxShadow: "0 -18px 50px -20px rgb(20 18 15 / 0.4)", animation: "rise 320ms var(--ease-out) both" }}
      >
        <span className="mx-auto mb-4 block h-1 w-10 rounded-full bg-ink-4/40" aria-hidden />
        {kids}
      </div>
    </div>
  );
}

function PaySheet({ count, total, onClose, onPay }: { count: number; total: number; onClose: () => void; onPay: () => void }) {
  return (
    <Sheet onClose={onClose}>
      <div className="mb-4 flex items-baseline justify-between px-1">
        <div>
          <p className="text-[13px] font-semibold tracking-[0.04em] text-ink-3 uppercase">A pagar</p>
          <div className="mt-1">
            <Money cents={total} size="lg" />
          </div>
        </div>
        <span className="text-meta text-ink-3">{count} {count === 1 ? "mensalidade" : "mensalidades"}</span>
      </div>

      <div className="space-y-2">
        <button type="button" onClick={onPay} className="cta w-full justify-start gap-3">
          <Smartphone className="size-5" strokeWidth={1.9} />
          Pagar com MB Way
        </button>
        <button type="button" onClick={onPay} className="cta-quiet w-full justify-start gap-3">
          <CreditCard className="size-5" strokeWidth={1.9} />
          Pagar com cartão
        </button>
      </div>

      <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-ink-4">
        <ShieldCheck className="size-3.5 shrink-0" strokeWidth={1.75} />
        Processado pela euPago. A academia nunca vê os teus dados bancários.
      </p>
    </Sheet>
  );
}

/**
 * Depois de confirmar: "a confirmar com o banco". A transição para "enviado" é
 * simulada aqui (sem webhook no protótipo), mas o texto é honesto — o estado real
 * só muda quando o servidor confirmar.
 */
function ProcessingSheet({
  chosen,
  total,
  done,
  onArrive,
  onClose,
}: {
  chosen: Payment[];
  total: number;
  done: boolean;
  onArrive: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (done) return;
    const t = setTimeout(onArrive, 1400);
    return () => clearTimeout(t);
  }, [done, onArrive]);

  return (
    <Sheet onClose={onClose}>
      <div className="px-1 pb-2 text-center">
        {done ? (
          <>
            <span className="pop mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-ok-soft text-ok">
              <Check className="size-8" strokeWidth={2.5} />
            </span>
            <p className="text-[19px] font-semibold text-ink">Pagamento enviado</p>
            <p className="mx-auto mt-1.5 max-w-[32ch] text-meta leading-relaxed text-ink-3">
              {chosen.length === 1 ? "A mensalidade fica" : "As mensalidades ficam"} em "a confirmar" até o banco
              responder — recebes uma notificação assim que estiver pago.
            </p>
            <button type="button" onClick={onClose} className="cta mt-6 w-full">
              Concluir
            </button>
          </>
        ) : (
          <>
            <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-signal-soft text-signal">
              <Loader className="size-8 animate-spin" strokeWidth={2} />
            </span>
            <p className="text-[19px] font-semibold text-ink">A confirmar com o banco…</p>
            <div className="mx-auto mt-2">
              <Money cents={total} size="md" />
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */

function AllSettled() {
  return (
    <div className="mt-5 rounded-[var(--radius-xl)] bg-surface p-8 text-center" style={{ boxShadow: "var(--shadow-soft)" }}>
      <span className="pop mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-ok-soft text-ok">
        <Check className="size-7" strokeWidth={2.5} />
      </span>
      <p className="text-[19px] font-semibold text-ink">Está tudo pago</p>
      <p className="mx-auto mt-1.5 max-w-[30ch] text-meta text-ink-3">
        Sem valores em dívida. A próxima mensalidade vence a 8 do mês que vem.
      </p>
    </div>
  );
}

