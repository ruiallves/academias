import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, cx, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { Check, ChevronDown, CircleCheck, Download, Send, TriangleAlert, Wallet } from "@/lib/icons";
import {
  arrears,
  athleteById,
  availablePeriods,
  currentPeriod,
  feeSummary,
  listAllFees,
  listFees,
  teamById,
  today,
} from "@/lib/api";
import { apiPatch } from "@/lib/http";
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

  const allColumns: Column<Fee>[] = [
    {
      key: "athlete",
      header: "Atleta",
      render: (f) => {
        const a = athleteById(f.athleteId);
        return (
          <div className="flex items-center gap-2.5">
            <Monogram name={a?.name ?? "?"} />
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
        <button type="button" className="ctl-primary">
          <Send className="size-3.5" strokeWidth={1.75} />
          Enviar lembretes
          {debt.count > 0 && <span className="ml-0.5 rounded-full bg-white/15 px-1.5 text-[11px] tabular">{debt.count}</span>}
        </button>
      </PageHeader>

      <div className="space-y-3">
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
    </>
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
function FeeStatusControl({ fee }: { fee: Fee }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
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

  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, left: Math.max(8, r.right - 180) });
    setOpen((v) => !v);
  };

  async function choose(value: string) {
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
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Alterar estado"
        className="inline-flex items-center gap-1 rounded-full transition-opacity duration-[120ms] hover:opacity-75 disabled:opacity-50"
      >
        <Pill tone={STATUS_TONE[fee.status]}>{STATUS_LABEL[fee.status]}</Pill>
        <ChevronDown className="size-3 text-ink-4" strokeWidth={2} />
      </button>

      {open &&
        pos &&
        createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <div
              role="menu"
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-50 w-[180px] rounded-[var(--radius-panel)] border border-line bg-surface p-1 shadow-[var(--shadow-pop)]"
            >
              {MANUAL_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="menuitem"
                  onClick={() => void choose(o.value)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-body transition-colors duration-[120ms] hover:bg-sunken",
                    o.value === target ? "text-ink" : "text-ink-2",
                  )}
                >
                  <span className="flex size-4 shrink-0 items-center justify-center text-signal">
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
