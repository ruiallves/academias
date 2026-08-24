import { useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Bar, Empty, Monogram, Panel, Pill, SelectField, cx } from "@/components/primitives";
import { ResultCount, SearchInput, Segmented, Toolbar } from "@/components/filters";
import { EvaluationEditor, type RosterEntry } from "@/components/EvaluationEditor";
import { Check, Gauge, Send } from "@/lib/icons";
import { listAthletes, listTeams, sportById, teamById } from "@/lib/api";
import { apiPost } from "@/lib/http";
import { useApi } from "@/lib/query";
import { average, currentPeriodLabel, periodsFor, SCALE, type ApiEvaluation } from "@/lib/development";
import { shortName } from "@/lib/format";
import { can } from "@/lib/permissions";
import { useSession } from "@/session";

/**
 * Avaliações.
 *
 * ## A lista é o plantel, não as avaliações
 *
 * É a decisão que muda tudo neste ecrã. Uma lista de avaliações responde a "o que
 * já fiz"; um plantel responde a "quem falta" — e "quem falta" é a única pergunta
 * que um treinador tem em Dezembro. Por isso cada linha é um atleta da equipa, com
 * ou sem avaliação, e quem ainda não tem aparece **primeiro**.
 *
 * ## Publicar é um acto de grupo
 *
 * Selecciona-se e publica-se de uma vez, porque é assim que o trabalho acaba: o
 * plantel foi avaliado numa tarde e entrega-se numa tarde. Publicar linha a linha
 * seriam vinte confirmações e a garantia de que metade ficava por entregar — e uma
 * avaliação que fica em rascunho é trabalho feito que ninguém recebeu.
 *
 * O botão diz sempre quantas famílias vão ser avisadas. Ninguém devia carregar em
 * "publicar" sem saber quantos telemóveis vão tocar.
 */
export default function Evaluations() {
  const { session } = useSession();
  const teams = listTeams(session);
  const athletes = listAthletes(session);

  const [period, setPeriod] = useState(currentPeriodLabel);
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const [filter, setFilter] = useState<"todos" | "por-avaliar" | "rascunho" | "publicada">("todos");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const { data, loading, reload } = useApi<ApiEvaluation[]>("/api/evaluations", { period });
  const evaluations = data ?? [];
  const mayWrite = can(session, "evaluation:write");

  const team = teams.find((t) => t.id === teamId);
  const skills = team ? sportById(team.sportId)?.skills ?? [] : [];

  /**
   * O plantel da equipa, com a avaliação de cada um colada ao lado.
   *
   * Por avaliar primeiro, depois rascunhos, depois publicadas — a ordem do trabalho
   * que falta. Dentro de cada grupo, por nome, para a lista não dançar entre
   * carregamentos.
   */
  const roster: RosterEntry[] = useMemo(() => {
    const byAthlete = new Map(evaluations.map((e) => [e.athleteId, e]));
    const rank = (e: ApiEvaluation | undefined) => (!e ? 0 : e.status === "DRAFT" ? 1 : 2);

    return athletes
      .filter((a) => a.teamId === teamId)
      .map((athlete) => ({ athlete, evaluation: byAthlete.get(athlete.id) }))
      .sort(
        (x, y) =>
          rank(x.evaluation) - rank(y.evaluation) || x.athlete.name.localeCompare(y.athlete.name, "pt"),
      );
  }, [athletes, evaluations, teamId]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return roster
      .filter((r) => {
        if (filter === "todos") return true;
        if (filter === "por-avaliar") return !r.evaluation;
        if (filter === "rascunho") return r.evaluation?.status === "DRAFT";
        return r.evaluation?.status === "PUBLISHED";
      })
      .filter((r) => (q ? r.athlete.name.toLowerCase().includes(q) : true));
  }, [roster, filter, query]);

  const counts = {
    todos: roster.length,
    "por-avaliar": roster.filter((r) => !r.evaluation).length,
    rascunho: roster.filter((r) => r.evaluation?.status === "DRAFT").length,
    publicada: roster.filter((r) => r.evaluation?.status === "PUBLISHED").length,
  };

  // Só rascunhos se seleccionam para publicar: publicar o que já está publicado não
  // é uma operação, e "por avaliar" não tem nada para entregar.
  const publishable = rows.filter((r) => r.evaluation?.status === "DRAFT").map((r) => r.evaluation!.id);
  const chosen = [...selected].filter((id) => publishable.includes(id));

  async function publish(ids: string[]) {
    if (ids.length === 0 || busy) return;
    const quantas = ids.length;
    if (!confirm(`Publicar ${quantas} ${quantas === 1 ? "avaliação" : "avaliações"}? As famílias são avisadas na app.`)) return;

    setBusy(true);
    try {
      const result = await apiPost<{ published: number; skipped: { reason: string }[] }>(
        "/api/evaluations/publish",
        { ids },
      );
      setSelected(new Set());
      reload();
      setFlash(
        result.skipped.length === 0
          ? `${result.published} entregues às famílias.`
          : `${result.published} entregues · ${result.skipped.length} por entregar (${result.skipped[0].reason.toLowerCase()}).`,
      );
      setTimeout(() => setFlash(null), 5000);
    } catch (err) {
      setFlash(err instanceof Error ? err.message : "Não foi possível publicar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Avaliações"
        subtitle={`${counts.publicada} de ${roster.length} entregues neste período${counts["por-avaliar"] > 0 ? ` · ${counts["por-avaliar"]} por avaliar` : ""}`}
      >
        {mayWrite && (
          <>
            <button
              type="button"
              onClick={() => setEditing(rows.findIndex((r) => !r.evaluation) >= 0 ? rows.findIndex((r) => !r.evaluation) : 0)}
              disabled={rows.length === 0}
              className="ctl-outline"
            >
              <Gauge className="size-3.5" strokeWidth={1.75} />
              Avaliar plantel
            </button>
            <button
              type="button"
              onClick={() => void publish(chosen.length > 0 ? chosen : publishable)}
              disabled={busy || publishable.length === 0}
              className="ctl-primary"
            >
              <Send className="size-3.5" strokeWidth={1.75} />
              {chosen.length > 0
                ? `Publicar ${chosen.length}`
                : `Publicar ${publishable.length} ${publishable.length === 1 ? "rascunho" : "rascunhos"}`}
            </button>
          </>
        )}
      </PageHeader>

      {flash && (
        <p className="mb-3 rounded-[var(--radius-control)] bg-signal-soft px-3.5 py-2.5 text-meta text-signal-ink">{flash}</p>
      )}

      {editing !== null && rows[editing] && (
        <EvaluationEditor
          roster={rows}
          startAt={editing}
          period={period}
          skills={skills}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}

      <Panel>
        <Toolbar>
          <SelectField
            value={period}
            onChange={setPeriod}
            options={periodsFor().map((p) => ({ value: p.value, label: `${p.label} · ${p.months}` }))}
          />
          {teams.length > 1 && (
            <SelectField
              value={teamId}
              onChange={(v) => {
                setTeamId(v);
                setSelected(new Set());
              }}
              options={teams.map((t) => ({ value: t.id, label: t.name }))}
            />
          )}
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: "todos", label: "Todos", count: counts.todos },
              { value: "por-avaliar", label: "Por avaliar", count: counts["por-avaliar"] },
              { value: "rascunho", label: "Rascunhos", count: counts.rascunho },
              { value: "publicada", label: "Entregues", count: counts.publicada },
            ]}
          />
          <SearchInput value={query} onChange={setQuery} placeholder="Procurar atleta…" />
          <ResultCount n={rows.length} noun={["atleta", "atletas"]} />
        </Toolbar>

        {loading && evaluations.length === 0 ? (
          <div className="px-5 py-16 text-center text-meta text-ink-3">A carregar…</div>
        ) : rows.length === 0 ? (
          <div className="px-5 py-16">
            <Empty
              icon={Gauge}
              title={roster.length === 0 ? "Esta equipa não tem atletas" : "Nada neste filtro"}
              detail={roster.length === 0 ? "Inscreve atletas na equipa e eles aparecem aqui para avaliar." : undefined}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-body">
              <thead>
                <tr className="border-b border-line bg-sunken/50 text-meta font-medium text-ink-3">
                  {mayWrite && (
                    <th className="w-9 px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label="Seleccionar todos os rascunhos"
                        checked={publishable.length > 0 && chosen.length === publishable.length}
                        onChange={(e) => setSelected(e.target.checked ? new Set(publishable) : new Set())}
                        className="size-3.5 accent-[var(--color-signal)]"
                      />
                    </th>
                  )}
                  <th className="px-3 py-2 text-left">Atleta</th>
                  {skills.map((s) => (
                    <th key={s} className="hidden px-2 py-2 text-center whitespace-nowrap lg:table-cell">
                      {s}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right whitespace-nowrap">Média</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Estado</th>
                  <th className="px-5 py-2 text-right">Acção</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const e = r.evaluation;
                  const media = e ? average(e.scores) : null;
                  const id = e?.id;

                  return (
                    <tr
                      key={r.athlete.id}
                      className="border-b border-line last:border-b-0 hover:bg-sunken/40"
                    >
                      {mayWrite && (
                        <td className="px-3 py-2.5">
                          {e?.status === "DRAFT" && (
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar ${r.athlete.name}`}
                              checked={selected.has(id!)}
                              onChange={(ev) =>
                                setSelected((s) => {
                                  const next = new Set(s);
                                  if (ev.target.checked) next.add(id!);
                                  else next.delete(id!);
                                  return next;
                                })
                              }
                              className="size-3.5 accent-[var(--color-signal)]"
                            />
                          )}
                        </td>
                      )}

                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <Monogram name={r.athlete.name} photoUrl={r.athlete.photoUrl} />
                          <div className="min-w-0">
                            <div className="truncate font-medium text-ink">{shortName(r.athlete.name)}</div>
                            <div className="text-meta text-ink-3">
                              {e ? `${e.coachName.split(" ")[0]}` : teamById(r.athlete.teamId)?.name}
                            </div>
                          </div>
                        </div>
                      </td>

                      {skills.map((s) => (
                        <td key={s} className="hidden px-2 py-2.5 text-center lg:table-cell">
                          <ScoreDots value={e?.scores[s]} />
                        </td>
                      ))}

                      <td className="px-3 py-2.5 text-right">
                        {media === null ? (
                          <span className="text-ink-4">—</span>
                        ) : (
                          <span className="font-medium text-ink tabular">{media.toFixed(1)}</span>
                        )}
                      </td>

                      <td className="px-3 py-2.5">
                        {!e ? (
                          <Pill tone="neutral">Por avaliar</Pill>
                        ) : e.status === "DRAFT" ? (
                          <Pill tone="warn">Rascunho</Pill>
                        ) : (
                          <Pill tone="ok">Entregue</Pill>
                        )}
                      </td>

                      <td className="px-5 py-2.5 text-right">
                        {mayWrite ? (
                          <button type="button" onClick={() => setEditing(i)} className="ctl-outline">
                            {e ? "Abrir" : "Avaliar"}
                          </button>
                        ) : (
                          e && (
                            <span className="text-meta text-ink-3">
                              {e.status === "PUBLISHED" ? <Check className="inline size-3.5" strokeWidth={2} /> : "—"}
                            </span>
                          )
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/*
        A cobertura por equipa fica de fora deste ecrã de propósito: quem avalia
        trabalha uma equipa de cada vez, e um painel com as outras só tira espaço à
        que está à frente. Quem quer a vista de cima tem-na em Relatórios.
      */}
      {counts["por-avaliar"] > 0 && rows.length > 0 && (
        <p className="mt-3 flex items-center gap-2 px-1 text-meta text-ink-3">
          <Bar value={counts.publicada / Math.max(1, roster.length)} tone="signal" />
          <span className="shrink-0 tabular">
            {counts.publicada}/{roster.length} entregues
          </span>
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Cinco pontos em vez de um número.
 *
 * "4" obriga a lembrar que a escala vai a 5; quatro pontos cheios de cinco lê-se
 * sem pensar, e cinco colunas destas continuam a ser varríveis de relance.
 */
function ScoreDots({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-ink-4">·</span>;
  return (
    <span className="inline-flex gap-0.5" role="img" aria-label={`${value} de 5`}>
      {SCALE.map((n) => (
        <span key={n} className={cx("size-1.5 rounded-full", n <= value ? "bg-signal" : "bg-sunken")} />
      ))}
    </span>
  );
}
