import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { AvailabilityTag, DataTable, Empty, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { CalendarDays, HeartPulse, Plus } from "@/lib/icons";
import { ClinicalEntryDialog } from "@/components/ClinicalEntryDialog";
import { listAthletes, teamById, today } from "@/lib/api";
import { activeRestriction, availabilityOf, clinicalOf, useClinicalRecords } from "@/lib/clinical";
import { relativeDays, shortDate, shortName } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import { useSession } from "@/session";
import type { Athlete } from "@/data/types";

type Filter = "todos" | "baixa" | "condicionado" | "exames";

/**
 * Boletins — a lista de trabalho do departamento clínico.
 *
 * É a mesma população de "Atletas", mas ordenada por outra pergunta: quem está
 * parado e quem precisa de ser visto. Por isso o estado clínico é a primeira
 * coluna, e a ordenação põe primeiro quem está parado.
 */
export default function MedicalClinical() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState<"done" | "scheduled" | null>(null);

  useClinicalRecords();

  const filter = (params.get("filtro") ?? "todos") as Filter;
  const setFilter = (v: Filter) => setParams(v === "todos" ? {} : { filtro: v });

  const athletes = listAthletes(session);

  const counts = useMemo(
    () => ({
      todos: athletes.length,
      baixa: athletes.filter((a) => availabilityOf(a.id) === "out").length,
      condicionado: athletes.filter((a) => availabilityOf(a.id) === "limited").length,
      exames: athletes.filter((a) => new Date(a.medicalValidUntil) < today).length,
    }),
    [athletes],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return athletes
      .filter((a) => {
        if (filter === "baixa") return availabilityOf(a.id) === "out";
        if (filter === "condicionado") return availabilityOf(a.id) === "limited";
        if (filter === "exames") return new Date(a.medicalValidUntil) < today;
        return true;
      })
      .filter((a) => (q ? a.name.toLowerCase().includes(q) : true))
      // Quem está parado primeiro: é onde está o trabalho.
      .sort((a, b) => {
        const rank = (x: Athlete) => (availabilityOf(x.id) === "out" ? 0 : availabilityOf(x.id) === "limited" ? 1 : 2);
        return rank(a) - rank(b) || a.name.localeCompare(b.name, "pt");
      });
  }, [athletes, filter, query]);

  const columns: Column<Athlete>[] = [
    {
      key: "athlete",
      header: "Atleta",
      render: (a) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={a.name} photoUrl={a.photoUrl} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{shortName(a.name)}</div>
            <div className="text-meta text-ink-3">{teamById(a.teamId)?.name}</div>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Estado",
      render: (a) => {
        const av = availabilityOf(a.id);
        return av === "available" ? <Pill tone="ok">Apto</Pill> : <AvailabilityTag availability={av} size="sm" />;
      },
    },
    {
      key: "reason",
      header: "Motivo",
      hideBelow: "md",
      render: (a) => {
        const entry = activeRestriction(a.id);
        return entry ? (
          <span className="text-ink-2">{entry.title}</span>
        ) : (
          <span className="text-ink-4">—</span>
        );
      },
    },
    {
      key: "return",
      header: "Retoma",
      hideBelow: "sm",
      render: (a) => {
        const entry = activeRestriction(a.id);
        if (!entry?.expectedReturn) return <span className="text-ink-4">—</span>;
        const d = new Date(entry.expectedReturn);
        return (
          <span className={d < today ? "font-medium text-warn" : "text-ink-2"}>{relativeDays(d, today)}</span>
        );
      },
    },
    {
      key: "exam",
      header: "Exame",
      hideBelow: "lg",
      render: (a) => {
        const d = new Date(a.medicalValidUntil);
        if (d < today) return <Pill tone="risk">Expirado</Pill>;
        if (d.getTime() < today.getTime() + 30 * 86_400_000) return <Pill tone="warn">Até {shortDate(d)}</Pill>;
        return <span className="text-meta text-ink-3 tabular">Até {shortDate(d)}</span>;
      },
    },
    {
      key: "entries",
      header: "Registos",
      align: "right",
      render: (a) => <span className="text-meta text-ink-3 tabular">{clinicalOf(a.id).length}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Boletins clínicos"
        subtitle={
          isAcademyWide(session)
            ? `Historial clínico de toda a academia · ${athletes.length} atletas`
            : `Os atletas das tuas equipas · ${athletes.length} fichas`
        }
      >
        {/* O departamento clínico regista a partir daqui, sem ter de navegar até
            à ficha de cada atleta — é a acção mais frequente do dia dele. */}
        {can(session, "clinical:write") && (
          <>
            <button type="button" onClick={() => setComposing("scheduled")} className="ctl-outline">
              <CalendarDays className="size-3.5" strokeWidth={1.75} />
              Agendar
            </button>
            <button type="button" onClick={() => setComposing("done")} className="ctl-primary">
              <Plus className="size-3.5" strokeWidth={2} />
              Novo registo
            </button>
          </>
        )}
      </PageHeader>

      <Panel>
        <Toolbar>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "todos", label: "Todos", count: counts.todos },
              { value: "baixa", label: "De baixa", count: counts.baixa },
              { value: "condicionado", label: "Condicionados", count: counts.condicionado },
              { value: "exames", label: "Exame expirado", count: counts.exames },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
          <ResultCount n={rows.length} noun={["atleta", "atletas"]} />
        </Toolbar>

        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(a) => a.id}
          // O boletim vive na ficha do atleta, que já o tem completo. Uma forma
          // de lá chegar, não duas a divergirem com o tempo.
          to={(a) => `/atletas/${a.id}`}
          empty={<Empty icon={HeartPulse} title="Nenhum atleta neste filtro" />}
        />
      </Panel>

      {composing && (
        <ClinicalEntryDialog session={session} defaultMode={composing} onClose={() => setComposing(null)} />
      )}
    </>
  );
}
