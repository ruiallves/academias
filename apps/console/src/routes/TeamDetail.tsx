import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { DeleteTeamDialog } from "@/components/DeleteTeamDialog";
import { TeamCompetitionsPanel } from "@/components/TeamCompetitionsPanel";
import { TeamStaffDialog } from "@/components/TeamStaffDialog";
import { isHeadCoach, roleOptions } from "@/lib/team-role";
import { apiPatch } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
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
import { Dialog } from "@/components/Dialog";
import {
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  Clock,
  HeartPulse,
  LayoutGrid,
  Plus,
  Trash2,
  TriangleAlert,
  Trophy,
  Users,
  Whistle,
} from "@/lib/icons";
import {
  athleteById,
  attendanceRate,
  teamCoaches,
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
import { medicalExpiry, medicalNeedsAttention, medicalState, type MedicalState } from "@/lib/medical";
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
  const [atribuir, setAtribuir] = useState(false);
  const [apagar, setApagar] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const navigate = useNavigate();

  useClinicalRecords();

  const team = teamById(id);
  const inScope = listTeams(session).some((t) => t.id === id);
  const colors = useTeamColors(session);

  /*
   * A equipa que estava aberta desapareceu: volta-se à lista.
   *
   * O caminho normal já navega — `onDeleted` no diálogo de apagar — mas isto é a
   * garantia, e cobre o que esse caminho não cobre: outra pessoa apagou a equipa
   * enquanto esta estava com a ficha aberta, ou perdeu-se o âmbito de acesso a
   * ela. Ficar num "não encontrada" a olhar para uma coisa que existia há um
   * segundo não é uma resposta.
   *
   * `jaExistiu` é o que separa os dois casos. Um id que **nunca** foi válido —
   * URL escrito à mão, ligação velha, equipa de outro âmbito — continua a
   * merecer o ecrã de não encontrada: mandar essa pessoa para a lista sem lhe
   * dizer nada esconde-lhe o motivo.
   */
  const jaExistiu = useRef(false);
  useEffect(() => {
    if (team && inScope) {
      jaExistiu.current = true;
      return;
    }
    if (jaExistiu.current) navigate("/equipas", { replace: true });
  }, [team?.id, inScope, navigate]);

  // Uma janela generosa — uma época inteira, para trás e para a frente — para que
  // "Estatísticas" tenha todos os jogos já disputados e "Calendário" veja o resto.
  const from = useMemo(() => new Date(today.getFullYear() - 1, 0, 1), []);
  const to = useMemo(() => new Date(today.getFullYear() + 1, 11, 31), []);
  const events = useEvents(session, from, to).filter((e) => e.teamId === id);
  const selectedEvent = events.find((e) => e.id === selectedEventId) ?? null;

  /**
   * Clicar num evento abre a gaveta — **em todos os tipos**, jogos incluídos.
   *
   * Durante um tempo um jogo saltava daqui direito para a página dele. Era
   * rápido para quem ia à convocatória e mau para todos os outros: sair da ficha
   * da equipa para ver a que horas é, e depois voltar. A gaveta é agora a
   * resposta uniforme, e leva lá dentro *Abrir jogo* e *Ver convocatória* — o
   * atalho ficou, deixou é de ser obrigatório (ver `EventDetail`).
   *
   * Vale para os três sítios que chamam isto: o "A seguir", as bolinhas da forma
   * recente e o separador do calendário. Todos tiram os ids do mesmo `events`.
   */
  function abrir(eventId: string) {
    setSelectedEventId(eventId);
  }

  if (!team || !inScope) {
    return (
      <>
        <BackLink />
        <Panel>
          <div>
            <Empty title="Equipa não encontrada" detail="Ou não está no teu âmbito de acesso." />
          </div>
        </Panel>
      </>
    );
  }

  const sport = sportById(team.sportId);
  const roster = listAthletes(session).filter((a) => a.teamId === id);
  const activeRoster = roster.filter((a) => a.status === "active");
  // Mesma razão de `Teams.tsx`: os nomes vêm com a equipa, não da lista de staff
  // — que um treinador não pode ler. Ver `teamCoaches`.
  const coaches = teamCoaches(team);

  const matches = events.filter(
    (e): e is CalendarEvent & { match: MatchInfo } => e.kind === "match" && !!e.match,
  );
  const played = matches.filter((e) => e.match.result);
  const record = computeRecord(played);
  const totals = computeTotals(played);

  const attendance30 = attendanceRate(session, 30, id);
  const nextEvent = events
    .filter((e) => !e.cancelled && e.start >= today)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  const canBill = can(session, "billing:read");
  const canFamily = can(session, "family:read");
  const fees = canBill ? listFees(session, currentPeriod) : [];
  const mayAssign = can(session, "access:write");

  return (
    <>
      <BackLink />

      <PageHeader
        eyebrow={`${sport?.name ?? ""} · ${teamAgeLabel(team.maxAge)} · ${team.season}`}
        title={team.name}
        subtitle={coaches.map((c) => c.name).join(", ") || "Sem treinador atribuído"}
      >
        {/*
          Uma equipa sem treinador é uma avaria, não uma configuração.

          Ninguém marca o treino, ninguém fecha as presenças, ninguém monta a
          convocatória — e nada no produto o dizia: a página abria com "Sem
          treinador atribuído" em letra pequena por baixo do nome, ao lado de
          onde se lê a época. Fica ao lado da contagem de atletas, que é onde os
          olhos já vão, e leva o gesto consigo em vez de mandar a pessoa
          procurá-lo na ficha de cada treinador.
        */}
        {coaches.length === 0 && mayAssign && (
          <button
            type="button"
            onClick={() => setAtribuir(true)}
            className="flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-meta font-medium text-warn transition-colors hover:bg-warn/15"
          >
            <TriangleAlert className="size-3.5" strokeWidth={2} />
            Sem treinador · atribuir
          </button>
        )}

        <span
          className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-meta font-medium"
          style={{ background: colors.get(id)?.soft, color: colors.get(id)?.ink }}
        >
          <span className="size-2 rounded-full" style={{ background: colors.get(id)?.base }} aria-hidden />
          {activeRoster.length} atletas
        </span>

        {/*
          Apagar fica no fim e discreto: é a única acção desta página sem volta,
          e ninguém deve tropeçar nela a caminho de ver o plantel. Só aparece a
          quem tem `team:delete` — presidência e direção, por omissão.
        */}
        {can(session, "team:delete") && (
          <button
            type="button"
            aria-label="Apagar equipa"
            title="Apagar equipa"
            className="ctl-ghost size-8 justify-center px-0 text-ink-4 hover:bg-risk-soft hover:text-risk"
            onClick={() => setApagar(true)}
          >
            <Trash2 className="size-4" strokeWidth={1.75} />
          </button>
        )}
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
          onSelectEvent={abrir}
        />
      )}

      {tab === "roster" && (
        <RosterTab roster={roster} fees={fees} canBill={canBill} canFamily={canFamily} />
      )}

      {tab === "stats" && (
        <StatsTab teamId={id} record={record} played={played} totals={totals} attendance30={attendance30} />
      )}

      {tab === "calendar" && (
        <CalendarTab events={events} onSelect={abrir} mayCreate={can(session, "calendar:write")} teamId={id} />
      )}

      {tab === "staff" && (
        <StaffTab
          teamId={id}
          coaches={coaches}
          mayAssign={mayAssign}
          /* Quem manda na equipa é decisão desportiva: `team:write`, a mesma de
             criar a equipa. Ver `setTeamRole` na API. */
          mayRole={can(session, "team:write")}
          onAssign={() => setAtribuir(true)}
        />
      )}

      {atribuir && (
        <TeamStaffDialog
          modo={{ tipo: "equipa", teamId: id, teamName: team.name }}
          session={session}
          onClose={() => setAtribuir(false)}
        />
      )}

      {apagar && (
        <DeleteTeamDialog
          teamId={id}
          onClose={() => setApagar(false)}
          // Apagada, esta página deixa de ter assunto: volta-se à lista.
          onDeleted={() => navigate("/equipas", { replace: true })}
        />
      )}

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

      {/* As provas ficam no topo da visão geral: é o quadro competitivo da
          época, e responde a "onde é que esta equipa joga" antes de qualquer
          número. */}
      <TeamCompetitionsPanel team={team} editable={can(session, "team:write")} />

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
        const label = { paid: "Pago", processing: "A confirmar", pending: "Não pago", overdue: "Vencido", void: "Anulada" };
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
  totals,
  attendance30,
}: {
  teamId: string;
  record: MatchRecord;
  played: (CalendarEvent & { match: MatchInfo })[];
  totals: PlayerTotals[];
  attendance30: number | null;
}) {
  const noun = tallyNoun(teamId);

  /** Qual dos rankings está aberto em diálogo. `null` = nenhum. */
  const [aberto, setAberto] = useState<Ranking | null>(null);

  if (played.length === 0) {
    return (
      <Panel>
        <div>
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

      {/*
        Três rankings, e o mesmo painel três vezes.

        Cada um mostra o **top 5** e abre a equipa toda num diálogo. Cinco linhas
        é o que responde à pergunta que se faz de passagem ("quem é que anda a
        marcar?"); a lista completa é outra pergunta ("onde é que eu estou
        nisto?"), e essa merece um ecrã só para si em vez de trinta linhas a
        empurrar os Resultados para fora da vista.
      */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <RankingPanel
          titulo={`Melhores marcadores`}
          vazio={`Sem ${noun}s registados`}
          linhas={ordenar(totals, "tally")}
          valor={(t) => `${t.tally} ${noun}${t.tally === 1 ? "" : "s"}`}
          onVerTodos={() => setAberto("tally")}
        />
        <RankingPanel
          titulo="Mais minutos"
          vazio="Sem minutos registados"
          linhas={ordenar(totals, "minutes")}
          valor={(t) => `${t.minutes}′`}
          detalhe={(t) => `${t.games} ${t.games === 1 ? "jogo" : "jogos"}`}
          onVerTodos={() => setAberto("minutes")}
        />
        <RankingPanel
          titulo="Mais assistências"
          vazio="Sem assistências registadas"
          linhas={ordenar(totals, "assists")}
          valor={(t) => `${t.assists}`}
          onVerTodos={() => setAberto("assists")}
        />
      </div>

      {aberto && (
        <RankingDialog
          ranking={aberto}
          noun={noun}
          totals={totals}
          onClose={() => setAberto(null)}
        />
      )}

      <div className="grid gap-3">
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
/* Rankings                                                                    */
/* -------------------------------------------------------------------------- */

/** As três colunas por que se pode ordenar. */
type Ranking = "tally" | "minutes" | "assists";

/**
 * Ordena por uma coluna, com desempate estável.
 *
 * O desempate importa mais do que parece: dois atletas com sete golos cada
 * apareciam em ordem arbitrária, e essa ordem mudava a cada render — uma lista
 * que se reordena sozinha à frente de quem a lê parece avariada. Desempata-se
 * pelos minutos (quem fez o mesmo em menos tempo vem primeiro) e, se ainda
 * empatar, pelo nome, que é estável.
 *
 * Quem tem zero na coluna fica de fora: um ranking de marcadores com dez linhas
 * a zero não é um ranking, é o plantel.
 */
function ordenar(totals: PlayerTotals[], por: Ranking): PlayerTotals[] {
  return totals
    .filter((t) => t[por] > 0)
    .sort((a, b) => {
      if (b[por] !== a[por]) return b[por] - a[por];
      if (por !== "minutes" && a.minutes !== b.minutes) return a.minutes - b.minutes;
      return (athleteById(a.athleteId)?.name ?? "").localeCompare(athleteById(b.athleteId)?.name ?? "", "pt");
    });
}

/**
 * Um ranking: as cinco primeiras linhas, e a porta para a lista completa.
 *
 * "Mostrar todos" só aparece quando há mais do que cinco — um botão que abre um
 * diálogo com as mesmas cinco linhas que já estão no ecrã é um botão que ensina
 * a não carregar em botões.
 */
function RankingPanel({
  titulo,
  vazio,
  linhas,
  valor,
  detalhe,
  onVerTodos,
}: {
  titulo: string;
  vazio: string;
  linhas: PlayerTotals[];
  valor: (t: PlayerTotals) => string;
  detalhe?: (t: PlayerTotals) => string;
  onVerTodos: () => void;
}) {
  const top = linhas.slice(0, 5);

  return (
    <Panel className="flex flex-col">
      <PanelHead title={titulo} hint={linhas.length > 5 ? `top 5 de ${linhas.length}` : undefined} />

      {top.length === 0 ? (
        <div className="px-5 py-8">
          <Empty title={vazio} />
        </div>
      ) : (
        <ul className="px-5 py-1.5">
          {top.map((t, i) => (
            <RankingRow key={t.athleteId} posicao={i + 1} total={t} valor={valor} detalhe={detalhe} />
          ))}
        </ul>
      )}

      {linhas.length > 5 && (
        <button
          type="button"
          onClick={onVerTodos}
          className="mt-auto flex min-h-11 items-center justify-center gap-1 border-t border-line text-meta font-medium text-ink-2 transition-colors duration-[120ms] hover:bg-sunken/50 hover:text-ink"
        >
          Mostrar todos
          <ChevronRight className="size-3.5" strokeWidth={1.75} />
        </button>
      )}
    </Panel>
  );
}

/** Uma linha de ranking. Partilhada pelo painel e pelo diálogo, para não divergirem. */
function RankingRow({
  posicao,
  total,
  valor,
  detalhe,
}: {
  posicao: number;
  total: PlayerTotals;
  valor: (t: PlayerTotals) => string;
  detalhe?: (t: PlayerTotals) => string;
}) {
  const a = athleteById(total.athleteId);

  return (
    <li className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
      <span className="w-4 shrink-0 text-meta font-semibold text-ink-4 tabular">{posicao}</span>
      <Monogram name={a?.name ?? "?"} photoUrl={a?.photoUrl} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-body text-ink">{shortName(a?.name ?? "—")}</span>
        {detalhe && <span className="block truncate text-meta text-ink-4">{detalhe(total)}</span>}
      </span>
      <span className="shrink-0 text-meta font-semibold text-ink tabular">{valor(total)}</span>
    </li>
  );
}

/**
 * A equipa toda, num ranking.
 *
 * As três colunas estão sempre à vista — quem abre "mais minutos" e repara que o
 * segundo classificado tem sete golos quer poder trocar de ordenação ali, sem
 * fechar e abrir outro diálogo. Por isso o cabeçalho é clicável e o diálogo
 * lembra-se de por onde entrou.
 */
function RankingDialog({
  ranking,
  noun,
  totals,
  onClose,
}: {
  ranking: Ranking;
  noun: string;
  totals: PlayerTotals[];
  onClose: () => void;
}) {
  const [por, setPor] = useState<Ranking>(ranking);
  const linhas = ordenar(totals, por);

  const COLUNAS: { id: Ranking; label: string }[] = [
    { id: "tally", label: `${noun[0].toUpperCase()}${noun.slice(1)}s` },
    { id: "minutes", label: "Minutos" },
    { id: "assists", label: "Assistências" },
  ];

  return (
    <Dialog
      title="A equipa toda"
      subtitle={`${linhas.length} ${linhas.length === 1 ? "atleta" : "atletas"} com registo`}
      icon={<Trophy className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={560}
      labelledBy="ranking-dialog"
      footer={
        <button type="button" className="ctl-ghost" onClick={onClose}>
          Fechar
        </button>
      }
    >
      <div className="flex gap-1 border-b border-line px-5 py-3">
        {COLUNAS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-pressed={por === c.id}
            onClick={() => setPor(c.id)}
            className={cx(
              "min-h-9 rounded-[var(--radius-control)] px-3 text-meta font-medium transition-colors",
              por === c.id ? "bg-ink text-surface" : "text-ink-3 hover:bg-sunken hover:text-ink",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      {linhas.length === 0 ? (
        <div className="px-5 py-10">
          <Empty title="Ninguém com registo nesta coluna" />
        </div>
      ) : (
        <ul className="max-h-[min(60vh,420px)] overflow-y-auto px-5 py-1.5">
          {linhas.map((t, i) => (
            <RankingRow
              key={t.athleteId}
              posicao={i + 1}
              total={t}
              /*
                O valor segue a coluna escolhida, e os outros dois vão para o
                detalhe — assim a lista responde à ordenação sem esconder o resto,
                que é a razão de alguém abrir este diálogo em vez de ler o top 5.
              */
              valor={(x) => (por === "tally" ? `${x.tally} ${noun}${x.tally === 1 ? "" : "s"}` : por === "minutes" ? `${x.minutes}′` : `${x.assists}`)}
              detalhe={(x) =>
                por === "minutes"
                  ? `${x.games} ${x.games === 1 ? "jogo" : "jogos"} · ${x.tally} ${noun}${x.tally === 1 ? "" : "s"} · ${x.assists} ass.`
                  : `${x.minutes}′ em ${x.games} ${x.games === 1 ? "jogo" : "jogos"}`
              }
            />
          ))}
        </ul>
      )}
    </Dialog>
  );
}

/* -------------------------------------------------------------------------- */
/* Calendário                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Os eventos desta equipa, e o caminho para marcar mais um.
 *
 * ## Porque é que o botão leva ao calendário em vez de abrir aqui
 *
 * Porque marcar é do calendário: é lá que se vê o que já está ocupado, e um
 * segundo formulário aqui era a mesma coisa em dois sítios com duas regras a
 * divergirem. O que se evita é a viagem às cegas — o link já vai com o tipo de
 * evento escolhido (`?novo=treino`), como o botão da página de Jogos.
 */
function CalendarTab({
  events,
  onSelect,
  mayCreate,
  teamId,
}: {
  events: CalendarEvent[];
  onSelect: (id: string) => void;
  /** `calendar:write`. Sem isso o link levava a um ecrã sem o botão. */
  mayCreate: boolean;
  /** A equipa desta ficha — viaja no link para não ser escolhida outra vez. */
  teamId: string;
}) {
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

  /*
   * O caminho para marcar. Aparece nos dois estados — com eventos e sem eles —
   * porque a pergunta "e como marco um?" é a mesma nas duas situações.
   */
  const marcar = mayCreate && (
    <div className="flex flex-wrap items-center gap-2">
      <Link to={`/calendario?novo=treino&equipa=${teamId}`} className="ctl-outline">
        <Plus className="size-3.5" strokeWidth={2} />
        Marcar treino
      </Link>
      <Link to={`/calendario?novo=jogo&equipa=${teamId}`} className="ctl-outline">
        <Plus className="size-3.5" strokeWidth={2} />
        Marcar jogo
      </Link>
      <Link to="/calendario" className="text-meta text-ink-3 hover:text-ink hover:underline">
        ver o calendário
      </Link>
    </div>
  );

  if (upcoming.length === 0 && past.length === 0) {
    return (
      <Panel>
        <div className="px-5 py-14 text-center">
          <Empty icon={CalendarDays} title="Sem eventos" detail="Esta equipa não tem treinos, jogos nem eventos agendados." />
          {marcar && <div className="mt-4 flex justify-center">{marcar}</div>}
        </div>
      </Panel>
    );
  }

  return (
    <div className="space-y-3">
      {renderGroup("Próximos", upcoming)}
      {renderGroup("Anteriores", past)}
      {marcar}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Staff                                                                       */
/* -------------------------------------------------------------------------- */

function StaffTab({
  teamId,
  coaches,
  mayAssign,
  mayRole,
  onAssign,
}: {
  teamId: string;
  coaches: ReturnType<typeof teamCoaches>;
  mayAssign: boolean;
  mayRole: boolean;
  onAssign: () => void;
}) {
  /*
   * O cargo na equipa, editável aqui.
   *
   * Dava para pôr pessoas na equipa e não dava para dizer qual delas a treina —
   * a etiqueta com "Treinador principal" existia mas era só de leitura, escrita
   * uma vez ao atribuir a equipa. Editar o cargo é a segunda coisa que se faz a
   * seguir a atribuir, e por isso vive na própria linha da pessoa e não atrás de
   * outro diálogo.
   *
   * Grava à mudança e não com um "Guardar": é um campo só, e um botão para um
   * campo só é um passo a mais para dizer o que já se disse.
   */
  const [aGravar, setAGravar] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function definir(membershipId: string, title: string) {
    setAGravar(membershipId);
    setErro(null);
    try {
      // Promover despromove quem lá estava (ver o serviço), por isso recarrega-se
      // a equipa toda em vez de mexer só nesta linha.
      await apiPatch(`/api/teams/${teamId}/staff/${membershipId}`, { title });
      await reloadAcademy();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível guardar o cargo.");
    } finally {
      setAGravar(null);
    }
  }

  const semPrincipal = coaches.length > 0 && !coaches.some((c) => isHeadCoach(c.title));

  return (
    <Panel>
      {/* Com treinadores, o gesto vive no cabeçalho do painel; sem eles, é o
          vazio que o leva — e aí é a única coisa que há para fazer. */}
      {coaches.length > 0 && mayAssign && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <span className="text-meta text-ink-3">
            {coaches.length} {coaches.length === 1 ? "pessoa atribuída" : "pessoas atribuídas"}
          </span>
          <button type="button" onClick={onAssign} className="ctl-outline">
            <Whistle className="size-3.5" strokeWidth={1.75} />
            Gerir Staff
          </button>
        </div>
      )}

      {/*
        Ninguém marcado como principal.

        Não é um erro — o calendário continua a mostrar um nome, o do primeiro
        treinador da equipa. É uma escolha por fazer, e vale a pena dizê-lo aqui
        porque é aqui que se faz: quem lê "Treinador" em três linhas iguais não
        tem como saber que uma delas devia dizer outra coisa.
      */}
      {semPrincipal && mayRole && (
        <p className="border-b border-line bg-sunken px-5 py-2.5 text-meta leading-relaxed text-ink-2">
          Sem treinador principal definido. Nos treinos e nas presenças aparece o primeiro treinador da lista — escolhe
          o responsável no cargo de cada pessoa.
        </p>
      )}

      {coaches.length === 0 ? (
        <div>
          <Empty
            icon={Whistle}
            title="Sem treinador atribuído"
            detail="Sem ninguém atribuído, não há quem marque treinos, feche presenças ou monte convocatórias desta equipa."
          >
            {mayAssign && (
              <button type="button" onClick={onAssign} className="ctl-primary">
                Atribuir treinador
              </button>
            )}
          </Empty>
        </div>
      ) : (
        <ul>
          {coaches.map((c) => (
            <li key={c.id} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
              <Monogram name={c.name} photoUrl={c.photoUrl} />
              <div className="min-w-0 flex-1">
                <PersonLink id={c.id} name={c.name} className="truncate text-body font-medium text-ink" />
                {/* Contactos só a quem pode ler o staff. Um treinador vê quem
                    treina a equipa — que é a pergunta desta página — e não a
                    ficha de pessoal dos colegas. Ver `teamCoaches`. */}
                {c.ficha && (
                  <div className="text-meta text-ink-3">
                    {c.ficha.email} · {c.ficha.phone}
                  </div>
                )}
              </div>

              {mayRole ? (
                <select
                  value={c.title}
                  disabled={aGravar !== null}
                  onChange={(e) => void definir(c.id, e.target.value)}
                  aria-label={`Cargo de ${c.name} nesta equipa`}
                  className={cx(
                    // Mesma métrica dos outros selects da consola (ver `Matches`),
                    // com a borda a marcar quem é o responsável — a etiqueta que
                    // esta linha tinha antes de o campo passar a editável.
                    "h-8 max-w-[200px] cursor-pointer truncate rounded-[var(--radius-control)] border bg-surface px-2 text-meta outline-none focus:border-line-strong disabled:cursor-wait disabled:opacity-60",
                    isHeadCoach(c.title) ? "border-signal-line font-medium text-ink" : "border-line text-ink-2",
                  )}
                >
                  {roleOptions(c.title).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              ) : (
                <Pill tone={isHeadCoach(c.title) ? "signal" : "neutral"}>{c.title}</Pill>
              )}

              {c.ficha && (
                <span className="shrink-0 text-meta text-ink-3">
                  na academia desde {new Date(c.ficha.since).getFullYear()}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {erro && (
        <p className="border-t border-line bg-risk-soft px-5 py-2.5 text-meta text-risk">{erro}</p>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Departamento médico                                                         */
/* -------------------------------------------------------------------------- */

function MedicalTab({ roster }: { roster: Athlete[] }) {
  /*
   * Quem não tem exame vem primeiro.
   *
   * A ordenação era por data e um atleta sem ficha tinha `NaN` — que numa
   * comparação numérica não é maior nem menor do que nada, e por isso caía onde
   * calhasse. É o atleta que mais precisa de aparecer no topo desta lista.
   */
  const sorted = [...roster].sort((a, b) => {
    const da = medicalExpiry(a);
    const dbb = medicalExpiry(b);
    if (!da && !dbb) return a.name.localeCompare(b.name, "pt");
    if (!da) return -1;
    if (!dbb) return 1;
    return da.getTime() - dbb.getTime();
  });

  const conta = (s: MedicalState) => roster.filter((a) => medicalState(a) === s).length;
  const sem = conta("missing");
  const expired = conta("expired");
  const soon = conta("soon");
  const ok = conta("ok");

  return (
    <div className="space-y-3">
      <MetricRow>
        <Metric label="Em dia" value={String(ok)} icon={CircleCheck} note="mais de 30 dias de validade" />
        <Metric label="A expirar" value={String(soon)} note="nos próximos 30 dias" />
        <Metric label="Expiradas" value={String(expired)} note={expired > 0 ? "não podem competir" : "nenhuma"} />
        <Metric label="Sem ficha" value={String(sem)} note={sem > 0 ? "exame por fazer" : "nenhum"} />
      </MetricRow>

      <Panel>
        <ul>
          {sorted.map((a) => {
            const d = medicalExpiry(a);
            return (
              <li key={a.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                <Monogram name={a.name} photoUrl={a.photoUrl} />
                <span className="min-w-0 flex-1 truncate text-body text-ink">{shortName(a.name)}</span>
                <span className="shrink-0 text-meta text-ink-3 tabular">{d ? `até ${shortDate(d)}` : "—"}</span>
                <MedicalPill athlete={a} />
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}

function MedicalPill({ athlete }: { athlete: Athlete }) {
  const state = medicalState(athlete);
  if (state === "missing") return <Pill tone="neutral">Sem ficha</Pill>;
  if (state === "expired") return <Pill tone="risk">Expirada</Pill>;
  if (state === "soon") return <Pill tone="warn">A expirar</Pill>;
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

/**
 * O que cada atleta fez, somado por todos os jogos disputados.
 *
 * ## Uma passagem, três tabelas
 *
 * Havia `computeScorers`, que somava golos e cortava no quinto. Marcadores,
 * minutos e assistências são a mesma soma sobre os mesmos jogos — três funções
 * quase iguais divergiriam à primeira correcção, e cortar no quinto **dentro** do
 * cálculo tornava impossível mostrar a equipa toda no diálogo.
 *
 * Devolve tudo, ordenado por nada em particular; quem mostra é que ordena e
 * corta. É a separação que permite o mesmo dado servir o top 5 e a lista
 * completa sem uma segunda leitura.
 *
 * ## Quem entra
 *
 * Só quem tem linha de ficha nalgum jogo. Um atleta convocado que nunca entrou
 * em campo não aparece — a ausência é a resposta, e é a mesma regra que a ficha
 * de jogo já usa ao gravar.
 */
export type PlayerTotals = { athleteId: string; tally: number; minutes: number; assists: number; games: number };

function computeTotals(matches: (CalendarEvent & { match: MatchInfo })[]): PlayerTotals[] {
  const totals = new Map<string, PlayerTotals>();

  const linha = (athleteId: string) => {
    const existente = totals.get(athleteId);
    if (existente) return existente;
    const nova = { athleteId, tally: 0, minutes: 0, assists: 0, games: 0 };
    totals.set(athleteId, nova);
    return nova;
  };

  for (const m of matches) {
    /*
     * As participações são a fonte — não os marcadores.
     *
     * `scorers` é derivado das participações com `tally > 0`, por isso somar as
     * duas coisas contaria os golos duas vezes. Aqui lê-se a ficha uma vez só.
     */
    for (const a of m.match.result!.appearances ?? []) {
      const l = linha(a.athleteId);
      l.minutes += a.minutes;
      l.assists += a.assists ?? 0;
      l.games += 1;
    }
    for (const sc of m.match.result!.scorers) {
      linha(sc.athleteId).tally += sc.tally;
    }
  }

  return [...totals.values()];
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

  const porTratar = roster.filter((a) => medicalNeedsAttention(a));
  if (porTratar.length > 0) {
    const expired = porTratar.filter((a) => medicalState(a) === "expired").length;
    const sem = porTratar.filter((a) => medicalState(a) === "missing").length;
    items.push({
      id: "team-medical",
      severity: expired > 0 ? "risk" : "warn",
      title: `${porTratar.length} ${porTratar.length === 1 ? "ficha médica" : "fichas médicas"} por tratar`,
      detail:
        [
          expired > 0 && `${expired} ${expired === 1 ? "expirada" : "expiradas"} — não pode competir`,
          sem > 0 && `${sem} sem exame`,
        ]
          .filter(Boolean)
          .join(" · ") || "Dentro dos próximos 30 dias",
      to: "/atletas?filtro=todos&sinal=medico",
      action: "Ver",
    });
  }

  const order = { risk: 0, warn: 1, info: 2 } as const;
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
