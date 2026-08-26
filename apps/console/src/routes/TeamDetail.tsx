import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Attention } from "@/components/Attention";
import { EventDetail } from "@/components/EventDetail";
import { PersonLink } from "@/components/PersonLink";
import {
  AvailabilityTag,
  cx,
  DataTable,
  Empty,
  Metric,
  MetricRow,
  Monogram,
  Panel,
  PanelHead,
  Pill,
  type Column,
} from "@/components/primitives";
import { Segmented } from "@/components/filters";
import {
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  Clock,
  HeartPulse,
  LayoutGrid,
  Trophy,
  Users,
  Whistle,
} from "@/lib/icons";
import {
  athleteById,
  attendanceRate,
  coachById,
  currentPeriod,
  guardiansOf,
  listAthletes,
  listFees,
  listTeams,
  sportById,
  teamById,
  today,
  unrecordedSessions,
} from "@/lib/api";
import { age, longDate, percent, relativeDays, shortDate, shortName, time } from "@/lib/format";
import { teamAgeLabel } from "@/lib/team-age";
import { availabilityOf, useClinicalRecords } from "@/lib/clinical";
import { can, type Session } from "@/lib/permissions";
import { useSession } from "@/session";
import {
  groupByDay,
  KIND_LABEL,
  resultOutcome,
  tallyNoun,
  useEvents,
  useTeamColors,
  type CalendarEvent,
  type MatchInfo,
} from "@/lib/calendar";
import type { Athlete, AttentionItem } from "@/data/types";

type Tab = "overview" | "roster" | "stats" | "calendar" | "staff" | "medical";

const TABS: { value: Tab; label: string; icon: typeof LayoutGrid }[] = [
  { value: "overview", label: "Visão geral", icon: LayoutGrid },
  { value: "roster", label: "Plantel", icon: Users },
  { value: "stats", label: "Estatísticas", icon: Trophy },
  { value: "calendar", label: "Calendário", icon: CalendarDays },
  { value: "staff", label: "Staff", icon: Whistle },
  { value: "medical", label: "Médico", icon: HeartPulse },
];

/**
 * A ficha de uma equipa — a "página do clube" pedida, mas por escalão.
 *
 * "Plantel" e "estatísticas" só fazem sentido para uma equipa concreta, não para a
 * academia inteira: um Sub-9 e os Seniores não partilham nem adversários nem
 * marcadores. É por isso que esta página vive em `/equipas/:id`, não em `/clube`.
 *
 * Nada aqui inventa dados novos — é tudo derivado do que já existe: os jogos vêm
 * de `useEvents` (a mesma fonte do calendário e da importação do ZeroZero), o
 * registo e os marcadores são somados a partir dos resultados que o treinador já
 * regista no painel do jogo.
 */
export default function TeamDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  useClinicalRecords();

  const team = teamById(id);
  const inScope = listTeams(session).some((t) => t.id === id);
  const colors = useTeamColors(session);

  // Uma janela generosa — uma época inteira, para trás e para a frente — para que
  // "Estatísticas" tenha todos os jogos já disputados e "Calendário" veja o resto.
  const from = useMemo(() => new Date(today.getFullYear() - 1, 0, 1), []);
  const to = useMemo(() => new Date(today.getFullYear() + 1, 11, 31), []);
  const events = useEvents(session, from, to).filter((e) => e.teamId === id);
  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;

  if (!team || !inScope) {
    return (
      <>
        <BackLink />
        <Panel>
          <div className="px-5 py-16">
            <Empty title="Equipa não encontrada" detail="Ou não está no teu âmbito de acesso." />
          </div>
        </Panel>
      </>
    );
  }

  const sport = sportById(team.sportId);
  const roster = listAthletes(session).filter((a) => a.teamId === id);
  const activeRoster = roster.filter((a) => a.status === "active");
  const coaches = team.coachIds.map(coachById).filter((c): c is NonNullable<typeof c> => !!c);

  const matches = events.filter(
    (e): e is CalendarEvent & { match: MatchInfo } => e.kind === "match" && !!e.match,
  );
  const played = matches.filter((e) => e.match.result);
  const record = computeRecord(played);
  const scorers = computeScorers(played);

  const attendance30 = attendanceRate(session, 30, id);
  const nextEvent = events
    .filter((e) => !e.cancelled && e.start >= today)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  const canBill = can(session, "billing:read");
  const canFamily = can(session, "family:read");
  const fees = canBill ? listFees(session, currentPeriod) : [];

  return (
    <>
      <BackLink />

      <PageHeader
        eyebrow={`${sport?.name ?? ""} · ${teamAgeLabel(team.maxAge)} · ${team.season}`}
        title={team.name}
        subtitle={coaches.map((c) => c.name).join(", ") || "Sem treinador atribuído"}
      >
        <span
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-medium"
          style={{ background: colors.get(id)?.soft, color: colors.get(id)?.ink }}
        >
          <span className="size-2 rounded-full" style={{ background: colors.get(id)?.base }} aria-hidden />
          {activeRoster.length} atletas
        </span>
      </PageHeader>

      <div className="mb-3">
        <Segmented value={tab} onChange={setTab} options={TABS} />
      </div>

      {tab === "overview" && (
        <OverviewTab
          session={session}
          team={team}
          roster={roster}
          activeRoster={activeRoster}
          record={record}
          played={played}
          attendance30={attendance30}
          nextEvent={nextEvent}
          onSelectEvent={setSelectedEventId}
        />
      )}

      {tab === "roster" && (
        <RosterTab roster={roster} fees={fees} canBill={canBill} canFamily={canFamily} />
      )}

      {tab === "stats" && (
        <StatsTab teamId={id} record={record} played={played} scorers={scorers} attendance30={attendance30} />
      )}

      {tab === "calendar" && (
        <CalendarTab events={events} onSelect={setSelectedEventId} />
      )}

      {tab === "staff" && <StaffTab coaches={coaches} />}

      {tab === "medical" && <MedicalTab roster={roster} />}

      {selectedEvent && (
        <EventDetail
          event={selectedEvent}
          session={session}
          color={colors.get(id)}
          onClose={() => setSelectedEventId(null)}
        />
      )}
    </>
  );
}

function BackLink() {
  return (
    <Link to="/equipas" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
      <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      Equipas
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Visão geral                                                                 */
/* -------------------------------------------------------------------------- */

function OverviewTab({
  session,
  team,
  roster,
  activeRoster,
  record,
  played,
  attendance30,
  nextEvent,
  onSelectEvent,
}: {
  session: Session;
  team: NonNullable<ReturnType<typeof teamById>>;
  roster: Athlete[];
  activeRoster: Athlete[];
  record: MatchRecord;
  played: (CalendarEvent & { match: MatchInfo })[];
  attendance30: number | null;
  nextEvent?: CalendarEvent;
  onSelectEvent: (id: string) => void;
}) {
  const items = teamAttention(session, team.id, roster);
  const recentForm = [...played].sort((a, b) => a.start.getTime() - b.start.getTime()).slice(-5);

  return (
    <div className="space-y-3">
      <MetricRow>
        <Metric label="Atletas" value={String(activeRoster.length)} icon={Users} note={`de ${roster.length} inscritos`} />
        <Metric
          label="Presença"
          value={attendance30 !== null ? percent(attendance30) : "—"}
          icon={CircleCheck}
          note="últimos 30 dias"
        />
        <Metric
          label="Registo"
          value={record.played > 0 ? `${record.w}-${record.d}-${record.l}` : "—"}
          note={record.played > 0 ? `${record.played} jogos · V-E-D` : "sem jogos disputados"}
        />
        <Metric
          label="Próximo"
          value={nextEvent ? relativeDays(nextEvent.start, today) : "—"}
          icon={Clock}
          note={nextEvent ? `${KIND_LABEL[nextEvent.kind]} · ${shortDate(nextEvent.start)}` : "nada agendado"}
        />
      </MetricRow>

      <Attention items={items} />

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        {nextEvent && (
          <Panel>
            <PanelHead title="A seguir" hint={relativeDays(nextEvent.start, today)} />
            <button
              type="button"
              onClick={() => onSelectEvent(nextEvent.id)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors duration-[120ms] hover:bg-sunken/50"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
                <CalendarDays className="size-4" strokeWidth={1.75} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium text-ink">
                  {KIND_LABEL[nextEvent.kind]}
                  {nextEvent.kind === "match" && nextEvent.match ? ` vs ${nextEvent.match.opponent}` : ""}
                </span>
                <span className="block text-meta text-ink-3">
                  {capitalize(longDate(nextEvent.start))} · <span className="font-mono tabular">{time(nextEvent.start)}</span> ·{" "}
                  {nextEvent.venue}
                </span>
              </span>
            </button>
          </Panel>
        )}

        <Panel>
          <PanelHead title="Forma recente" hint={recentForm.length ? `últimos ${recentForm.length}` : undefined} />
          {recentForm.length === 0 ? (
            <div className="px-5 py-8">
              <Empty title="Ainda sem jogos" detail="A forma aparece assim que houver resultados." />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-5 py-4">
              {recentForm.map((m) => {
                const outcome = resultOutcome(m.match)!;
                const tone = outcome === "win" ? "bg-ok text-white" : outcome === "loss" ? "bg-risk text-white" : "bg-ink-4 text-white";
                const letter = outcome === "win" ? "V" : outcome === "loss" ? "D" : "E";
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelectEvent(m.id)}
                    title={`vs ${m.match.opponent} · ${m.match.result!.ourScore}-${m.match.result!.theirScore}`}
                    className={cx("flex size-8 items-center justify-center rounded-full text-meta font-bold transition-transform duration-[120ms] hover:scale-105", tone)}
                  >
                    {letter}
                  </button>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Plantel                                                                     */
/* -------------------------------------------------------------------------- */

function RosterTab({
  roster,
  fees,
  canBill,
  canFamily,
}: {
  roster: Athlete[];
  fees: ReturnType<typeof listFees>;
  canBill: boolean;
  canFamily: boolean;
}) {
  const feeByAthlete = new Map(fees.map((f) => [f.athleteId, f]));

  const allColumns: Column<Athlete>[] = [
    {
      key: "name",
      header: "Atleta",
      render: (a) => (
        <div className="flex items-center gap-2.5">
          <Monogram name={a.name} photoUrl={a.photoUrl} />
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
      key: "position",
      header: "Posição",
      render: (a) => <span className="text-ink-2">{a.position ?? "—"}</span>,
    },
    {
      key: "guardian",
      header: "Encarregado",
      hideBelow: "md",
      render: (a) => {
        const g = guardiansOf(a.id)[0];
        return g ? <span className="text-ink-2">{shortName(g.name)}</span> : <span className="text-ink-4">—</span>;
      },
    },
    {
      key: "medical",
      header: "Ficha médica",
      hideBelow: "sm",
      render: (a) => <MedicalPill athlete={a} />,
    },
    {
      key: "status",
      header: "Estado",
      hideBelow: "lg",
      render: (a) => (a.status === "paused" ? <Pill tone="warn">Em pausa</Pill> : <Pill tone="ok">Activo</Pill>),
    },
    {
      key: "fee",
      header: "Mensalidade",
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
    if (c.key === "guardian") return canFamily;
    if (c.key === "fee") return canBill;
    return true;
  });

  return (
    <Panel>
      <DataTable
        columns={columns}
        rows={[...roster].sort((a, b) => a.name.localeCompare(b.name, "pt"))}
        keyOf={(a) => a.id}
        to={(a) => `/atletas/${a.id}`}
        empty={<Empty icon={Users} title="Sem atletas nesta equipa" />}
      />
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Estatísticas                                                                */
/* -------------------------------------------------------------------------- */

function StatsTab({
  teamId,
  record,
  played,
  scorers,
  attendance30,
}: {
  teamId: string;
  record: MatchRecord;
  played: (CalendarEvent & { match: MatchInfo })[];
  scorers: { athleteId: string; tally: number }[];
  attendance30: number | null;
}) {
  const noun = tallyNoun(teamId);

  if (played.length === 0) {
    return (
      <Panel>
        <div className="px-5 py-16">
          <Empty
            icon={Trophy}
            title="Ainda sem jogos disputados"
            detail="A estatística aparece assim que o primeiro resultado for registado no calendário."
          />
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      <MetricRow>
        <Metric label="Jogos disputados" value={String(record.played)} icon={Trophy} />
        <Metric label="Registo" value={`${record.w}-${record.d}-${record.l}`} note="vitórias-empates-derrotas" />
        <Metric
          label={`${noun[0].toUpperCase()}${noun.slice(1)}s`}
          value={`${record.gf}-${record.ga}`}
          note="marcados-sofridos"
        />
        <Metric label="Presença" value={attendance30 !== null ? percent(attendance30) : "—"} note="últimos 30 dias" />
      </MetricRow>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHead title="Melhores marcadores" />
          {scorers.length === 0 ? (
            <div className="px-5 py-8">
              <Empty title="Sem marcadores registados" />
            </div>
          ) : (
            <ul className="px-5 py-1.5">
              {scorers.map((s, i) => {
                const a = athleteById(s.athleteId);
                return (
                  <li key={s.athleteId} className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
                    <span className="w-4 shrink-0 text-meta font-semibold text-ink-4 tabular">{i + 1}</span>
                    <Monogram name={a?.name ?? "?"} photoUrl={a?.photoUrl} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-body text-ink">{shortName(a?.name ?? "—")}</span>
                    <span className="shrink-0 text-meta font-semibold text-ink tabular">
                      {s.tally} {noun}
                      {s.tally > 1 ? "s" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel>
          <PanelHead title="Resultados" hint={`${played.length} jogos`} />
          <ul className="px-5 py-1.5">
            {[...played]
              .sort((a, b) => b.start.getTime() - a.start.getTime())
              .map((m) => {
                const outcome = resultOutcome(m.match)!;
                const tone = outcome === "win" ? "ok" : outcome === "loss" ? "risk" : "neutral";
                return (
                  <li key={m.id} className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
                    <span className="w-16 shrink-0 text-meta text-ink-3">{shortDate(m.start)}</span>
                    <span className="min-w-0 flex-1 truncate text-body text-ink-2">
                      {m.match.home ? "vs" : "@"} {m.match.opponent}
                    </span>
                    <span className="shrink-0 text-meta font-semibold text-ink tabular">
                      {m.match.result!.ourScore}-{m.match.result!.theirScore}
                    </span>
                    <Pill tone={tone}>{outcome === "win" ? "V" : outcome === "loss" ? "D" : "E"}</Pill>
                  </li>
                );
              })}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Calendário                                                                  */
/* -------------------------------------------------------------------------- */

function CalendarTab({ events, onSelect }: { events: CalendarEvent[]; onSelect: (id: string) => void }) {
  const upcoming = events.filter((e) => e.start >= today).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = events.filter((e) => e.start < today).sort((a, b) => b.start.getTime() - a.start.getTime());

  const renderGroup = (title: string, list: CalendarEvent[]) => {
    const byDay = groupByDay(list);
    if (byDay.size === 0) return null;

    return (
      <Panel key={title}>
        <PanelHead title={title} hint={`${list.length}`} />
        <ul>
          {[...byDay.entries()].map(([key, items]) => {
            const day = new Date(`${key}T00:00:00`);
            return (
              <li key={key} className="flex gap-4 border-b border-line px-5 py-3 last:border-0">
                <div className="w-12 shrink-0 pt-0.5 text-meta text-ink-3">{shortDate(day)}</div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  {items.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      onClick={() => onSelect(e.id)}
                      className={cx(
                        "flex w-full items-center gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2 text-left transition-colors duration-[120ms] hover:border-line-strong",
                        e.cancelled && "bg-sunken/50",
                      )}
                    >
                      <span className="w-14 shrink-0 font-mono text-meta text-ink-2 tabular">{time(e.start)}</span>
                      <span className={cx("min-w-0 flex-1 truncate text-body font-medium", e.cancelled ? "text-ink-4 line-through" : "text-ink")}>
                        {KIND_LABEL[e.kind]}
                        {e.kind === "match" && e.match ? ` vs ${e.match.opponent}` : ""}
                      </span>
                      <span className="shrink-0 text-meta text-ink-3">{e.venue}</span>
                      {e.kind === "match" && e.match?.result && (
                        <Pill tone={resultOutcome(e.match) === "win" ? "ok" : resultOutcome(e.match) === "loss" ? "risk" : "neutral"}>
                          {e.match.result.ourScore}-{e.match.result.theirScore}
                        </Pill>
                      )}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    );
  };

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <Panel>
        <div className="px-5 py-16">
          <Empty icon={CalendarDays} title="Sem eventos" detail="Esta equipa não tem treinos, jogos nem eventos agendados." />
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {renderGroup("Próximos", upcoming)}
      {renderGroup("Anteriores", past)}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Staff                                                                       */
/* -------------------------------------------------------------------------- */

function StaffTab({ coaches }: { coaches: NonNullable<ReturnType<typeof coachById>>[] }) {
  return (
    <Panel>
      {coaches.length === 0 ? (
        <div className="px-5 py-16">
          <Empty icon={Whistle} title="Sem treinador atribuído" />
        </div>
      ) : (
        <ul>
          {coaches.map((c) => (
            <li key={c.id} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
              <Monogram name={c.name} photoUrl={c.photoUrl} />
              <div className="min-w-0 flex-1">
                <PersonLink id={c.id} name={c.name} className="truncate text-body font-medium text-ink" />
                <div className="text-meta text-ink-3">
                  {c.email} · {c.phone}
                </div>
              </div>
              <Pill tone={c.title.startsWith("Treinador principal") ? "signal" : "neutral"}>{c.title}</Pill>
              <span className="shrink-0 text-meta text-ink-3">na academia desde {new Date(c.since).getFullYear()}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Departamento médico                                                         */
/* -------------------------------------------------------------------------- */

function MedicalTab({ roster }: { roster: Athlete[] }) {
  const sorted = [...roster].sort(
    (a, b) => new Date(a.medicalValidUntil).getTime() - new Date(b.medicalValidUntil).getTime(),
  );
  const expired = roster.filter((a) => new Date(a.medicalValidUntil) < today).length;
  const soon = roster.filter((a) => {
    const d = new Date(a.medicalValidUntil).getTime();
    return d >= today.getTime() && d < today.getTime() + 30 * 86_400_000;
  }).length;
  const ok = roster.length - expired - soon;

  return (
    <div className="space-y-3">
      <MetricRow>
        <Metric label="Em dia" value={String(ok)} icon={CircleCheck} note="mais de 30 dias de validade" />
        <Metric label="A expirar" value={String(soon)} note="nos próximos 30 dias" />
        <Metric label="Expiradas" value={String(expired)} note={expired > 0 ? "não podem competir" : "nenhuma"} />
        <Metric label="Plantel" value={String(roster.length)} note="total de fichas" />
      </MetricRow>

      <Panel>
        <ul>
          {sorted.map((a) => (
            <li key={a.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
              <Monogram name={a.name} photoUrl={a.photoUrl} />
              <span className="min-w-0 flex-1 truncate text-body text-ink">{shortName(a.name)}</span>
              <span className="shrink-0 text-meta text-ink-3 tabular">
                até {shortDate(new Date(a.medicalValidUntil))}
              </span>
              <MedicalPill athlete={a} />
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

function MedicalPill({ athlete }: { athlete: Athlete }) {
  const d = new Date(athlete.medicalValidUntil).getTime();
  if (d < today.getTime()) return <Pill tone="risk">Expirada</Pill>;
  if (d < today.getTime() + 30 * 86_400_000) return <Pill tone="warn">A expirar</Pill>;
  return <Pill tone="ok">Em dia</Pill>;
}

/* -------------------------------------------------------------------------- */
/* Cálculos                                                                    */
/* -------------------------------------------------------------------------- */

type MatchRecord = { w: number; d: number; l: number; gf: number; ga: number; played: number };

function computeRecord(matches: (CalendarEvent & { match: MatchInfo })[]): MatchRecord {
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  for (const m of matches) {
    const r = m.match.result!;
    gf += r.ourScore;
    ga += r.theirScore;
    if (r.ourScore > r.theirScore) w++;
    else if (r.ourScore < r.theirScore) l++;
    else d++;
  }
  return { w, d, l, gf, ga, played: matches.length };
}

function computeScorers(matches: (CalendarEvent & { match: MatchInfo })[]) {
  const totals = new Map<string, number>();
  for (const m of matches) {
    for (const s of m.match.result!.scorers) totals.set(s.athleteId, (totals.get(s.athleteId) ?? 0) + s.tally);
  }
  return [...totals.entries()]
    .map(([athleteId, tally]) => ({ athleteId, tally }))
    .sort((a, b) => b.tally - a.tally)
    .slice(0, 5);
}

/**
 * "Precisa de atenção", mas só desta equipa — os mesmos factos que a Visão Geral
 * da academia mostra, filtrados a um escalão. Vive aqui e não em `lib/api.ts`
 * porque só esta página precisa de "atenção por equipa"; a versão académica
 * continua a ser a fonte para a Visão Geral do diretor e do treinador.
 */
function teamAttention(session: Session, teamId: string, roster: Athlete[]): AttentionItem[] {
  const items: AttentionItem[] = [];

  const unrecorded = unrecordedSessions(session).filter((s) => s.teamId === teamId);
  if (unrecorded.length > 0) {
    items.push({
      id: "team-unrecorded",
      severity: "warn",
      title: `${unrecorded.length} treinos sem presenças registadas`,
      detail: "Sem registo, a assiduidade do atleta fica incompleta no relatório",
      to: "/presencas",
      action: "Registar",
    });
  }

  const expiring = roster.filter((a) => new Date(a.medicalValidUntil).getTime() < today.getTime() + 30 * 86_400_000);
  if (expiring.length > 0) {
    const expired = expiring.filter((a) => new Date(a.medicalValidUntil) < today).length;
    items.push({
      id: "team-medical",
      severity: expired > 0 ? "risk" : "warn",
      title: `${expiring.length} fichas médicas a expirar`,
      detail: expired > 0 ? `${expired} já expiraram — o atleta não pode competir` : "Dentro dos próximos 30 dias",
      to: "/atletas?filtro=medico",
      action: "Ver",
    });
  }

  const order = { risk: 0, warn: 1, info: 2 } as const;
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
