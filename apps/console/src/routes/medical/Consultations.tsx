import { useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { Apple, Brain, Plus, Stethoscope } from "@/lib/icons";
import { ClinicalEntryDialog } from "@/components/ClinicalEntryDialog";
import { listAthletes, teamById, today } from "@/lib/api";
import { clinicalOf, KIND_LABEL, useClinicalRecords } from "@/lib/clinical";
import { relativeDays, shortDate, shortName } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import { useSession } from "@/session";
import type { ClinicalEntry, ClinicalKind } from "@/data/types";

type Row = { athleteId: string; athleteName: string; teamName: string; entry: ClinicalEntry };
type Filter = "todas" | "nutrition" | "psychology" | "physio";

/**
 * Consultas — nutrição, psicologia e fisioterapia.
 *
 * Existe separado de "Boletins" porque responde a outra pergunta: os boletins são
 * "quem está parado?", isto é "quem está a ser acompanhado?". A maior parte deste
 * trabalho não afasta ninguém e por isso não aparece em nenhuma outra lista do
 * produto — sem este ecrã, seria trabalho invisível.
 */
export default function MedicalConsultations() {
  const { session } = useSession();
  const [filter, setFilter] = useState<Filter>("todas");
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);

  useClinicalRecords();

  const all = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const a of listAthletes(session)) {
      for (const entry of clinicalOf(a.id)) {
        if (entry.kind === "nutrition" || entry.kind === "psychology" || entry.kind === "physio") {
          out.push({
            athleteId: a.id,
            athleteName: a.name,
            teamName: teamById(a.teamId)?.name ?? "",
            entry,
          });
        }
      }
    }
    return out.sort((x, y) => y.entry.date.localeCompare(x.entry.date));
  }, [session]);

  const counts = {
    todas: all.length,
    nutrition: all.filter((r) => r.entry.kind === "nutrition").length,
    psychology: all.filter((r) => r.entry.kind === "psychology").length,
    physio: all.filter((r) => r.entry.kind === "physio").length,
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((r) => (filter === "todas" ? true : r.entry.kind === filter))
      .filter((r) => (q ? r.athleteName.toLowerCase().includes(q) : true));
  }, [all, filter, query]);

  const ICON: Partial<Record<ClinicalKind, typeof Apple>> = {
    nutrition: Apple,
    psychology: Brain,
    physio: Stethoscope,
  };

  const columns: Column<Row>[] = [
    {
      key: "athlete",
      header: "Atleta",
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={r.athleteName} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">{shortName(r.athleteName)}</div>
            <div className="text-meta text-ink-3">{r.teamName}</div>
          </div>
        </div>
      ),
    },
    {
      key: "kind",
      header: "Área",
      render: (r) => {
        const Icon = ICON[r.entry.kind] ?? Stethoscope;
        return (
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            <Icon className="size-3.5 text-ink-4" strokeWidth={1.75} />
            {KIND_LABEL[r.entry.kind]}
          </span>
        );
      },
    },
    {
      key: "title",
      header: "Consulta",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{r.entry.title}</div>
          {r.entry.detail && <div className="truncate text-meta text-ink-3">{r.entry.detail}</div>}
        </div>
      ),
    },
    {
      key: "impact",
      header: "Impacto",
      hideBelow: "md",
      render: (r) =>
        r.entry.impact === "none" ? (
          <span className="text-meta text-ink-4">nenhum</span>
        ) : (
          <Pill tone={r.entry.impact === "out" ? "risk" : "warn"}>
            {r.entry.impact === "out" ? "De baixa" : "Condicionado"}
          </Pill>
        ),
    },
    {
      key: "date",
      header: "Data",
      align: "right",
      render: (r) => (
        <div>
          <div className="text-meta text-ink-2 tabular">{shortDate(new Date(r.entry.date))}</div>
          <div className="text-[11px] text-ink-4">{relativeDays(new Date(r.entry.date), today)}</div>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Consultas"
        subtitle={
          isAcademyWide(session)
            ? "Nutrição, psicologia e fisioterapia — toda a academia."
            : "Nutrição, psicologia e fisioterapia dos teus atletas."
        }
      >
        {can(session, "clinical:write") && (
          <button type="button" onClick={() => setComposing(true)} className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={2} />
            Agendar consulta
          </button>
        )}
      </PageHeader>

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Consultas" value={String(counts.todas)} icon={Stethoscope} note="registadas" />
          <Metric label="Nutrição" value={String(counts.nutrition)} icon={Apple} />
          <Metric label="Psicologia" value={String(counts.psychology)} icon={Brain} />
          <Metric label="Fisioterapia" value={String(counts.physio)} />
        </MetricRow>

        <Panel>
          <Toolbar>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "todas", label: "Todas", count: counts.todas },
                { value: "nutrition", label: "Nutrição", count: counts.nutrition },
                { value: "psychology", label: "Psicologia", count: counts.psychology },
                { value: "physio", label: "Fisioterapia", count: counts.physio },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
            <ResultCount n={rows.length} noun={["consulta", "consultas"]} />
          </Toolbar>

          <DataTable
            columns={columns}
            rows={rows}
            keyOf={(r) => r.entry.id}
            to={(r) => `/atletas/${r.athleteId}`}
            empty={<Empty icon={Stethoscope} title="Sem consultas neste filtro" />}
          />
        </Panel>
      </div>

      {composing && (
        <ClinicalEntryDialog session={session} defaultMode="scheduled" onClose={() => setComposing(false)} />
      )}
    </>
  );
}
