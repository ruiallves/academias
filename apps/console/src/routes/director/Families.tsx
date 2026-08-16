import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { Home, Send } from "@/lib/icons";
import { athleteById, currentPeriod, listFees, listGuardians, teamById } from "@/lib/api";
import { percent, shortName } from "@/lib/format";
import type { Guardian } from "@/data/types";
import { useSession } from "@/session";

/**
 * Famílias.
 *
 * A coluna que interessa e que nenhum concorrente tem: **quem já instalou a app**.
 * Uma família sem app continua a viver no WhatsApp — é ali que o produto ainda não
 * chegou, e é essa a lista de trabalho da secretaria.
 */
export default function Families() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");

  const filter = params.get("filtro") ?? "todas";
  const setFilter = (v: string) => setParams(v === "todas" ? {} : { filtro: v });

  const guardians = listGuardians();
  const fees = listFees(session, currentPeriod);
  const feeByAthlete = useMemo(() => new Map(fees.map((f) => [f.athleteId, f])), [fees]);
  const withApp = guardians.filter((g) => g.appInstalled).length;

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return guardians
      .filter((g) => (filter === "sem-app" ? !g.appInstalled : true))
      .filter((g) => (q ? g.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [guardians, filter, query]);

  const columns: Column<Guardian>[] = [
    {
      key: "name",
      header: "Encarregado",
      render: (g) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={g.name} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{g.name}</div>
            <div className="text-meta text-ink-3">{g.relation}</div>
          </div>
        </div>
      ),
    },
    {
      key: "children",
      header: "Educandos",
      render: (g) => (
        <div className="flex flex-col gap-0.5">
          {g.athleteIds.map((id) => {
            const a = athleteById(id);
            return (
              <span key={id} className="truncate text-ink-2">
                {shortName(a?.name ?? "—")}
                <span className="text-ink-4"> · {teamById(a?.teamId ?? "")?.name}</span>
              </span>
            );
          })}
        </div>
      ),
    },
    {
      key: "contact",
      header: "Contacto",
      hideBelow: "lg",
      render: (g) => (
        <div className="min-w-0">
          <div className="truncate text-ink-2 tabular">{g.phone}</div>
          <div className="truncate text-meta text-ink-4">{g.email}</div>
        </div>
      ),
    },
    {
      key: "app",
      header: "App",
      hideBelow: "sm",
      render: (g) =>
        g.appInstalled ? <Pill tone="ok">Instalada</Pill> : <Pill tone="warn">Por instalar</Pill>,
    },
    {
      key: "fee",
      header: "Agosto",
      align: "right",
      render: (g) => {
        const statuses = g.athleteIds.map((id) => feeByAthlete.get(id)?.status).filter(Boolean);
        if (statuses.length === 0) return <span className="text-ink-4">—</span>;
        // A família tem o pior estado dos seus educandos — é assim que a secretaria pensa.
        const worst = statuses.includes("overdue")
          ? "overdue"
          : statuses.includes("pending")
            ? "pending"
            : statuses.includes("processing")
              ? "processing"
              : "paid";
        const tone = { paid: "ok", processing: "signal", pending: "warn", overdue: "risk" } as const;
        const label = { paid: "Em dia", processing: "A confirmar", pending: "Pendente", overdue: "Vencido" };
        return <Pill tone={tone[worst]}>{label[worst]}</Pill>;
      },
    },
  ];

  return (
    <>
      <PageHeader title="Famílias" subtitle={`${guardians.length} encarregados de educação`}>
        <button type="button" className="ctl-primary">
          <Send className="size-3.5" strokeWidth={1.75} />
          Convidar para a app
        </button>
      </PageHeader>

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Famílias" value={String(guardians.length)} icon={Home} note="com educandos activos" />
          <Metric label="Com a app instalada" value={percent(withApp / guardians.length)} note={`${withApp} de ${guardians.length}`} />
          <Metric label="Ainda no WhatsApp" value={String(guardians.length - withApp)} note="por convidar" />
          <Metric label="Pagamento automático" value="—" note="débito directo por activar" />
        </MetricRow>

        <Panel>
          <Toolbar>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "todas", label: "Todas", count: guardians.length },
                { value: "sem-app", label: "Sem a app", count: guardians.length - withApp },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Procurar família…" />
            <ResultCount n={rows.length} noun={["família", "famílias"]} />
          </Toolbar>

          <DataTable
            columns={columns}
            rows={rows}
            keyOf={(g) => g.id}
            empty={<Empty icon={Home} title="Nenhuma família corresponde" />}
          />
        </Panel>
      </div>
    </>
  );
}
