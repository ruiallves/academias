import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Dialog } from "@/components/Dialog";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, cx, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { Check, ChevronDown, CircleCheck, Download, Search, Send, Settings, TriangleAlert, Users, Wallet } from "@/lib/icons";
import {
  arrears,
  athleteById,
  availablePeriods,
  currentPeriod,
  feeSummary,
  listAllFees,
  listAthletes,
  listFees,
  listTeams,
  teamById,
  today,
} from "@/lib/api";
import { apiPatch, apiPost, apiPut } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { money, percent, periodLabel, relativeDays, shortName } from "@/lib/format";
import { can } from "@/lib/permissions";
import type { Fee, FeeStatus } from "@/data/types";
import { useSession } from "@/session";

const STATUS_LABEL: Record<FeeStatus, string> = {
  paid: "Pago",
  processing: "A confirmar",
  pending: "Pendente",
  overdue: "Vencido",
  void: "Anulada",
};

const STATUS_TONE = { paid: "ok", processing: "signal", pending: "warn", overdue: "risk", void: "neutral" } as const;

/** As mesmas cores do `Pill` partilhado — aqui à parte porque o rótulo do estado
 * passa a ser o próprio botão (texto + seta juntos), não um `<Pill>` por dentro. */
const TONE_CLASS: Record<(typeof STATUS_TONE)[keyof typeof STATUS_TONE], string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  risk: "bg-risk-soft text-risk",
  neutral: "bg-sunken text-ink-2",
  signal: "bg-signal-soft text-signal-ink",
};

/**
 * As três decisões que a direção pode tomar à mão sobre uma mensalidade, e o estado
 * (`ChargeStatus`) que cada uma grava. "A confirmar" e "Vencido" não são opções —
 * são derivados (do pagamento em curso, da data), não escolhas.
 */
const MANUAL_OPTIONS = [
  { value: "SETTLED", label: "Marcar como paga", tone: "ok" as const },
  { value: "OPEN", label: "Marcar por pagar", tone: "warn" as const },
  { value: "VOID", label: "Anular", tone: "neutral" as const },
];

/** Qual das opções manuais corresponde ao estado atual — para a assinalar no menu. */
function currentTarget(status: FeeStatus): string {
  if (status === "paid") return "SETTLED";
  if (status === "void") return "VOID";
  return "OPEN";
}

const ALL = "all" as const;

export default function Fees() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const estado = (params.get("estado") ?? "todos") as FeeStatus | "todos";
  const setEstado = (v: FeeStatus | "todos") => {
    const next = new URLSearchParams(params);
    v === "todos" ? next.delete("estado") : next.set("estado", v);
    setParams(next, { replace: true });
  };

  // A dívida vencida vem de "?estado=overdue" a partir de "Precisa de atenção" —
  // e uma dívida antiga pode estar num mês que já não é o corrente. Por isso, se
  // se chega aqui a filtrar vencidas, o período abre em "Todos" para não escondê-la.
  const [period, setPeriod] = useState<string>(estado === "overdue" ? ALL : currentPeriod);

  const periods = availablePeriods();
  const debt = arrears(session);

  const rows: Fee[] = period === ALL ? listAllFees(session) : listFees(session, period);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const order: Record<FeeStatus, number> = { overdue: 0, pending: 1, processing: 2, paid: 3, void: 4 };
    return rows
      .filter((f) => (estado === "todos" ? true : f.status === estado))
      .filter((f) => (q ? (athleteById(f.athleteId)?.name ?? "").toLowerCase().includes(q) : true))
      .sort(
        (a, b) =>
          order[a.status] - order[b.status] ||
          b.period.localeCompare(a.period) ||
          a.dueDate.localeCompare(b.dueDate),
      );
  }, [rows, estado, query]);

  const scopedSummary = period === ALL ? summariseAll(rows) : feeSummary(session, period);
  const label = period === ALL ? "todos os períodos" : periodLabel(period);

  // A direção acerta o estado à mão — dinheiro em mão, uma bolsa, uma correção.
  const mayEditFees = can(session, "billing:write");
  const [pricesOpen, setPricesOpen] = useState(false);
  const [athletePricesOpen, setAthletePricesOpen] = useState(false);
  const [sendingReminders, setSendingReminders] = useState(false);
  const [reminderResult, setReminderResult] = useState<string | null>(null);

  async function sendReminders() {
    setSendingReminders(true);
    setReminderResult(null);
    try {
      const res = await apiPost<{ sent: number; athletes: number; overdue: number }>("/api/charges/reminders", {});
      setReminderResult(
        res.sent > 0
          ? `Lembrete enviado a ${res.athletes} ${res.athletes === 1 ? "família" : "famílias"}.`
          : res.overdue > 0
            // Há dívida, mas ninguém por avisar de novo — já se avisou hoje, e
            // reenviar não fazia o pagamento chegar mais depressa.
            ? "Já foram todos avisados hoje — o próximo lembrete só sai amanhã."
            : "Sem mensalidades vencidas.",
      );
    } catch (err) {
      setReminderResult(err instanceof Error ? err.message : "Não foi possível enviar os lembretes.");
    } finally {
      setSendingReminders(false);
    }
  }

  const allColumns: Column<Fee>[] = [
    {
      key: "athlete",
      header: "Atleta",
      render: (f) => {
        const a = athleteById(f.athleteId);
        return (
          <div className="flex items-center gap-2.5">
            <Monogram name={a?.name ?? "?"} photoUrl={a?.photoUrl} />
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{shortName(a?.name ?? "—")}</div>
              <div className="text-meta text-ink-3">{teamById(a?.teamId ?? "")?.name}</div>
            </div>
          </div>
        );
      },
    },
    // Só faz sentido quando se misturam períodos — dentro de um único mês seria
    // uma coluna a repetir o mesmo valor em todas as linhas.
    {
      key: "period",
      header: "Período",
      hideBelow: "sm",
      render: (f) => <span className="text-ink-2">{periodLabel(f.period)}</span>,
    },
    {
      key: "due",
      header: "Vencimento",
      hideBelow: "sm",
      render: (f) => {
        const d = new Date(f.dueDate);
        const late = f.status === "overdue";
        return <span className={late ? "font-medium text-risk" : "text-ink-3"}>{relativeDays(d, today)}</span>;
      },
    },
    {
      key: "method",
      header: "Método",
      hideBelow: "lg",
      render: (f) =>
        f.method ? (
          <span className="text-ink-2">{f.method}</span>
        ) : f.reference ? (
          <span className="font-mono text-meta text-ink-3">{f.reference}</span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
    {
      key: "status",
      header: "Estado",
      render: (f) =>
        mayEditFees ? (
          <FeeStatusControl fee={f} />
        ) : (
          <Pill tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Pill>
        ),
    },
    {
      key: "amount",
      header: "Valor",
      align: "right",
      width: "112px",
      render: (f) => <span className="font-medium text-ink tabular">{money(f.amountCents)}</span>,
    },
  ];

  const columns = allColumns.filter((c) => c.key !== "period" || period === ALL);

  return (
    <>
      <PageHeader
        eyebrow={capitalize(label)}
        title="Mensalidades"
        subtitle="O estado de cada mensalidade é confirmado pelo webhook da euPago, nunca pelo navegador."
      >
        <button type="button" className="ctl-outline">
          <Download className="size-3.5" strokeWidth={1.75} />
          Exportar
        </button>
        {mayEditFees && (
          <>
            <button type="button" className="ctl-outline" onClick={() => setPricesOpen(true)}>
              <Settings className="size-3.5" strokeWidth={1.75} />
              Preços por equipa
            </button>
            <button type="button" className="ctl-outline" onClick={() => setAthletePricesOpen(true)}>
              <Users className="size-3.5" strokeWidth={1.75} />
              Preço por atleta
            </button>
          </>
        )}
        <button
          type="button"
          className="ctl-primary"
          onClick={() => void sendReminders()}
          disabled={sendingReminders || debt.count === 0}
          title={debt.count === 0 ? "Sem mensalidades vencidas" : undefined}
        >
          <Send className="size-3.5" strokeWidth={1.75} />
          {sendingReminders ? "A enviar…" : "Enviar lembretes"}
          {debt.count > 0 && !sendingReminders && (
            <span className="ml-0.5 rounded-full bg-white/15 px-1.5 text-[11px] tabular">{debt.count}</span>
          )}
        </button>
      </PageHeader>

      <div className="space-y-3">
        {reminderResult && (
          <p className="flex items-center gap-2 rounded-[var(--radius-panel)] border border-line bg-surface px-4 py-2.5 text-meta text-ink-2">
            <Send className="size-3.5 shrink-0 text-ink-3" strokeWidth={1.75} />
            {reminderResult}
          </p>
        )}

        {/* Dívida real: soma todos os períodos, sempre — independente do filtro
            abaixo, porque uma mensalidade de março não deixa de ser dinheiro em
            falta só porque se está a olhar para agosto. */}
        {debt.count > 0 && (
          <button
            type="button"
            onClick={() => {
              setPeriod(ALL);
              setEstado("overdue");
            }}
            className="flex w-full items-center gap-3 rounded-[var(--radius-panel)] border border-risk/25 bg-risk-soft px-4 py-3 text-left transition-colors duration-[120ms] hover:border-risk/40"
          >
            <TriangleAlert className="size-4 shrink-0 text-risk" strokeWidth={1.75} />
            <span className="min-w-0 flex-1 text-body text-risk">
              <strong className="font-semibold">{money(debt.cents)}</strong> em dívida no total, em{" "}
              <strong className="font-semibold">{debt.count}</strong> mensalidades de {debt.athletes}{" "}
              {debt.athletes === 1 ? "família" : "famílias"}
              {debt.chronic > 0 && (
                <>
                  {" "}
                  · <strong className="font-semibold">{debt.chronic}</strong> com mais de um mês em atraso
                </>
              )}
            </span>
            <span className="shrink-0 text-meta font-medium text-risk underline">Ver tudo</span>
          </button>
        )}

        <MetricRow>
          <Metric label="Facturado" value={money(scopedSummary.billedCents, { compact: true })} note={`${scopedSummary.total} mensalidades · ${label}`} />
          <Metric
            label="Cobrado"
            value={money(scopedSummary.collectedCents, { compact: true })}
            icon={Wallet}
            note={`${percent(scopedSummary.billedCents ? scopedSummary.collectedCents / scopedSummary.billedCents : 0)} do período`}
          />
          <Metric label="Por cobrar" value={money(scopedSummary.billedCents - scopedSummary.collectedCents, { compact: true })} note={`${scopedSummary.pending + scopedSummary.processing} em curso`} />
          <Metric label="Vencido, total" value={money(debt.cents, { compact: true })} note="todos os períodos" />
        </MetricRow>

        <Panel>
          <Toolbar>
            <Select
              label="Período"
              value={period}
              onChange={setPeriod}
              options={[
                { value: ALL, label: "Todos os períodos" },
                ...periods.map((p) => ({ value: p, label: periodLabel(p) })),
              ]}
            />
            <Segmented
              value={estado}
              onChange={setEstado}
              options={[
                { value: "todos", label: "Todas", count: rows.length },
                { value: "overdue", label: "Vencidas", count: rows.filter((f) => f.status === "overdue").length },
                { value: "pending", label: "Pendentes", count: rows.filter((f) => f.status === "pending").length },
                { value: "processing", label: "A confirmar", count: rows.filter((f) => f.status === "processing").length },
                { value: "paid", label: "Pagas", count: rows.filter((f) => f.status === "paid").length },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
            <ResultCount n={filtered.length} noun={["mensalidade", "mensalidades"]} />
          </Toolbar>

          <DataTable
            columns={columns}
            rows={filtered}
            keyOf={(f) => f.id}
            to={(f) => `/atletas/${f.athleteId}`}
            empty={
              estado === "overdue" ? (
                <Empty icon={CircleCheck} tone="ok" title="Nada vencido" detail={`Sem mensalidades vencidas em ${label}.`} />
              ) : (
                <Empty title="Sem mensalidades neste filtro" />
              )
            }
          />
        </Panel>
      </div>

      {pricesOpen && <TeamFeesDialog session={session} onClose={() => setPricesOpen(false)} />}
      {athletePricesOpen && <AthleteFeesDialog session={session} onClose={() => setAthletePricesOpen(false)} />}
    </>
  );
}

/**
 * Preços por equipa — o valor por omissão que cada atleta paga.
 *
 * Ajustar aqui é em lote: muda o preço de todos os atletas da equipa que não
 * tenham um ajuste individual (esse continua a sobrepor-se). Quem precisa de um
 * valor diferente para um atleta em concreto — bolsa, desconto de irmãos — faz
 * isso na ficha do atleta, separador Mensalidades, e não aqui.
 */
function TeamFeesDialog({
  session,
  onClose,
}: {
  session: ReturnType<typeof useSession>["session"];
  onClose: () => void;
}) {
  const teams = listTeams(session);

  return (
    <Dialog
      labelledBy="precos-por-equipa"
      title="Preços por equipa"
      subtitle="O preço por omissão de cada atleta — o ajuste individual, na ficha do atleta, sobrepõe-se."
      onClose={onClose}
      width={480}
      footer={
        <button type="button" onClick={onClose} className="ctl-primary">
          Concluído
        </button>
      }
    >
      {teams.length === 0 ? (
        <div className="px-5 py-10">
          <Empty title="Sem equipas ainda" />
        </div>
      ) : (
        <ul>
          {teams.map((t) => (
            <li key={t.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">{t.name}</div>
                <div className="text-meta text-ink-3">
                  {t.athleteIds.length} {t.athleteIds.length === 1 ? "atleta" : "atletas"}
                </div>
              </div>
              <TeamFeeInput teamId={t.id} amountCents={t.feeCents} />
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/**
 * O valor em edição inline — euros, não cêntimos, porque é assim que a direção
 * pensa no preço. Sem preço ainda, mostra-se vazio com uma indicação, nunca "0,00 €"
 * a fingir que alguém já decidiu que é grátis.
 */
function TeamFeeInput({ teamId, amountCents }: { teamId: string; amountCents: number | null }) {
  const [value, setValue] = useState(amountCents !== null ? (amountCents / 100).toFixed(2) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  // O valor guardado muda de baixo para cima (outra pessoa editou, ou a nossa
  // própria gravação recarregou a academia) — segue-se, a não ser que haja algo
  // por gravar neste campo neste preciso instante.
  useEffect(() => {
    if (!busy) setValue(amountCents !== null ? (amountCents / 100).toFixed(2) : "");
  }, [amountCents, busy]);

  async function commit() {
    const trimmed = value.trim().replace(",", ".");
    const cents = Math.round(Number(trimmed) * 100);
    if (!trimmed || !Number.isFinite(cents) || cents === amountCents) return;

    setBusy(true);
    setError(false);
    try {
      await apiPatch(`/api/teams/${teamId}/fee`, { amountCents: cents });
      await reloadAcademy();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <label className="flex items-center gap-1.5">
      <span className={cx("text-body", value ? "text-ink-3" : "text-ink-4")}>€</span>
      <input
        type="text"
        inputMode="decimal"
        value={value}
        placeholder="por configurar"
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        className={cx(
          "h-8 w-28 rounded-[var(--radius-control)] border bg-surface px-2 text-right text-body tabular focus:outline-none",
          error ? "border-risk" : "border-line focus:border-line-strong",
        )}
      />
    </label>
  );
}

/**
 * Preço por atleta — o mesmo ajuste individual de sempre, aplicado a vários
 * atletas escolhidos de uma vez.
 *
 * Existe para o caso em que um valor diferente não pertence a uma equipa
 * inteira nem a um atleta só: uma bolsa que abrange três irmãos, um acordo
 * pontual com um grupo. Cada atleta escolhido passa a ter o mesmo ajuste
 * individual de `PUT /api/athletes/:id/fee` — sobrepõe-se ao preço da equipa, e
 * fica assim até alguém o reverter na ficha do próprio atleta.
 */
function AthleteFeesDialog({
  session,
  onClose,
}: {
  session: ReturnType<typeof useSession>["session"];
  onClose: () => void;
}) {
  const athletes = listAthletes(session);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = q ? athletes.filter((a) => a.name.toLowerCase().includes(q)) : athletes;

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  async function apply() {
    const cents = Math.round(Number(amount.trim().replace(",", ".")) * 100);
    if (selected.size === 0) {
      setError("Escolhe pelo menos um atleta.");
      return;
    }
    if (!Number.isFinite(cents) || cents < 100) {
      setError("Indica um valor válido, de pelo menos 1 €.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      await apiPut("/api/athletes/fee", { athleteIds: [...selected], amountCents: cents });
      await reloadAcademy();
      setResult(`Ajustados ${selected.size} ${selected.size === 1 ? "atleta" : "atletas"}.`);
      setSelected(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="preco-por-atleta"
      title="Preço por atleta"
      subtitle="Um ajuste individual, aplicado a vários atletas de uma vez — sobrepõe-se ao preço da equipa."
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Fechar
          </button>
          <button type="button" onClick={() => void apply()} disabled={busy} className="ctl-primary">
            {busy ? "A aplicar…" : `Aplicar a ${selected.size || ""} ${selected.size === 1 ? "atleta" : "atletas"}`.trim()}
          </button>
        </>
      }
    >
      <div className="border-b border-line p-4">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-4" strokeWidth={1.75} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Procurar atleta…"
            autoFocus
            className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface pr-3 pl-8 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
          />
        </div>
      </div>

      <ul className="max-h-[300px] overflow-y-auto">
        {visible.length === 0 ? (
          <li className="px-5 py-8 text-center text-meta text-ink-4">Ninguém com esse nome.</li>
        ) : (
          visible.map((a) => {
            const on = selected.has(a.id);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => toggle(a.id)}
                  aria-pressed={on}
                  className={cx(
                    "flex w-full items-center gap-2.5 border-b border-line px-4 py-2.5 text-left transition-colors duration-[120ms] last:border-0",
                    on ? "bg-signal-soft/60" : "hover:bg-sunken",
                  )}
                >
                  <span
                    className={cx(
                      "flex size-5 shrink-0 items-center justify-center rounded-[6px] border transition-colors duration-[120ms]",
                      on ? "border-transparent bg-signal-strong text-signal-on" : "border-line-strong",
                    )}
                  >
                    {on && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-ink">{a.name}</span>
                    <span className="block truncate text-meta text-ink-3">{teamById(a.teamId)?.name ?? "—"}</span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <div className="border-t border-line p-4">
        <label className="mb-1.5 block text-meta font-medium text-ink-3">Valor individual, por mês</label>
        <div className="flex items-center gap-2">
          <span className="text-body text-ink-3">€</span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0,00"
            className="h-9 w-32 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body tabular focus:border-line-strong focus:outline-none"
          />
        </div>
        {error && <p className="mt-2 text-meta text-risk">{error}</p>}
        {result && <p className="mt-2 text-meta text-ok">{result}</p>}
      </div>
    </Dialog>
  );
}

/**
 * O estado de uma mensalidade, editável pela direção.
 *
 * O Pill continua a dizer tudo — "Vencido", "A confirmar", "Anulada" —, mas passa a
 * ser um gatilho: um clique abre as três decisões manuais. O menu vive num **portal**
 * (em `document.body`) porque a tabela recorta o que transborda; sem isso, um menu
 * aberto na última linha ficava cortado por baixo.
 */
/** Altura aproximada do menu — três opções fixas, sempre o mesmo tamanho. */
const STATUS_MENU_HEIGHT = 120;

function FeeStatusControl({ fee }: { fee: Fee }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const target = currentTarget(fee.status);

  useEffect(() => {
    if (!open) return;
    // Scroll ou redimensionar fecha o menu — não vale a pena persegui-lo pela página.
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const toggle = (e: React.MouseEvent) => {
    // A linha inteira navega para a ficha do atleta — sem isto, abrir o menu de
    // estado levava também para lá, a meio do clique. `preventDefault` também,
    // para nenhum comportamento por omissão do botão escapar ao `stopPropagation`.
    e.preventDefault();
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.max(8, r.right - 180);
      const spaceBelow = window.innerHeight - r.bottom;
      // Cabe por baixo? Abre por baixo. Senão, e se couber por cima, abre por
      // cima — é a última linha da tabela que mais precisa disto, cortada ao
      // fundo do ecrã sempre que o menu insistia em abrir para baixo.
      if (spaceBelow >= STATUS_MENU_HEIGHT + 8 || r.top < STATUS_MENU_HEIGHT + 8) {
        setPos({ top: r.bottom + 4, left });
      } else {
        setPos({ bottom: window.innerHeight - r.top + 4, left });
      }
    }
    setOpen((v) => !v);
  };

  async function choose(e: React.MouseEvent, value: string) {
    // Mesma razão do `toggle`: um portal continua a ser filho da linha na árvore
    // React (mesmo vivendo fisicamente em `document.body`), e o clique borbulha
    // até ao `onClick` da linha se não se parar aqui.
    e.stopPropagation();
    setOpen(false);
    if (value === target || busy) return;
    setBusy(true);
    try {
      await apiPatch(`/api/charges/${fee.id}/status`, { status: value });
      await reloadAcademy();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Alterar estado"
        className={cx(
          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] leading-tight font-semibold transition-opacity duration-[120ms] hover:opacity-75 disabled:opacity-50",
          TONE_CLASS[STATUS_TONE[fee.status]],
        )}
      >
        {STATUS_LABEL[fee.status]}
        <ChevronDown className="size-3" strokeWidth={2.5} />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
              }}
              aria-hidden
            />
            <div
              role="menu"
              style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
              className="fixed z-50 w-[180px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
            >
              {MANUAL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitem"
                  onClick={(e) => void choose(e, o.value)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-body transition-colors duration-[120ms] hover:bg-sunken",
                    o.value === target ? "text-ink" : "text-ink-2",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-signal-ink">
                    {o.value === target && <Check className="size-3.5" strokeWidth={2.5} />}
                  </span>
                  <span className="flex-1">{o.label}</span>
                </button>
              ))}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function summariseAll(rows: Fee[]) {
  const sum = (pred: (f: Fee) => boolean) => rows.filter(pred).reduce((n, f) => n + f.amountCents, 0);
  return {
    total: rows.length,
    paid: rows.filter((f) => f.status === "paid").length,
    pending: rows.filter((f) => f.status === "pending").length,
    processing: rows.filter((f) => f.status === "processing").length,
    overdue: rows.filter((f) => f.status === "overdue").length,
    billedCents: sum(() => true),
    collectedCents: sum((f) => f.status === "paid"),
    overdueCents: sum((f) => f.status === "overdue"),
  };
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
