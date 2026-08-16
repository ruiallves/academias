import { useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { DataTable, Empty, Monogram, Panel, Pill, cx, type Column } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { Gauge, Plus } from "@/lib/icons";
import { athleteById, coachById, listAthletes, listEvaluations, teamById, today } from "@/lib/api";
import { relativeDays, shortName } from "@/lib/format";
import { can } from "@/lib/permissions";
import { SKILLS } from "@/data/demo";
import type { Evaluation } from "@/data/types";
import { useSession } from "@/session";

/**
 * Avaliações.
 *
 * As competências vêm do desporto, não do código — `SKILLS` é a configuração da
 * academia. Uma academia de natação avalia outras coisas e a tabela ajusta-se
 * sozinha, porque as colunas são geradas a partir da lista.
 */
export default function Evaluations() {
  const { session } = useSession();
  const [status, setStatus] = useState<"todas" | "draft" | "published">("todas");
  const [query, setQuery] = useState("");

  const all = listEvaluations(session);
  const athletes = listAthletes(session);
  const coverage = all.length / Math.max(1, athletes.length);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((e) => (status === "todas" ? true : e.status === status))
      .filter((e) => (q ? (athleteById(e.athleteId)?.name ?? "").toLowerCase().includes(q) : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [all, status, query]);

  const columns: Column<Evaluation>[] = [
    {
      key: "athlete",
      header: "Atleta",
      render: (e) => {
        const a = athleteById(e.athleteId);
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
    ...SKILLS.map<Column<Evaluation>>((skill) => ({
      key: skill,
      header: skill,
      align: "right",
      hideBelow: "lg",
      render: (e) => <ScoreDots value={e.scores[skill] ?? 0} />,
    })),
    {
      key: "coach",
      header: "Avaliador",
      hideBelow: "md",
      render: (e) => <span className="text-ink-3">{coachById(e.coachId)?.name.split(" ")[0]}</span>,
    },
    {
      key: "updated",
      header: "Editada",
      hideBelow: "sm",
      render: (e) => <span className="text-ink-3">{relativeDays(new Date(e.updatedAt), today)}</span>,
    },
    {
      key: "status",
      header: "Estado",
      align: "right",
      render: (e) =>
        e.status === "published" ? <Pill tone="ok">Publicada</Pill> : <Pill tone="warn">Rascunho</Pill>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Avaliações"
        subtitle={`${all.length} de ${athletes.length} atletas avaliados neste período · ${Math.round(coverage * 100)}% de cobertura`}
      >
        {can(session, "evaluation:write") && (
          <button type="button" className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={2} />
            Nova avaliação
          </button>
        )}
      </PageHeader>

      <Panel>
        <Toolbar>
          <Segmented
            value={status}
            onChange={setStatus}
            options={[
              { value: "todas", label: "Todas", count: all.length },
              { value: "draft", label: "Rascunhos", count: all.filter((e) => e.status === "draft").length },
              { value: "published", label: "Publicadas", count: all.filter((e) => e.status === "published").length },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
          <ResultCount n={rows.length} noun={["avaliação", "avaliações"]} />
        </Toolbar>

        <DataTable
          columns={columns}
          rows={rows}
          keyOf={(e) => e.id}
          empty={<Empty icon={Gauge} title="Sem avaliações neste filtro" />}
        />
      </Panel>
    </>
  );
}

/**
 * Cinco pontos em vez de um número.
 *
 * "4" obriga a lembrar que a escala vai a 5; quatro pontos cheios de cinco lê-se
 * sem pensar, e cinco colunas destas continuam a ser varríveis de relance.
 */
function ScoreDots({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${value} de 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} className={cx("size-1.5 rounded-full", n <= value ? "bg-signal" : "bg-sunken")} />
      ))}
    </span>
  );
}
