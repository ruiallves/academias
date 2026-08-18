import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { NewAthleteDialog } from "@/components/NewAthleteDialog";
import { ImportAthletesDialog } from "@/components/ImportAthletesDialog";
import { AvailabilityTag, DataTable, Empty, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Select, Toolbar } from "@/components/filters";
import { Plus, Upload, Users } from "@/lib/icons";
import { academy, currentPeriod, guardiansOf, listAthletes, listFees, listTeams, today } from "@/lib/api";
import { age, shortDate, shortName } from "@/lib/format";
import type { Athlete } from "@/data/types";
import { availabilityOf, useClinicalRecords } from "@/lib/clinical";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";

type MedicalState = "ok" | "soon" | "expired";

export default function Athletes() {
  const { session } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("all");
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  // Redesenha quando o departamento clínico mexe numa baixa.
  useClinicalRecords();

  const filter = params.get("filtro") ?? "todos";
  const setFilter = (v: string) => setParams(v === "todos" ? {} : { filtro: v });

  const athletes = listAthletes(session);
  const teams = listTeams(session);
  const fees = listFees(session, currentPeriod);
  const feeByAthlete = useMemo(() => new Map(fees.map((f) => [f.athleteId, f])), [fees]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return athletes
      .filter((a) => (team === "all" ? true : a.teamId === team))
      .filter((a) => {
        if (filter === "medico") return medicalState(a) !== "ok";
        if (filter === "baixa") return availabilityOf(a.id) !== "available";
        if (filter === "pausa") return a.status === "paused";
        return true;
      })
      .filter((a) => (q ? a.name.toLowerCase().includes(q) : true))
      .sort((a, b) => a.name.localeCompare(b.name, "pt"));
  }, [athletes, team, filter, query]);

  // O mesmo ecrã serve o diretor e o treinador — o que muda é o âmbito dos dados
  // (aplicado em listAthletes) e as colunas que as permissões deixam ver.
  const showBilling = can(session, "billing:read");
  const showGuardian = can(session, "family:read");

  const allColumns: Column<Athlete>[] = [
    {
      key: "name",
      header: "Atleta",
      render: (a) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={a.name} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium text-ink">{shortName(a.name)}</span>
              <AvailabilityTag availability={availabilityOf(a.id)} size="sm" />
            </div>
            <div className="text-meta text-ink-3 tabular">{age(new Date(a.birthdate), today)} anos</div>
          </div>
        </div>
      ),
    },
    {
      key: "team",
      header: "Equipa",
      render: (a) => <span className="text-ink-2">{teams.find((t) => t.id === a.teamId)?.name}</span>,
    },
    {
      key: "position",
      header: "Posição",
      hideBelow: "lg",
      // Natação não tem posições. A célula fica com um travessão em vez de uma
      // coluna vazia — a UI adapta-se por ausência, não por `if (desporto === …)`.
      render: (a) => <span className="text-ink-3">{a.position ?? "—"}</span>,
    },
    {
      key: "guardian",
      header: "Encarregado",
      hideBelow: "md",
      render: (a) => {
        const g = guardiansOf(a.id)[0];
        if (!g) return <span className="text-ink-4">—</span>;
        return (
          <div className="min-w-0">
            <div className="truncate text-ink-2">{shortName(g.name)}</div>
            <div className="text-meta text-ink-4">{g.appInstalled ? "app instalada" : "sem app"}</div>
          </div>
        );
      },
    },
    {
      key: "medical",
      header: "Ficha médica",
      hideBelow: "sm",
      render: (a) => {
        const state = medicalState(a);
        const d = new Date(a.medicalValidUntil);
        if (state === "expired") return <Pill tone="risk">Expirada</Pill>;
        if (state === "soon") return <Pill tone="warn">Até {shortDate(d)}</Pill>;
        return <span className="text-meta text-ink-3 tabular">Até {shortDate(d)}</span>;
      },
    },
    {
      key: "fee",
      header: "Agosto",
      align: "right",
      render: (a) => {
        const fee = feeByAthlete.get(a.id);
        if (!fee) return <span className="text-ink-4">—</span>;
        const tone = { paid: "ok", processing: "signal", pending: "warn", overdue: "risk", void: "neutral" } as const;
        const label = { paid: "Pago", processing: "A confirmar", pending: "Pendente", overdue: "Vencido", void: "Anulada" };
        return <Pill tone={tone[fee.status]}>{label[fee.status]}</Pill>;
      },
    },
  ];

  const columns = allColumns.filter((c) => {
    if (c.key === "fee") return showBilling;
    if (c.key === "guardian") return showGuardian;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Atletas"
        subtitle={
          can(session, "athlete:write")
            ? `${athletes.length} inscritos em ${teams.length} equipas`
            : `${athletes.length} atletas nas tuas ${teams.length} equipas`
        }
      >
        {can(session, "athlete:write") && (
          <>
            <button type="button" onClick={() => setImporting(true)} className="ctl-outline">
              <Upload className="size-3.5" strokeWidth={1.75} />
              Importar Excel
            </button>
            <button type="button" onClick={() => setCreating(true)} className="ctl-primary">
              <Plus className="size-3.5" strokeWidth={2} />
              Novo atleta
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
              { value: "todos", label: "Todos", count: athletes.length },
              { value: "medico", label: "Ficha médica", count: athletes.filter((a) => medicalState(a) !== "ok").length },
              { value: "baixa", label: "De baixa", count: athletes.filter((a) => availabilityOf(a.id) !== "available").length },
              { value: "pausa", label: "Em pausa", count: athletes.filter((a) => a.status === "paused").length },
            ]}
          />

          <Select
            label="Equipa"
            value={team}
            onChange={setTeam}
            options={[
              { value: "all", label: "Todas as equipas" },
              ...academy.sports.flatMap((s) =>
                teams.filter((t) => t.sportId === s.id).map((t) => ({ value: t.id, label: t.name })),
              ),
            ]}
          />

          <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
          <ResultCount n={rows.length} noun={["atleta", "atletas"]} />
        </Toolbar>

        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(a) => a.id}
          to={(a) => `/atletas/${a.id}`}
          empty={
            <Empty
              icon={Users}
              title="Nenhum atleta corresponde"
              detail="Experimenta limpar os filtros ou procurar por outro nome."
            />
          }
        />
      </Panel>

      {creating && <NewAthleteDialog session={session} onClose={() => setCreating(false)} />}
      {importing && <ImportAthletesDialog onClose={() => setImporting(false)} />}
    </>
  );
}

/** Expirada, a expirar nos próximos 30 dias, ou em ordem. */
function medicalState(a: Athlete): MedicalState {
  const d = new Date(a.medicalValidUntil).getTime();
  if (d < today.getTime()) return "expired";
  if (d < today.getTime() + 30 * 86_400_000) return "soon";
  return "ok";
}
