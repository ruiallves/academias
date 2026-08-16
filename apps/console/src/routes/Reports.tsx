import { PageHeader } from "@/components/Shell";
import { Empty, Monogram, Panel, PanelHead, Pill } from "@/components/primitives";
import { ArrowRight, FileText, Plus } from "@/lib/icons";
import { athleteById, listAthletes, listEvaluations, listTeams, teamById, today } from "@/lib/api";
import { relativeDays, shortName } from "@/lib/format";
import { isAcademyWide } from "@/lib/permissions";
import { useSession } from "@/session";

/**
 * Relatórios.
 *
 * Um relatório aqui não é um PDF de administração — é o que o pai recebe sobre o
 * filho. Por isso o ecrã organiza-se por atleta e por período, e mostra o estado
 * que interessa: já foi entregue à família, ou ainda não.
 *
 * O que ainda não existe não é fingido com gráficos de exemplo. Fase 4 do plano.
 */
export default function Reports() {
  const { session } = useSession();
  const teams = listTeams(session);
  const athletes = listAthletes(session);
  const evaluations = listEvaluations(session);
  const published = evaluations.filter((e) => e.status === "published");
  const wide = isAcademyWide(session);

  return (
    <>
      <PageHeader
        title="Relatórios"
        subtitle={
          wide
            ? "O que as famílias recebem sobre o percurso dos filhos."
            : "O que os pais dos teus atletas recebem no fim de cada período."
        }
      >
        <button type="button" className="ctl-primary">
          <Plus className="size-3.5" strokeWidth={2} />
          Gerar relatórios
        </button>
      </PageHeader>

      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <Panel className="flex flex-col">
          <PanelHead title="1.º período · 2026/27" hint={`${published.length} de ${athletes.length} prontos a entregar`} />

          {published.length === 0 ? (
            <div className="px-5 py-16">
              <Empty
                icon={FileText}
                title="Ainda não há relatórios"
                detail="Um relatório precisa de uma avaliação publicada. Publica avaliações e eles aparecem aqui."
              />
            </div>
          ) : (
            <ul>
              {published.slice(0, 8).map((e) => {
                const a = athleteById(e.athleteId);
                return (
                  <li key={e.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                    <Monogram name={a?.name ?? "?"} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium text-ink">{shortName(a?.name ?? "—")}</div>
                      <div className="text-meta text-ink-3">
                        {teamById(a?.teamId ?? "")?.name} · avaliação {relativeDays(new Date(e.updatedAt), today)}
                      </div>
                    </div>
                    <Pill tone="ok">Pronto</Pill>
                    <button type="button" className="ctl-outline gap-1">
                      Pré-visualizar
                      <ArrowRight className="size-3" strokeWidth={2} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel className="h-fit">
          <PanelHead title="Cobertura por equipa" />
          <ul className="px-5 py-1.5">
            {teams.map((t) => {
              const roster = athletes.filter((a) => a.teamId === t.id);
              const done = published.filter((e) => roster.some((a) => a.id === e.athleteId)).length;
              const rate = roster.length ? done / roster.length : 0;
              return (
                <li key={t.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                  <span className="min-w-0 flex-1 truncate text-body text-ink-2">{t.name}</span>
                  <span className="shrink-0 text-meta text-ink-3 tabular">
                    {done}/{roster.length}
                  </span>
                  <Pill tone={rate === 1 ? "ok" : rate >= 0.5 ? "signal" : "warn"}>{Math.round(rate * 100)}%</Pill>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
    </>
  );
}
