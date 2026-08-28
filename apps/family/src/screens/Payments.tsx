import { useEffect, useMemo, useState } from "react";
import { Check, CheckCircle2, Copy, CreditCard, Loader, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { apiPost } from "@/lib/http";
import { reload, useStore, type Payment } from "@/lib/store";
import { Avatar, Money, cx, dateShort, money } from "@/ui";

/**
 * Pagamentos — a carteira da família.
 *
 * Não é o ecrã de um filho: um pai paga por todos, e por isso vê aqui **tudo o que
 * está em dívida na família**.
 *
 * A pergunta que este ecrã tem de responder em dois segundos é "quanto devo e o
 * que é que estou prestes a pagar?". A versão anterior respondia à primeira
 * metade com um número grande e à segunda com uma barra escondida no fundo — o
 * pai escolhia meses sem que nada por cima mudasse, e só descobria o que ia pagar
 * ao chegar à folha do método. Agora o painel de cima **é** a selecção: muda com
 * cada toque, e três atalhos (todas / só vencidas / limpar) resolvem os casos
 * reais — "pago tudo o que devo" e "pago os três meses de atraso" — sem obrigar a
 * tocar linha a linha.
 *
 * A regra que atravessa tudo: **o telemóvel nunca decide que algo foi pago.** Ao
 * confirmar, o servidor pede a referência à euPago e a mensalidade fica "a
 * confirmar" — e assim continua até o webhook chegar e a base de dados mudar.
 */
export default function Payments() {
  const store = useStore();

  const childOf = (childId: string) => store.children.find((c) => c.id === childId);
  const nameOf = (childId: string) => childOf(childId)?.firstName ?? "";

  const outstanding = store.payments
    .filter((p) => p.status === "overdue" || p.status === "pending")
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const history = store.payments.filter((p) => p.status === "paid").sort((a, b) => b.dueDate.getTime() - a.dueDate.getTime());

  const overdueIds = outstanding.filter((p) => p.status === "overdue").map((p) => p.id);

  // Começa com as vencidas escolhidas: é o que o pai veio cá fazer. As que ainda
  // não venceram ficam por marcar — adiantá-las é uma escolha, não um descuido.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelected(new Set(store.payments.filter((p) => p.status === "overdue").map((p) => p.id)));
    // Só quando a lista muda de identidade (recarregar depois de pagar).
  }, [store.payments]);

  const [sheet, setSheet] = useState<"none" | "method" | "result">("none");
  const [result, setResult] = useState<PayResult | null>(null);

  const chosen = outstanding.filter((p) => selected.has(p.id));
  const total = useMemo(() => chosen.reduce((n, p) => n + p.amountCents, 0), [chosen]);
  const owedTotal = outstanding.reduce((n, p) => n + p.amountCents, 0);

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allChosen = chosen.length === outstanding.length && outstanding.length > 0;
  const onlyOverdueChosen =
    overdueIds.length > 0 && chosen.length === overdueIds.length && overdueIds.every((id) => selected.has(id));

  // Um pai com meses seguidos por pagar quer saber que os está a pagar seguidos.
  const span = monthSpan(chosen);

  return (
    <div className="pt-3">
      <h1 className="px-1 text-[28px] leading-tight font-semibold tracking-[-0.03em] text-ink">Pagamentos</h1>

      {outstanding.length === 0 ? (
        <AllSettled />
      ) : (
        <>
          {/*
            O painel responde à selecção. Com nada escolhido mostra a dívida toda e
            diz o que fazer; com meses escolhidos mostra o que vai ser cobrado.
          */}
          <div className="mt-4 rounded-[var(--radius-xl)] bg-ink p-4 text-white" style={{ boxShadow: "var(--shadow-float)" }}>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold tracking-[0.06em] text-white/55 uppercase">
                {chosen.length > 0 ? "A pagar" : "Em dívida"}
              </span>
              <span className="text-[12px] font-medium text-white/55">
                {chosen.length > 0
                  ? `${chosen.length} de ${outstanding.length}`
                  : `${outstanding.length} ${outstanding.length === 1 ? "mensalidade" : "mensalidades"}`}
              </span>
            </div>

            <div className="mt-1.5">
              <Money cents={chosen.length > 0 ? total : owedTotal} size="xl" on />
            </div>

            <p className="mt-1.5 text-[13px] text-white/55">
              {chosen.length > 0 ? span : "Escolhe os meses que queres pagar."}
            </p>
          </div>

          {/*
            Os atalhos. Sem eles, pagar seis meses de atraso são seis toques em
            seis linhas — e a app parece um formulário em vez de uma carteira.
          */}
          <div className="mt-3 flex flex-wrap gap-2">
            <Quick active={allChosen} onClick={() => setSelected(new Set(outstanding.map((p) => p.id)))}>
              Todas · {money(owedTotal)}
            </Quick>
            {overdueIds.length > 0 && overdueIds.length < outstanding.length && (
              <Quick active={onlyOverdueChosen} onClick={() => setSelected(new Set(overdueIds))}>
                Só vencidas · {overdueIds.length}
              </Quick>
            )}
            {chosen.length > 0 && (
              <Quick active={false} onClick={() => setSelected(new Set())}>
                Limpar
              </Quick>
            )}
          </div>

          {/*
            Agrupado por educando: com dois filhos, "Agosto" aparecia duas vezes na
            mesma lista e a única diferença estava no meio da linha.
          */}
          <div className="mt-5 space-y-5">
            {groupByChild(outstanding).map(([childId, items]) => (
              <section key={childId}>
                {store.children.length > 1 && (
                  <header className="mb-2 flex items-center gap-2 px-1">
                    <Avatar name={childOf(childId)?.name ?? ""} photoUrl={childOf(childId)?.photoUrl} size={22} />
                    <h2 className="text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">{nameOf(childId)}</h2>
                  </header>
                )}
                <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface shadow-[var(--shadow-soft)]">
                  {items.map((p) => (
                    <MonthRow key={p.id} payment={p} selected={selected.has(p.id)} onToggle={() => toggle(p.id)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      {history.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 px-1 text-[12px] font-semibold tracking-[0.06em] text-ink-3 uppercase">Já pagas</h2>
          <ul className="overflow-hidden rounded-[var(--radius-lg)] bg-surface/60">
            {history.map((p) => (
              <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-0">
                <CheckCircle2 className="size-[18px] shrink-0 text-ok" strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate text-body font-medium text-ink-2">
                  {p.label}
                  {store.children.length > 1 && ` · ${nameOf(p.childId)}`}
                </span>
                <span className="num shrink-0 text-body font-semibold text-ink-3">{money(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Barra de pagamento — flutua acima da nav, aparece quando há algo escolhido. */}
      {sheet === "none" && chosen.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[480px] justify-center px-4 pb-[calc(84px+env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setSheet("method")}
            className="cta pointer-events-auto w-full max-w-[420px] justify-between gap-3 shadow-[var(--shadow-float)]"
          >
            <span className="text-[14px] font-medium text-white/70">
              {chosen.length} {chosen.length === 1 ? "mês" : "meses"}
            </span>
            <span className="num text-[17px] font-semibold">Pagar {money(total)}</span>
          </button>
        </div>
      )}

      {sheet === "method" && (
        <MethodSheet
          count={chosen.length}
          total={total}
          onClose={() => setSheet("none")}
          onPaid={(r) => {
            setResult(r);
            setSheet("result");
            void reload();
          }}
          charges={chosen}
        />
      )}

      {sheet === "result" && result && (
        <ResultSheet
          result={result}
          onClose={() => {
            setSheet("none");
            setResult(null);
          }}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Mantém a ordem por data de vencimento dentro de cada educando. */
function groupByChild(items: Payment[]): [string, Payment[]][] {
  const map = new Map<string, Payment[]>();
  for (const p of items) map.set(p.childId, [...(map.get(p.childId) ?? []), p]);
  return [...map.entries()];
}

/** "Agosto a Outubro" quando são meses seguidos; a lista quando não são. */
function monthSpan(chosen: Payment[]): string {
  if (chosen.length === 0) return "";
  if (chosen.length === 1) return chosen[0].label;

  const sorted = [...chosen].sort((a, b) => a.period.localeCompare(b.period));
  const periods = [...new Set(sorted.map((p) => p.period))];
  const consecutive = periods.every((period, i) => i === 0 || period === nextPeriod(periods[i - 1]));

  if (consecutive && periods.length > 2) return `${sorted[0].label} a ${sorted.at(-1)!.label}`;
  return [...new Set(sorted.map((p) => p.label))].join(" · ");
}

function nextPeriod(period: string): string {
  const [year, month] = period.split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function Quick({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "num inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors duration-200 active:scale-[0.97]",
        active ? "bg-ink text-white" : "bg-surface text-ink-2 shadow-[var(--shadow-soft)]",
      )}
    >
      {children}
    </button>
  );
}

/**
 * Uma linha por mês. A caixa de selecção à esquerda, onde se lê primeiro — à
 * direita competia com o valor, e a linha inteira parecia um botão de pagar.
 */
function MonthRow({ payment, selected, onToggle }: { payment: Payment; selected: boolean; onToggle: () => void }) {
  const overdue = payment.status === "overdue";

  return (
    <li className="border-b border-line last:border-0">
      <button
        type="button"
        onClick={onToggle}
        role="checkbox"
        aria-checked={selected}
        className={cx(
          "flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors duration-200",
          selected ? "bg-signal-soft" : "active:bg-sunken/50",
        )}
      >
        <span
          className={cx(
            "flex size-[22px] shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200",
            selected ? "border-transparent bg-signal-strong text-signal-on" : "border-line-strong",
          )}
        >
          {selected && <Check className="size-3.5" strokeWidth={3} />}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-semibold text-ink">{payment.label}</span>
          <span className={cx("block text-[12px] font-medium", overdue ? "text-risk" : "text-ink-3")}>
            {overdue ? `Venceu a ${dateShort(payment.dueDate)}` : `Vence a ${dateShort(payment.dueDate)}`}
          </span>
        </span>

        <span className="num shrink-0 text-[16px] font-semibold text-ink">{money(payment.amountCents)}</span>
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Folhas                                                                      */
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

type PayResult = {
  ok: number;
  failed: number;
  /** Referências Multibanco geradas, para quem prefere pagar na caixa. */
  references: { label: string; entity: string; reference: string }[];
  error?: string;
};

type StartedPayment = {
  method: string;
  entity: string | null;
  reference: string | null;
  status: string;
};

function MethodSheet({
  charges,
  count,
  total,
  onClose,
  onPaid,
}: {
  charges: Payment[];
  count: number;
  total: number;
  onClose: () => void;
  onPaid: (r: PayResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [phone, setPhone] = useState("");
  const [askPhone, setAskPhone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Uma mensalidade, um pagamento.
   *
   * O servidor cria a cobrança por `Charge` — pagar três é pedir três
   * referências. Falham-se umas e outras não: o que correu bem fica feito, e o
   * que falhou continua por pagar em vez de desaparecer sem explicação.
   */
  async function pay(method: "MBWAY" | "MULTIBANCO") {
    if (method === "MBWAY" && !phone.trim()) {
      setAskPhone(true);
      setError(null);
      return;
    }

    setBusy(true);
    setError(null);

    const references: PayResult["references"] = [];
    let ok = 0;
    let failed = 0;
    let firstError: string | undefined;

    for (const c of charges) {
      try {
        const p = await apiPost<StartedPayment>(`/billing/charges/${c.id}/pay`, {
          method,
          ...(method === "MBWAY" ? { payerPhone: phone.trim() } : {}),
        });
        ok++;
        if (p.entity && p.reference) {
          references.push({ label: c.label, entity: p.entity, reference: p.reference });
        }
      } catch (err) {
        failed++;
        firstError ??= err instanceof Error ? err.message : "Não foi possível iniciar o pagamento.";
      }
    }

    setBusy(false);
    onPaid({ ok, failed, references, error: firstError });
  }

  return (
    <Sheet onClose={onClose}>
      <div className="mb-4 flex items-baseline justify-between px-1">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">A pagar</p>
          <div className="mt-1">
            <Money cents={total} size="lg" />
          </div>
        </div>
        <span className="text-meta text-ink-3">
          {count} {count === 1 ? "mês" : "meses"}
        </span>
      </div>

      {askPhone && (
        <div className="mb-3">
          <label className="mb-1.5 block text-meta font-medium text-ink-3">Telemóvel do MB Way</label>
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="9xx xxx xxx"
            autoFocus
            className="h-12 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
          />
        </div>
      )}

      <div className="space-y-2">
        <button type="button" onClick={() => void pay("MBWAY")} disabled={busy} className="cta w-full justify-start gap-3">
          {busy ? <Loader className="size-5 animate-spin" strokeWidth={2} /> : <Smartphone className="size-5" strokeWidth={1.9} />}
          {askPhone ? "Confirmar MB Way" : "Pagar com MB Way"}
        </button>
        <button type="button" onClick={() => void pay("MULTIBANCO")} disabled={busy} className="cta-quiet w-full justify-start gap-3">
          <CreditCard className="size-5" strokeWidth={1.9} />
          Referência Multibanco
        </button>
      </div>

      {error && <p className="mt-3 text-meta text-risk">{error}</p>}

      <p className="mt-4 flex items-center justify-center gap-1.5 text-[12px] text-ink-4">
        <ShieldCheck className="size-3.5 shrink-0" strokeWidth={1.75} />
        Processado pela euPago. A academia nunca vê os teus dados bancários.
      </p>
    </Sheet>
  );
}

/**
 * O que aconteceu — sem prometer o que ainda não se sabe.
 *
 * O pedido seguiu; o pagamento só fica confirmado quando o banco responder ao
 * servidor. É por isso que aqui não há um "Pago" verde triunfante.
 */
function ResultSheet({ result, onClose }: { result: PayResult; onClose: () => void }) {
  const allFailed = result.ok === 0 && result.failed > 0;

  return (
    <Sheet onClose={onClose}>
      <div className="px-1 pb-2 text-center">
        {allFailed ? (
          <>
            <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-risk-soft text-risk">
              <TriangleAlert className="size-8" strokeWidth={2} />
            </span>
            <p className="text-[19px] font-semibold text-ink">Não foi possível</p>
            <p className="mx-auto mt-1.5 max-w-[32ch] text-meta leading-relaxed text-ink-3">
              {result.error ?? "Tenta outra vez daqui a pouco."}
            </p>
          </>
        ) : (
          <>
            <span className="pop mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
              <Check className="size-8" strokeWidth={2.5} />
            </span>
            <p className="text-[19px] font-semibold text-ink">Pedido enviado</p>
            <p className="mx-auto mt-1.5 max-w-[34ch] text-meta leading-relaxed text-ink-3">
              {result.ok === 1 ? "A mensalidade fica" : "As mensalidades ficam"} em “a confirmar” até o banco
              responder — recebes uma notificação assim que estiver pago.
            </p>
            {result.failed > 0 && (
              <p className="mx-auto mt-2 max-w-[34ch] text-meta text-warn">
                {result.failed} {result.failed === 1 ? "não seguiu" : "não seguiram"} e continuam por pagar.
              </p>
            )}
          </>
        )}

        {result.references.length > 0 && (
          <div className="mt-5 space-y-2 text-left">
            <p className="px-1 text-[11px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
              Referências Multibanco
            </p>
            {result.references.map((r) => (
              <MbRef key={r.reference} {...r} />
            ))}
          </div>
        )}

        <button type="button" onClick={onClose} className="cta mt-6 w-full">
          Concluir
        </button>
      </div>
    </Sheet>
  );
}

/** A referência copiável — para se poder pagar na caixa sem a escrever à mão. */
function MbRef({ label, entity, reference }: { label: string; entity: string; reference: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-surface p-3.5 shadow-[var(--shadow-soft)]">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] text-ink-3">{label}</p>
        <p className="num text-body font-semibold text-ink">
          {entity} · {reference}
        </p>
      </div>
      <button
        type="button"
        aria-label="Copiar referência"
        onClick={() => {
          void navigator.clipboard?.writeText(reference);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-2 active:scale-95"
      >
        {copied ? <Check className="size-4 text-ok" strokeWidth={2.5} /> : <Copy className="size-4" strokeWidth={1.9} />}
      </button>
    </div>
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
      <p className="mx-auto mt-1.5 max-w-[30ch] text-meta text-ink-3">Sem valores em dívida.</p>
    </div>
  );
}
