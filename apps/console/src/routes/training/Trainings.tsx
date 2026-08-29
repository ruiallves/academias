import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Metric, MetricRow, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ChevronLeft, ChevronRight, ClipboardCheck, Sparkle, Trophy } from "@/lib/icons";
import { listSessions } from "@/lib/api";
import { matches, today } from "@/lib/store";
import { dayShort, relativeDays, time } from "@/lib/format";
import { can } from "@/lib/permissions";
import {
  OBJECTIVE_CATEGORIES,
  categoryByLabel,
  listPlans,
  minutesByCategory,
  sessionLoad,
  type PlanSummary,
} from "@/lib/training";
import type { TrainingSession } from "@/data/types";
import { useSession } from "@/session";

/**
 * Treinos — o planner.
 *
 * ## O que este ecrã é, e o que não é
 *
 * As **Presenças** respondem a "o que ficou por registar"; o **Calendário**
 * responde a "quando". Este responde à pergunta do treinador ao preparar a
 * semana: *o que vou treinar, com que carga, e o que ainda está por desenhar* —
 * é o microciclo, com a distribuição por objetivo e a carga acumulada à vista.
 *
 * A semana é a unidade natural do treino de formação: joga-se ao fim de semana,
 * planeia-se de segunda a domingo. Por isso a peça central é a faixa semanal, e
 * não uma tabela de sessões.
 */
export default function Trainings() {
  const { session } = useSession();
  const navigate = useNavigate();
  const mayPlan = can(session, "training:write");

  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);

  useEffect(() => {
    listPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  // A janela de sessões que o arranque trouxe — passado recente e futuro próximo.
  const from = new Date(today.getTime() - 30 * 86_400_000);
  const to = new Date(today.getTime() + 14 * 86_400_000);
  const all = listSessions(session, from, to).filter((s) => s.status !== "cancelled");

  const planOf = useMemo(() => new Map((plans ?? []).map((p) => [p.sessionId, p])), [plans]);

  /* A semana visível, de segunda a domingo. */
  const monday = useMemo(() => {
    const d = new Date(today);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + weekOffset * 7);
    return d;
  }, [weekOffset]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86_400_000)),
    [monday],
  );
  const sunday = new Date(monday.getTime() + 7 * 86_400_000 - 1);

  const weekSessions = all.filter((s) => {
    const d = new Date(s.start);
    return d >= monday && d <= sunday;
  });
  const weekMatches = matches.filter((m) => {
    const d = new Date(m.startsAt);
    return d >= monday && d <= sunday && m.status !== "CANCELLED";
  });

  /* A carga e a distribuição da semana, somadas dos planos. */
  const week = useMemo(() => {
    const blocks = weekSessions.flatMap((s) => planOf.get(s.id)?.blocks ?? []);
    const planned = weekSessions.filter((s) => planOf.get(s.id));
    const loads = planned.map((s) => {
      const p = planOf.get(s.id)!;
      return sessionLoad(p.blocks, p.intensity);
    });
    const score = loads.length ? Math.round(loads.reduce((a, l) => a + l.score, 0) / loads.length) : 0;
    return {
      planned: planned.length,
      volume: blocks.reduce((a, b) => a + b.durationMin, 0),
      score,
      byCategory: minutesByCategory(blocks),
    };
  }, [weekSessions, planOf]);

  /*
   * Alertas honestos: derivados só do que está planeado, e só quando há plano
   * suficiente para a ausência significar alguma coisa. É o terreno que um dia
   * a IA vai pisar — com os mesmos dados, nunca com dados a fingir.
   */
  const alerts = useMemo(() => {
    const out: string[] = [];
    if (week.planned >= 2) {
      const zero = OBJECTIVE_CATEGORIES.filter(
        (c) => c.key !== "bp" && !week.byCategory.some((b) => b.label === c.label && b.minutes > 0),
      );
      if (zero.length > 0 && zero.length <= 3) {
        out.push(`Sem minutos planeados de ${zero.map((z) => z.label.toLowerCase()).join(", ")} esta semana.`);
      }
      if (week.score >= 80) out.push("A carga média da semana está muito alta — vale a pena rever a véspera de jogo.");
    }
    return out;
  }, [week]);

  /*
   * "A planear" é uma lista de trabalho — só o que é **meu** entra nela.
   *
   * Mostrava o clube inteiro e contava só o meu: um treinador com o Sub-11 via
   * seis treinos na lista e "4 por planear" no cabeçalho, e os números não
   * batiam certo um com o outro. O clube inteiro continua à vista na faixa da
   * semana, que é o sítio de ver o que está marcado; a lista é o que me compete.
   */
  const upcoming = all
    .filter((s) => (s.mine ?? true) && new Date(s.start) >= today)
    .sort((a, b) => a.start.localeCompare(b.start));
  const recent = all
    .filter((s) => (s.mine ?? true) && new Date(s.start) < today)
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 10);
  const next = upcoming[0];

  if (plans === null) return <Loading />;

  const unplanned = upcoming.filter((s) => !planOf.get(s.id)).length;

  return (
    <>
      <PageHeader
        title="Treinos"
        subtitle="Planeia a semana: objetivos, exercícios e carga — antes de pisar o campo."
      >
        {mayPlan && (
          <Link to="/calendario?novo=treino" className="ctl-primary">
            Marcar treino
          </Link>
        )}
      </PageHeader>

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Treinos esta semana" value={String(weekSessions.length)} note={`${week.planned} com plano`} />
          <Metric label="Volume planeado" value={String(week.volume)} unit="min" note="soma dos blocos" />
          <Metric
            label="Carga média"
            value={week.planned ? `${week.score}` : "—"}
            unit={week.planned ? "/100" : undefined}
            note={week.planned ? sessionLoadNote(week.score) : "sem planos ainda"}
          />
          <Metric
            label="Próximo treino"
            value={next ? time(new Date(next.start)) : "—"}
            note={next ? `${next.teamName ?? ""} · ${relativeDays(new Date(next.start))}` : "nada marcado"}
          />
        </MetricRow>

        {/* A semana */}
        <Panel>
          <PanelHead
            title="Semana de treino"
            hint={`${monday.toLocaleDateString("pt-PT", { day: "numeric", month: "short" })} – ${sunday.toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}`}
          >
            <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Semana anterior" onClick={() => setWeekOffset((w) => w - 1)}>
              <ChevronLeft className="size-4" strokeWidth={1.75} />
            </button>
            {weekOffset !== 0 && (
              <button type="button" className="ctl-outline h-8" onClick={() => setWeekOffset(0)}>
                Hoje
              </button>
            )}
            <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Semana seguinte" onClick={() => setWeekOffset((w) => w + 1)}>
              <ChevronRight className="size-4" strokeWidth={1.75} />
            </button>
          </PanelHead>

          <div className="grid grid-cols-7 divide-x divide-line border-b border-line max-lg:grid-cols-1 max-lg:divide-x-0 max-lg:divide-y">
            {days.map((d) => {
              const isToday = d.toDateString() === today.toDateString();
              const daySessions = weekSessions
                .filter((s) => new Date(s.start).toDateString() === d.toDateString())
                .sort((a, b) => a.start.localeCompare(b.start));
              const dayMatches = weekMatches.filter((m) => new Date(m.startsAt).toDateString() === d.toDateString());
              const rest = daySessions.length === 0 && dayMatches.length === 0;

              return (
                <div key={d.toISOString()} className="min-h-24 p-2">
                  <div className={cx("mb-1.5 flex items-baseline gap-1.5 text-meta", isToday ? "font-semibold text-signal-ink" : "text-ink-3")}>
                    <span className="uppercase">{dayShort(d)}</span>
                    <span className="tabular">{d.getDate()}</span>
                  </div>
                  <div className="space-y-1.5">
                    {dayMatches.map((m) => (
                      <Link
                        key={m.id}
                        to={`/jogos/${m.id}`}
                        className="flex items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-sunken/60 px-2 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:border-line-strong"
                      >
                        <Trophy className="size-3 shrink-0 text-ink-3" strokeWidth={1.75} />
                        <span className="truncate">
                          {m.isHome ? "vs" : "@"} {m.opponent}
                        </span>
                      </Link>
                    ))}
                    {daySessions.map((s) => {
                      const p = planOf.get(s.id);
                      const load = p ? sessionLoad(p.blocks, p.intensity) : null;
                      const color = categoryByLabel(p?.blocks.find((b) => b.category)?.category ?? p?.objective ?? undefined)?.color;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => navigate(`/treinos/${s.id}`)}
                          className="block w-full rounded-[var(--radius-control)] border border-line bg-surface px-2 py-1.5 text-left transition-colors hover:border-line-strong"
                          style={color ? { borderLeft: `3px solid ${color.base}` } : undefined}
                        >
                          <div className="flex items-baseline justify-between gap-1">
                            <span className="truncate text-[11px] font-semibold text-ink">{s.teamName ?? "Treino"}</span>
                            <span className="shrink-0 text-[10px] text-ink-3 tabular">{time(new Date(s.start))}</span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-ink-3">
                            {p
                              ? `${load!.volume} min · ${load!.label}${p.objective ? ` · ${p.objective}` : ""}`
                              : "Por planear"}
                          </div>
                        </button>
                      );
                    })}
                    {rest && <div className="px-1 text-[11px] text-ink-4">Descanso</div>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* A distribuição da semana */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
            {week.volume > 0 ? (
              <>
                <div className="flex h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-sunken">
                  {week.byCategory.map((c) => (
                    <span
                      key={c.label}
                      title={`${c.label}: ${c.minutes} min`}
                      style={{ width: `${(c.minutes / week.volume) * 100}%`, background: c.category?.color.base ?? "var(--color-ink-4)" }}
                    />
                  ))}
                </div>
                {week.byCategory.slice(0, 5).map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1.5 text-meta text-ink-2">
                    <span className="size-2 rounded-full" style={{ background: c.category?.color.base ?? "var(--color-ink-4)" }} />
                    {c.label}
                    <span className="text-ink-4 tabular">{c.minutes} min</span>
                  </span>
                ))}
              </>
            ) : (
              <span className="text-meta text-ink-4">A distribuição por objetivo aparece quando houver planos nesta semana.</span>
            )}
          </div>

          {alerts.length > 0 && (
            <div className="space-y-1.5 border-t border-line px-5 py-3">
              {alerts.map((a) => (
                <div key={a} className="flex items-start gap-2 text-meta text-warn">
                  <Sparkle className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} />
                  {a}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <div className="grid gap-3 xl:grid-cols-2">
          {/* Próximos, com o estado do plano — é a lista de trabalho. */}
          <Panel>
            <PanelHead title="A planear" hint={unplanned ? `${unplanned} por planear` : "tudo planeado"} />
            <SessionList sessions={upcoming.slice(0, 8)} planOf={planOf} empty="Não há treinos marcados. Marca-os no calendário — aparecem aqui prontos a planear." />
          </Panel>

          {/* Realizados: o plano vira histórico. */}
          <Panel>
            <PanelHead title="Realizados" hint="os últimos 10" />
            <SessionList sessions={recent} planOf={planOf} empty="Os treinos já realizados aparecem aqui, com o plano que tiveram." />
          </Panel>
        </div>
      </div>
    </>
  );
}

function SessionList({
  sessions,
  planOf,
  empty,
}: {
  sessions: TrainingSession[];
  planOf: Map<string, PlanSummary>;
  empty: string;
}) {
  const navigate = useNavigate();
  if (sessions.length === 0) return <Empty title="Nada por aqui" detail={empty} icon={ClipboardCheck} compact />;

  return (
    <ul className="divide-y divide-line">
      {sessions.map((s) => {
        const p = planOf.get(s.id);
        const load = p ? sessionLoad(p.blocks, p.intensity) : null;
        const d = new Date(s.start);
        return (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => navigate(`/treinos/${s.id}`)}
              className="flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-sunken/50"
            >
              <div className="w-12 shrink-0 text-center">
                <div className="text-meta font-semibold text-ink uppercase">{dayShort(d)}</div>
                <div className="text-[11px] text-ink-3 tabular">
                  {d.getDate()}/{d.getMonth() + 1}
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">
                  {s.teamName ?? "Treino"} · {time(d)}
                </div>
                <div className="truncate text-meta text-ink-3">
                  {p ? `${p.blockCount} blocos · ${load!.volume} min${p.objective ? ` · ${p.objective}` : ""}` : s.venue}
                </div>
              </div>
              {p ? <Pill tone={load!.tone}>{load!.label}</Pill> : <Pill>Por planear</Pill>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function sessionLoadNote(score: number): string {
  if (score < 40) return "carga baixa";
  if (score < 60) return "carga moderada";
  if (score < 80) return "carga alta";
  return "carga muito alta";
}
