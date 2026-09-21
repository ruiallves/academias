import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Empty, Loading, Metric, MetricRow, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { ChevronLeft, ChevronRight, ClipboardCheck, Download, Pencil, Plus, Sparkle, Trophy } from "@/lib/icons";
import { listSessions, listTeams, scopedTeamIds, teamById } from "@/lib/api";
import { ensureCalendarRange, matches, seasonRanges, today, useStore } from "@/lib/store";
import { dayShort, relativeDays, time } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import { categoriesFor } from "@/lib/sports";
import { useMobile } from "@/lib/viewport";
import { categoryByLabel, listPlans, minutesByCategory, sessionLoad, type PlanSummary } from "@/lib/training";
import {
  addDays,
  cycleLength,
  cycleOn,
  dayKey,
  daysIn,
  keyToDate,
  listCycles,
  matchDayLabel,
  mesoOf,
  microLabel,
  rangeLabel,
  viewAround,
  type Cycle,
} from "@/lib/cycles";
import type { TrainingSession } from "@/data/types";
import { useSession } from "@/session";
import { SeasonBar } from "./SeasonBar";
import { CycleDialog } from "./CycleDialogs";
import { ExportDialog } from "./ExportDialog";

/**
 * Planeamento: a época, as fases e o microciclo de uma equipa.
 *
 * ## O que este ecrã é
 *
 * Era "Treinos", o planner da semana: *o que vou treinar, com que carga, e o
 * que ainda está por desenhar*. Continua a ser isso, e é o que vê quem nunca
 * periodizou: escolhe a equipa (ou todas) e tem a semana à frente.
 *
 * Por cima, para quem quer, a periodização: a época da equipa numa barra, com
 * as fases (mesociclos) e os microciclos. Carregar num micro abre-o em baixo,
 * no mesmo sítio onde estava a semana, com o objetivo e o foco dele ao lado da
 * carga e da distribuição por objetivo que já lá estavam.
 *
 * ## Os treinos não pertencem ao ciclo por chave
 *
 * Um micro é um intervalo de dias. Os treinos e os jogos que lá caem são dele.
 * Por isso não há "associar treino", e marcar ou mover um treino no calendário
 * muda-o de micro sozinho. Ver `lib/cycles.ts`.
 *
 * ## Com todas as equipas
 *
 * A periodização é por equipa, e dez faixas de fases umas por cima das outras
 * não se leem. Sem equipa escolhida, o ecrã é o planner do clube como antes: a
 * semana, sem barra da época.
 */
export default function Trainings() {
  const { session } = useSession();
  useStore();
  const navigate = useNavigate();
  const mobile = useMobile();
  const [params, setParams] = useSearchParams();

  const mayPlan = can(session, "training:write");
  // As equipas que esta pessoa acompanha: um treinador não abre o planeamento
  // de outro escalão, que o servidor também já não lhe devolve.
  const equipas = listTeams(session);
  const minhas = isAcademyWide(session) ? null : scopedTeamIds(session);

  /*
   * A equipa: a do endereço, senão a primeira do treinador. A direção começa
   * no clube inteiro, que é o que via antes.
   */
  const teamParam = params.get("equipa");
  const teamId = teamParam ?? minhas?.[0] ?? "";
  const team = teamId ? teamById(teamId) : undefined;
  const mayPlanTeam = mayPlan && Boolean(team) && (minhas === null || minhas.includes(teamId));

  const hoje = dayKey(today);
  const [anchor, setAnchor] = useState(hoje);

  /* Os ciclos da equipa. Poucas dezenas por época: vêm todos de uma vez. */
  const [cycles, setCycles] = useState<Cycle[]>([]);
  const [cyclesReady, setCyclesReady] = useState(false);
  const recarregarCiclos = useCallback(async () => {
    if (!teamId) {
      setCycles([]);
      setCyclesReady(true);
      return;
    }
    try {
      setCycles(await listCycles(teamId));
    } catch {
      setCycles([]);
    } finally {
      setCyclesReady(true);
    }
  }, [teamId]);
  useEffect(() => {
    setCyclesReady(false);
    void recarregarCiclos();
  }, [recarregarCiclos]);

  /* O intervalo aberto: o micro do dia escolhido, ou a semana dele. */
  const view = viewAround(teamId ? cycles : [], anchor);
  const days = daysIn(view.from, view.to);
  const fromDate = keyToDate(view.from);
  const toDate = new Date(keyToDate(view.to).getTime() + 86_400_000 - 1);

  /* Os planos do intervalo, acumulados à medida que se navega. */
  const [plans, setPlans] = useState<Map<string, PlanSummary> | null>(null);
  useEffect(() => {
    let vivo = true;
    void ensureCalendarRange(fromDate, toDate);
    const de = new Date(Math.min(fromDate.getTime(), today.getTime() - 30 * 86_400_000)).toISOString();
    const ate = new Date(Math.max(toDate.getTime(), today.getTime() + 14 * 86_400_000)).toISOString();
    listPlans(de, ate)
      .then((r) => vivo && setPlans((antes) => new Map([...(antes ?? new Map()), ...(r ?? []).map((p) => [p.sessionId, p] as const)])))
      .catch(() => vivo && setPlans((antes) => antes ?? new Map()));
    return () => {
      vivo = false;
    };
    // O intervalo muda por texto; as datas derivadas saem dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.from, view.to]);
  const planOf = plans ?? new Map<string, PlanSummary>();

  /*
   * A equipa escolhida, ou "as minhas" para um treinador: sem equipa escolhida,
   * o planeador mostra as equipas dele e não o clube inteiro. Quem vê a academia
   * toda (`minhas === null`) continua a ver tudo.
   */
  const daEquipa = <T extends { teamId: string }>(x: T) =>
    teamId ? x.teamId === teamId : minhas === null || minhas.includes(x.teamId);

  const viewSessions = listSessions(session, fromDate, toDate).filter((s) => s.status !== "cancelled" && daEquipa(s));
  const viewMatches = matches.filter((m) => {
    const d = new Date(m.startsAt);
    return d >= fromDate && d <= toDate && m.status !== "CANCELLED" && daEquipa(m);
  });

  /* Os dias de jogo da equipa, para as etiquetas MD e para a barra da época. */
  const matchDays = useMemo(
    () =>
      teamId
        ? [...new Set(matches.filter((m) => m.teamId === teamId && m.status !== "CANCELLED").map((m) => dayKey(new Date(m.startsAt))))].sort()
        : [],
    // `matches` é substituído, não mutado, quando o store muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teamId, matches],
  );

  /* A época da equipa: o macrociclo. Esticada até aos ciclos que saiam dela. */
  const epoca = useMemo(() => {
    if (!team) return null;
    const r = seasonRanges[team.season] ?? epocaPeloRotulo(team.season);
    if (!r) return null;
    const from = cycles.reduce((m, c) => (c.startsOn < m ? c.startsOn : m), r.startsOn);
    const to = cycles.reduce((m, c) => (c.endsOn > m ? c.endsOn : m), r.endsOn);
    return { from, to };
  }, [team, cycles]);

  const micro = view.micro;
  const meso = micro ? mesoOf(cycles, micro) : cycleOn(cycles, "MESO", view.from);

  /* A carga e a distribuição do intervalo, somadas dos planos. */
  const soma = useMemo(() => {
    const blocks = viewSessions.flatMap((s) => planOf.get(s.id)?.blocks ?? []);
    const planned = viewSessions.filter((s) => planOf.get(s.id));
    const loads = planned.map((s) => {
      const p = planOf.get(s.id)!;
      return sessionLoad(p.blocks, p.intensity);
    });
    const score = loads.length ? Math.round(loads.reduce((a, l) => a + l.score, 0) / loads.length) : 0;
    return { planned: planned.length, volume: blocks.reduce((a, b) => a + b.durationMin, 0), score, byCategory: minutesByCategory(blocks) };
  }, [viewSessions, planOf]);

  const unidade = micro ? "este micro" : "esta semana";

  /*
   * Alertas honestos: derivados só do que está planeado, e só quando há plano
   * suficiente para a ausência significar alguma coisa.
   */
  const alerts = useMemo(() => {
    const out: string[] = [];
    // O foco do micro contra o que está planeado: é a pergunta que o foco serve.
    if (micro && micro.focus.length > 0 && soma.planned >= 1) {
      const sem = micro.focus.filter((f) => !soma.byCategory.some((b) => b.label === f && b.minutes > 0));
      if (sem.length > 0) out.push(`O foco d${unidade} inclui ${sem.map((s) => s.toLowerCase()).join(", ")}, e ainda não há minutos planeados disso.`);
    }
    if (soma.planned >= 2) {
      /*
       * As categorias são as da modalidade que mais treina no intervalo: um
       * clube de basquetebol não leva um aviso sobre "bolas paradas".
       */
      const porModalidade = new Map<string | null, number>();
      for (const s of viewSessions) {
        const sportId = teamById(s.teamId)?.sportId ?? null;
        porModalidade.set(sportId, (porModalidade.get(sportId) ?? 0) + 1);
      }
      const dominante = [...porModalidade.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const zero = categoriesFor(dominante).filter(
        (c) => c.key !== "bp" && !soma.byCategory.some((b) => b.label === c.label && b.minutes > 0) && !micro?.focus.includes(c.label),
      );
      if (zero.length > 0 && zero.length <= 3) {
        out.push(`Sem minutos planeados de ${zero.map((z) => z.label.toLowerCase()).join(", ")} n${unidade}.`);
      }
      if (soma.score >= 80) out.push(`A carga média d${unidade} está muito alta. Vale a pena rever a véspera de jogo.`);
    }
    return out;
  }, [soma, viewSessions, micro, unidade]);

  /*
   * "A planear" é uma lista de trabalho: só o que é **meu** entra nela, e só
   * da equipa escolhida quando há uma.
   */
  const janela = listSessions(
    session,
    new Date(today.getTime() - 30 * 86_400_000),
    new Date(today.getTime() + 14 * 86_400_000),
  ).filter((s) => s.status !== "cancelled" && daEquipa(s));
  const upcoming = janela.filter((s) => (s.mine ?? true) && new Date(s.start) >= today).sort((a, b) => a.start.localeCompare(b.start));
  const recent = janela
    .filter((s) => (s.mine ?? true) && new Date(s.start) < today)
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, 10);
  const next = upcoming[0];

  /* Os diálogos. */
  const [dialogo, setDialogo] = useState<
    | { kind: "meso"; cycle?: Cycle; initial?: { startsOn: string; endsOn: string } }
    | { kind: "micro"; cycle?: Cycle; initial?: { startsOn: string; endsOn: string } }
    | null
  >(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [exportar, setExportar] = useState(false);

  function escolherEquipa(id: string) {
    const p = new URLSearchParams(params);
    if (id) p.set("equipa", id);
    else if (minhas?.length) p.set("equipa", "");
    else p.delete("equipa");
    setParams(p, { replace: true });
    setAviso(null);
  }

  if (plans === null || !cyclesReady) return <Loading />;

  const unplanned = upcoming.filter((s) => !planOf.get(s.id)).length;
  const temCiclos = cycles.length > 0;
  const cols = mobile ? "minmax(0,1fr)" : `repeat(${days.length}, minmax(0,1fr))`;

  return (
    <>
      <PageHeader title="Planeamento" subtitle="A época, os mesociclos e a semana de treino: objetivos, exercícios e carga, antes de pisar o campo.">
        <select
          value={teamId}
          onChange={(e) => escolherEquipa(e.target.value)}
          aria-label="Equipa"
          className="h-8 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none"
        >
          <option value="">{minhas === null ? "Todas as equipas" : "As minhas equipas"}</option>
          {equipas.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {mayPlan && (
          <Link to={`/calendario?novo=treino${teamId ? `&equipa=${teamId}` : ""}`} className="ctl-primary">
            Marcar treino
          </Link>
        )}
      </PageHeader>

      <div className="space-y-3">
        {/* A época da equipa: o macrociclo, as fases e os micros. */}
        {team && epoca && (
          <Panel>
            <PanelHead title={`Época ${team.season}`} hint={temCiclos ? team.name : `${team.name} · sem periodização`}>
              {/* Exportar só lê: aparece a quem vê o Planeamento, mesmo sem poder mexer. */}
              <button type="button" className="ctl-outline h-8" onClick={() => setExportar(true)}>
                <Download className="size-3.5" strokeWidth={1.75} />
                Exportar
              </button>
              {mayPlanTeam && (
                <>
                  <button
                    type="button"
                    className="ctl-outline h-8"
                    onClick={() => setDialogo({ kind: "meso", initial: { startsOn: view.from, endsOn: addDays(view.from, 34) } })}
                  >
                    <Plus className="size-3.5" strokeWidth={2} />
                    Novo mesociclo
                  </button>
                </>
              )}
            </PanelHead>
            {temCiclos || matchDays.length > 0 ? (
              <SeasonBar
                from={epoca.from}
                to={epoca.to}
                cycles={cycles}
                matchDays={matchDays}
                today={hoje}
                selectedMicroId={micro?.id ?? null}
                viewFrom={view.from}
                viewTo={view.to}
                onPickDay={setAnchor}
                onPickMeso={(m) => (mayPlanTeam ? setDialogo({ kind: "meso", cycle: m }) : setAnchor(m.startsOn))}
              />
            ) : null}
            {!temCiclos && (
              <p className="border-t border-line px-5 py-3 text-meta text-ink-3">
                {mayPlanTeam
                  ? "Queres periodizar? Cria os mesociclos da época: cada um traz as suas semanas. Se não, continua a planear semana a semana, como até aqui."
                  : "Esta equipa ainda não tem a época periodizada."}
              </p>
            )}
            {aviso && <p className="border-t border-line px-5 py-2.5 text-meta text-ok">{aviso}</p>}
          </Panel>
        )}

        <MetricRow>
          <Metric label={micro ? "Treinos neste micro" : "Treinos esta semana"} value={String(viewSessions.length)} note={`${soma.planned} com plano`} />
          <Metric label="Volume planeado" value={String(soma.volume)} unit="min" note="soma dos blocos" />
          <Metric
            label="Carga média"
            value={soma.planned ? `${soma.score}` : "—"}
            unit={soma.planned ? "/100" : undefined}
            note={soma.planned ? sessionLoadNote(soma.score) : "sem planos ainda"}
          />
          <Metric
            label="Próximo treino"
            value={next ? time(new Date(next.start)) : "—"}
            note={next ? `${next.teamName ?? ""} · ${relativeDays(new Date(next.start))}` : "nada marcado"}
          />
        </MetricRow>

        {/* O micro (ou a semana) */}
        <Panel>
          <PanelHead
            title={micro ? microLabel(cycles, micro) : "Semana de treino"}
            hint={[
              rangeLabel(view.from, view.to),
              micro && cycleLength(micro) !== 7 ? `${cycleLength(micro)} dias` : null,
              meso ? meso.name ?? meso.phase : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Anterior" onClick={() => setAnchor(addDays(view.from, -1))}>
              <ChevronLeft className="size-4" strokeWidth={1.75} />
            </button>
            {!(hoje >= view.from && hoje <= view.to) && (
              <button type="button" className="ctl-outline h-8" onClick={() => setAnchor(hoje)}>
                Hoje
              </button>
            )}
            <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Seguinte" onClick={() => setAnchor(addDays(view.to, 1))}>
              <ChevronRight className="size-4" strokeWidth={1.75} />
            </button>
          </PanelHead>

          {/* A intenção do micro, por cima dos dias. */}
          {team && micro && (
            <IntencaoDoMicro micro={micro} sportId={team.sportId} mayEdit={mayPlanTeam} onEdit={() => setDialogo({ kind: "micro", cycle: micro })} />
          )}
          {team && !micro && mayPlanTeam && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-sunken/40 px-5 py-2.5">
              <span className="text-meta text-ink-3">Estes dias não estão em nenhum microciclo.</span>
              <button
                type="button"
                className="ctl-ghost h-7 text-meta"
                onClick={() => setDialogo({ kind: "micro", initial: { startsOn: view.from, endsOn: view.to } })}
              >
                <Plus className="size-3.5" strokeWidth={2} />
                Criar microciclo
              </button>
            </div>
          )}

          <div className={cx("grid divide-line border-b border-line", mobile ? "divide-y" : "divide-x")} style={{ gridTemplateColumns: cols }}>
            {days.map((k) => {
              const d = keyToDate(k);
              const isToday = k === hoje;
              const daySessions = viewSessions.filter((s) => dayKey(new Date(s.start)) === k).sort((a, b) => a.start.localeCompare(b.start));
              const dayMatches = viewMatches.filter((m) => dayKey(new Date(m.startsAt)) === k);
              const rest = daySessions.length === 0 && dayMatches.length === 0;
              const md = teamId ? matchDayLabel(k, matchDays) : null;

              return (
                <div key={k} className={cx("min-w-0 p-2", !mobile && "min-h-24")}>
                  <div className={cx("mb-1.5 flex items-baseline gap-1.5 text-meta", isToday ? "font-semibold text-signal-ink" : "text-ink-3")}>
                    <span className="uppercase">{dayShort(d)}</span>
                    <span className="tabular">{d.getDate()}</span>
                    {md && (
                      <span
                        className={cx(
                          "ml-auto rounded-[4px] px-1 text-[10px] font-semibold tabular",
                          md === "MD" ? "bg-signal-soft text-signal-ink" : "bg-sunken text-ink-3",
                        )}
                        title="Dia em relação ao jogo"
                      >
                        {md === "MD" ? "Jogo" : md}
                      </span>
                    )}
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
                            {p ? `${load!.volume} min · ${load!.label}${p.objective ? ` · ${p.objective}` : ""}` : "Por planear"}
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

          {/* A distribuição do intervalo */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
            {soma.volume > 0 ? (
              <>
                <div className="flex h-2 min-w-40 flex-1 overflow-hidden rounded-full bg-sunken">
                  {soma.byCategory.map((c) => (
                    <span
                      key={c.label}
                      title={`${c.label}: ${c.minutes} min`}
                      style={{ width: `${(c.minutes / soma.volume) * 100}%`, background: c.category?.color.base ?? "var(--color-ink-4)" }}
                    />
                  ))}
                </div>
                {soma.byCategory.slice(0, 5).map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1.5 text-meta text-ink-2">
                    <span className="size-2 rounded-full" style={{ background: c.category?.color.base ?? "var(--color-ink-4)" }} />
                    {c.label}
                    <span className="text-ink-4 tabular">{c.minutes} min</span>
                  </span>
                ))}
              </>
            ) : (
              <span className="text-meta text-ink-4">A distribuição por objetivo aparece quando houver planos n{unidade}.</span>
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
          <Panel>
            <PanelHead title="A planear" hint={unplanned ? `${unplanned} por planear` : "tudo planeado"} />
            <SessionList sessions={upcoming.slice(0, 8)} planOf={planOf} empty="Não há treinos marcados. Marca-os no calendário: aparecem aqui prontos a planear." />
          </Panel>
          <Panel>
            <PanelHead title="Realizados" hint="os últimos 10" />
            <SessionList sessions={recent} planOf={planOf} empty="Os treinos já realizados aparecem aqui, com o plano que tiveram." />
          </Panel>
        </div>
      </div>

      {exportar && team && epoca && (
        <ExportDialog session={session} team={team} epoca={epoca} cycles={cycles} microAberto={micro} onClose={() => setExportar(false)} />
      )}
      {dialogo && team && (dialogo.kind === "meso" || dialogo.kind === "micro") && (
        <CycleDialog
          level={dialogo.kind === "meso" ? "MESO" : "MICRO"}
          teamId={team.id}
          sportId={team.sportId}
          cycle={dialogo.cycle}
          initial={dialogo.initial}
          label={dialogo.cycle && dialogo.kind === "micro" ? microLabel(cycles, dialogo.cycle) : undefined}
          mesoCount={cycles.filter((c) => c.level === "MESO").length}
          onClose={() => setDialogo(null)}
          onSaved={() => {
            setDialogo(null);
            void recarregarCiclos();
          }}
        />
      )}
    </>
  );
}

/** O objetivo, o foco e as notas do micro, lidos de relance. */
function IntencaoDoMicro({ micro, sportId, mayEdit, onEdit }: { micro: Cycle; sportId: string; mayEdit: boolean; onEdit: () => void }) {
  const categorias = categoriesFor(sportId);
  const vazio = !micro.objective && micro.focus.length === 0 && !micro.notes;
  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-2 border-b border-line bg-sunken/40 px-5 py-3">
      <div className="min-w-0 flex-1 basis-[260px]">
        <div className="text-[11px] font-medium tracking-wide text-ink-4 uppercase">Objetivo</div>
        <div className={cx("mt-0.5 text-body", micro.objective ? "font-medium text-ink" : "text-ink-4")}>
          {micro.objective ?? (vazio ? "Sem objetivo definido" : "—")}
        </div>
        {micro.notes && <p className="mt-1 line-clamp-2 text-meta text-ink-3">{micro.notes}</p>}
      </div>
      {micro.focus.length > 0 && (
        <div className="min-w-0">
          <div className="text-[11px] font-medium tracking-wide text-ink-4 uppercase">Foco</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {micro.focus.map((f) => {
              const c = categorias.find((x) => x.label === f);
              return (
                <span key={f} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-0.5 text-meta text-ink-2">
                  <span className="size-2 rounded-full" style={{ background: c?.color.base ?? "var(--color-ink-4)" }} />
                  {f}
                </span>
              );
            })}
          </div>
        </div>
      )}
      {mayEdit && (
        <button type="button" className="ctl-ghost h-7 self-center text-meta" onClick={onEdit}>
          <Pencil className="size-3.5" strokeWidth={1.75} />
          {vazio ? "Definir objetivo" : "Editar"}
        </button>
      )}
    </div>
  );
}

function SessionList({ sessions, planOf, empty }: { sessions: TrainingSession[]; planOf: Map<string, PlanSummary>; empty: string }) {
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

/** Uma época sem datas na base: "2026/27" é de 1 de agosto a 31 de julho. */
function epocaPeloRotulo(label: string): { startsOn: string; endsOn: string } | null {
  const y = Number(label.slice(0, 4));
  if (!Number.isFinite(y) || y < 2000) return null;
  return { startsOn: `${y}-08-01`, endsOn: `${y + 1}-07-31` };
}
