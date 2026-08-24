import { useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Empty, Monogram, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { ReportDialog, VisibilityPill } from "@/components/ReportDialog";
import { FileText, Plus } from "@/lib/icons";
import { listAthletes, listTeams, today } from "@/lib/api";
import { useApi } from "@/lib/query";
import { currentPeriodLabel, type ApiEvaluation, type ApiReport } from "@/lib/development";
import { relativeDays, shortName } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import { useSession } from "@/session";

/**
 * Relatórios.
 *
 * ## Duas coisas na mesma página, e porquê
 *
 * À esquerda, **o que se escreveu**: a lista de relatórios, com quem os pode ler à
 * vista. À direita, **o que falta entregar**: a cobertura das avaliações por equipa,
 * que é o outro lado do mesmo trabalho — um pai que não recebeu a avaliação do
 * período não recebeu nada, por muitos relatórios que existam no sistema.
 *
 * A cobertura não vive no ecrã de Avaliações de propósito: lá trabalha-se uma
 * equipa de cada vez, e a vista de cima só tirava espaço à que está à frente.
 *
 * ## O que a coluna "Quem lê" faz aqui
 *
 * É a primeira coisa que se procura numa lista destas — *isto foi parar aos pais?*
 * Por isso é uma coluna e não um detalhe que obriga a abrir cada linha.
 */
export default function Reports() {
  const { session } = useSession();
  const athletes = listAthletes(session);
  const teams = listTeams(session);
  const wide = isAcademyWide(session);

  const [filter, setFilter] = useState<"todos" | "familia" | "interno" | "rascunho">("todos");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ApiReport | "novo" | null>(null);

  const { data, loading, reload } = useApi<ApiReport[]>("/api/reports");
  const reports = data ?? [];

  // A cobertura do período corrente, para o painel da direita.
  const { data: evalData } = useApi<ApiEvaluation[]>("/api/evaluations", { period: currentPeriodLabel() });
  const evaluations = evalData ?? [];

  const mayWrite = can(session, "report:write");

  const counts = {
    todos: reports.length,
    familia: reports.filter((r) => r.visibility === "FAMILY" && r.status === "PUBLISHED").length,
    interno: reports.filter((r) => r.visibility === "INTERNAL" && r.status === "PUBLISHED").length,
    rascunho: reports.filter((r) => r.status === "DRAFT").length,
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return reports
      .filter((r) => {
        if (filter === "todos") return true;
        if (filter === "rascunho") return r.status === "DRAFT";
        if (filter === "familia") return r.visibility === "FAMILY" && r.status === "PUBLISHED";
        return r.visibility === "INTERNAL" && r.status === "PUBLISHED";
      })
      .filter((r) => (q ? `${r.athleteName} ${r.title}`.toLowerCase().includes(q) : true));
  }, [reports, filter, query]);

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={
          wide
            ? "O que a academia escreve sobre cada atleta — e o que dela sai para as famílias."
            : "O que escreves sobre os teus atletas. Cada um decide-se: fica interno ou vai para os pais."
        }
      >
        {mayWrite && (
          <button type="button" onClick={() => setOpen("novo")} disabled={athletes.length === 0} className="ctl-primary">
            <Plus className="size-3.5" strokeWidth={2} />
            Novo relatório
          </button>
        )}
      </PageHeader>

      {open && (
        <ReportDialog
          report={open === "novo" ? null : open}
          athletes={athletes}
          onClose={() => setOpen(null)}
          onSaved={reload}
        />
      )}

      <div className="grid gap-3 lg:grid-cols-[1fr_300px]">
        <Panel className="flex flex-col">
          <Toolbar>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "todos", label: "Todos", count: counts.todos },
                { value: "familia", label: "Com a família", count: counts.familia },
                { value: "interno", label: "Internos", count: counts.interno },
                { value: "rascunho", label: "Rascunhos", count: counts.rascunho },
              ]}
            />
            <SearchInput value={query} onChange={setQuery} placeholder="Atleta ou título…" />
            <ResultCount n={rows.length} noun={["relatório", "relatórios"]} />
          </Toolbar>

          {loading && reports.length === 0 ? (
            <div className="px-5 py-16 text-center text-meta text-ink-3">A carregar…</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-16">
              <Empty
                icon={FileText}
                title={reports.length === 0 ? "Ainda não há relatórios" : "Nada neste filtro"}
                detail={
                  reports.length === 0
                    ? "Um relatório é o texto sobre o percurso de um atleta. Escreve-se quando há alguma coisa para dizer — e decide-se ali mesmo se a família o lê."
                    : undefined
                }
              />
            </div>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setOpen(r)}
                    className="flex w-full items-center gap-3 border-b border-line px-5 py-3 text-left transition-colors duration-[120ms] last:border-0 hover:bg-sunken/50"
                  >
                    <Monogram name={r.athleteName} />

                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium text-ink">{r.title}</div>
                      <div className="truncate text-meta text-ink-3">
                        {shortName(r.athleteName)}
                        {r.period && ` · ${r.period}`}
                        {` · ${r.authorName.split(" ")[0]}`}
                      </div>
                    </div>

                    <span className="hidden shrink-0 text-meta text-ink-4 sm:block">
                      {relativeDays(new Date(r.publishedAt ?? r.createdAt), today)}
                    </span>

                    {r.status === "DRAFT" ? <Pill tone="warn">Rascunho</Pill> : <VisibilityPill visibility={r.visibility} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel className="h-fit">
          <PanelHead title="Avaliações entregues" hint={currentPeriodLabel().split("·")[1]?.trim()} />
          <ul className="px-5 py-1.5">
            {teams.map((t) => {
              const roster = athletes.filter((a) => a.teamId === t.id);
              const entregues = evaluations.filter(
                (e) => e.status === "PUBLISHED" && roster.some((a) => a.id === e.athleteId),
              ).length;
              const rate = roster.length ? entregues / roster.length : 0;

              return (
                <li key={t.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                  <span className="min-w-0 flex-1 truncate text-body text-ink-2">{t.name}</span>
                  <span className="shrink-0 text-meta text-ink-3 tabular">
                    {entregues}/{roster.length}
                  </span>
                  <Pill tone={rate === 1 ? "ok" : rate >= 0.5 ? "signal" : "warn"}>{Math.round(rate * 100)}%</Pill>
                </li>
              );
            })}
            {teams.length === 0 && <li className="py-3 text-meta text-ink-3">Sem equipas no teu âmbito.</li>}
          </ul>

          <p className={cx("border-t border-line px-5 py-3 text-[11px] leading-relaxed text-ink-4")}>
            Uma avaliação em rascunho é trabalho feito que ninguém recebeu. Entrega-se em Avaliações.
          </p>
        </Panel>
      </div>
    </>
  );
}
