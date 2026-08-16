import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { CircleCheck, Download, Send, TriangleAlert, Wallet } from "@/lib/icons";
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
import { money, percent, periodLabel, relativeDays, shortName } from "@/lib/format";
import type { Fee, FeeStatus } from "@/data/types";
import { useSession } from "@/session";

const STATUS_LABEL: Record<FeeStatus, string> = {
  paid: "Pago",
  processing: "A confirmar",
  pending: "Pendente",
  overdue: "Vencido",
};

const STATUS_TONE = { paid: "ok", processing: "signal", pending: "warn", overdue: "risk" } as const;

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
    const order: Record<FeeStatus, number> = { overdue: 0, pending: 1, processing: 2, paid: 3 };
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
      render: (f) => <Pill tone={STATUS_TONE[f.status]}>{STATUS_LABEL[f.status]}</Pill>,
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
