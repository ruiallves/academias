import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AvailabilityTag,
  Bar,
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
import { ClinicalPanel } from "@/components/ClinicalPanel";
import {
  ArrowLeft,
  Cake,
  ClipboardCheck,
  FileText,
  Footprints,
  Gauge,
  HeartPulse,
  Home,
  LayoutGrid,
  Pencil,
  Ruler,
  Star,
  Timer,
  Trophy,
  Wallet,
  Weight,
} from "@/lib/icons";
import {
  athleteAttendanceSummary,
  athleteById,
  athleteSessions,
  feeHistory,
  guardiansOf,
  listTeams,
  sportById,
  teamById,
  today,
  type AthleteSessionRecord,
} from "@/lib/api";
import { apiDelete, apiGet, apiPatch, apiPut } from "@/lib/http";
import { useApi } from "@/lib/query";
import { average, type ApiEvaluation, type ApiReport } from "@/lib/development";
import { ReportDialog, VisibilityPill } from "@/components/ReportDialog";
import { PhotoPicker } from "@/components/PhotoPicker";
import { removeAthletePhoto, uploadAthletePhoto } from "@/lib/photos";
import { dominantSideLabel, summariseSeason, useAthleteMatches, type AthleteMatch } from "@/lib/athlete";
import { activeRestriction, availabilityOf, useClinicalRecords } from "@/lib/clinical";
import { tallyNoun } from "@/lib/calendar";
import { calledUpFor, matchLabel } from "@/lib/callups";
import { reloadAcademy, useStore } from "@/lib/store";
import { age, longDate, money, percent, periodLabel, relativeDays, shortDate, time } from "@/lib/format";
import { can } from "@/lib/permissions";
import { AthleteEditPanel } from "@/components/AthleteEditPanel";
import { useSession } from "@/session";
import type { Athlete } from "@/data/types";
import { Spinner } from "@/components/Busy";

type Tab = "overview" | "matches" | "attendance" | "development" | "clinical" | "fees" | "family";

/**
 * A ficha do atleta.
 *
 * É a página que justifica o resto do produto: tudo o que o treinador regista —
 * presenças, convocatórias, resultados, avaliações — converge aqui, e é isto que
 * um pai acaba por receber em forma de relatório. Se esta página estiver vazia, o
 * registo diário não serviu para nada.
 *
 * Nada aqui é inventado: os jogos vêm das participações registadas no calendário,
 * a assiduidade vem das faltas marcadas nos treinos, e o que não existir aparece
 * como estado vazio em vez de um zero que finge ser um facto.
 */
export default function AthleteDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);

  const athlete = athleteById(id);
  const inScope = athlete ? listTeams(session).some((t) => t.id === athlete.teamId) : false;

  const matches = useAthleteMatches(session, id);

  if (!athlete || !inScope) {
    return (
      <>
        <BackLink />
        <Panel>
          <div>
            <Empty title="Atleta não encontrado" detail="Ou não está no teu âmbito de acesso." />
          </div>
        </Panel>
      </>
    );
  }

  const team = teamById(athlete.teamId);
  const sport = sportById(team?.sportId ?? "");
  const season = summariseSeason(id, matches);
  const attendance = athleteAttendanceSummary(id);
  const hasMatches = (sport?.positions.length ?? 0) > 0;

  const tabs: { value: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { value: "overview", label: "Visão geral", icon: LayoutGrid },
    // Um nadador não tem registo de jogos — o separador não aparece, em vez de
    // aparecer vazio a explicar-se.
    ...(hasMatches ? [{ value: "matches" as const, label: "Jogos", icon: Trophy }] : []),
    { value: "attendance", label: "Assiduidade", icon: ClipboardCheck },
    // Avaliações e relatórios juntos: são as duas coisas que a academia **escreve**
    // sobre o atleta, e quem abre uma costuma querer ver a outra a seguir.
    ...(can(session, "evaluation:read") || can(session, "report:read")
      ? [{ value: "development" as const, label: "Desenvolvimento", icon: Gauge }]
      : []),
    { value: "clinical", label: "Clínico", icon: HeartPulse },
    ...(can(session, "billing:read") ? [{ value: "fees" as const, label: "Mensalidades", icon: Wallet }] : []),
    ...(can(session, "family:read") ? [{ value: "family" as const, label: "Encarregado", icon: Home }] : []),
  ];

  return (
    <>
      <BackLink />

      <AthleteHeader athlete={athlete} />

      {/*
        Editar vive ao lado dos separadores, e não no cabeçalho.
        É onde estão as outras acções de navegação da ficha, e é a linha para onde
        o olho vai a seguir ao nome — no cabeçalho competia com a identidade do
        atleta e parecia pertencer à fotografia.
      */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Segmented value={tab} onChange={setTab} options={tabs} />
        {!editing && can(session, "athlete:write") && (
          <button type="button" className="ctl-ghost shrink-0" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" strokeWidth={1.75} />
            Editar
          </button>
        )}
      </div>

      {/*
        A página troca de modo em vez de abrir uma janela por cima. Uma ficha de
        atleta não cabe num diálogo: obrigaria a escolher meia dúzia de campos e a
        deixar os outros sem sítio nenhum para serem corrigidos.
      */}
      {editing ? (
        <AthleteEditPanel
          athlete={athlete}
          session={session}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
      <>
      {tab === "overview" && (
        <Overview athlete={athlete} season={season} attendance={attendance} matches={matches} hasMatches={hasMatches} />
      )}
      {tab === "matches" && <Matches athleteId={id} matches={matches} />}
      {tab === "attendance" && <Attendance athleteId={id} />}
      {tab === "development" && <Development athlete={athlete} />}
      {tab === "clinical" && <Clinical athlete={athlete} />}
      {tab === "fees" && <FeesTab athlete={athlete} />}
      {tab === "family" && <Family athlete={athlete} />}
      </>
      )}
    </>
  );
}

function BackLink() {
  return (
    <Link to="/atletas" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
      <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      Atletas
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Cabeçalho                                                                   */
/* -------------------------------------------------------------------------- */

function AthleteHeader({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  const team = teamById(athlete.teamId);
  const sport = sportById(team?.sportId ?? "");

  // Redesenha assim que o departamento clínico der baixa ou alta.
  useClinicalRecords();
  const availability = availabilityOf(athlete.id);
  const restriction = activeRestriction(athlete.id);

  // O "até quando" é informação de planeamento e chega a quem tem clinical:status.
  // O diagnóstico exige clinical:read e vive no separador Clínico.
  const detail =
    restriction?.expectedReturn && can(session, "clinical:status")
      ? `até ${shortDate(new Date(restriction.expectedReturn))}`
      : undefined;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      <AthletePhoto athlete={athlete} />

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          {sport && <Pill tone="signal">{sport.name}</Pill>}
          <span className="text-meta text-ink-3">{team?.name}</span>
          {athlete.position && <span className="text-meta text-ink-3">· {athlete.position}</span>}
          {athlete.status === "paused" && <Pill tone="warn">Em pausa</Pill>}
          <CalledUpTag athleteId={athlete.id} />
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-page text-ink">{athlete.name}</h1>
          <AvailabilityTag availability={availability} detail={detail} />
        </div>
        <p className="mt-0.5 text-body text-ink-3">
          {age(new Date(athlete.birthdate), today)} anos · na academia desde{" "}
          {new Date(athlete.joinedAt).getFullYear()}
        </p>
      </div>

      {athlete.squadNumber !== undefined && (
        <div className="shrink-0 text-right">
          <div className="text-[36px] leading-none font-semibold text-ink tabular">{athlete.squadNumber}</div>
          <div className="text-[11px] text-ink-3">camisola</div>
        </div>
      )}

    </div>
  );
}

/**
 * "Convocado para o próximo jogo".
 *
 * Só aparece quando a convocatória foi **submetida**: uma lista ainda em rascunho
 * pode mudar, e uma etiqueta que promete um jogo e desaparece no dia seguinte é
 * pior do que não existir. É a mesma regra que decide quando a família é avisada.
 *
 * Traz o adversário e o dia porque "Convocado" sozinho manda perguntar para quê —
 * e a resposta está a dois campos de distância.
 */
function CalledUpTag({ athleteId }: { athleteId: string }) {
  // Redesenha quando uma convocatória for submetida noutro separador.
  useStore();
  const match = calledUpFor(athleteId);
  if (!match) return null;

  // Convidado de outro escalão: dito por extenso, porque "Convocado" sozinho não
  // explica porque é que um atleta dos Sub-11 vai jogar com os Sub-13.
  const entry = match.calledUp.find((c) => c.athleteId === athleteId);
  const d = new Date(match.startsAt);

  return (
    <Pill tone="signal">
      {entry?.isGuest ? `Emprestado ao ${match.teamName}` : "Convocado"} · {matchLabel(match)} · {shortDate(d)}
    </Pill>
  );
}

/**
 * Foto do atleta.
 *
 * O botão existia e não fazia nada — carregava-se e não acontecia coisa nenhuma,
 * porque não havia armazenamento do outro lado. Agora carrega mesmo: o ficheiro vai
 * do browser directamente para o Supabase, e o que fica na base é uma chave, servida
 * como link assinado com prazo. Ver `lib/photos.ts` e `storage/photos.service.ts`.
 */
function AthletePhoto({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();

  return (
    <PhotoPicker
      name={athlete.name}
      photoUrl={athlete.photoUrl}
      editable={can(session, "athlete:write")}
      onUpload={async (file) => {
        await uploadAthletePhoto(athlete.id, file);
        await reloadAcademy();
      }}
      onRemove={async () => {
        await removeAthletePhoto(athlete.id);
        await reloadAcademy();
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Visão geral                                                                 */
/* -------------------------------------------------------------------------- */

function Overview({
  athlete,
  season,
  attendance,
  matches,
  hasMatches,
}: {
  athlete: Athlete;
  season: ReturnType<typeof summariseSeason>;
  attendance: ReturnType<typeof athleteAttendanceSummary>;
  matches: AthleteMatch[];
  hasMatches: boolean;
}) {
  const noun = tallyNoun(athlete.teamId);
  const sideLabel = dominantSideLabel(athlete.id);
  const recent = matches.slice(0, 5);

  return (
    <div className="space-y-3">
      <MetricRow>
        {hasMatches ? (
          <>
            <Metric label="Jogos" value={String(season.played)} icon={Trophy} note={`${season.starts} completos`} />
            <Metric
              label="Minutos"
              value={String(season.minutes)}
              icon={Timer}
              note={season.minutesShare !== null ? `${percent(season.minutesShare)} do possível` : "na época"}
            />
            <Metric
              label={`${noun[0].toUpperCase()}${noun.slice(1)}s`}
              value={String(season.tally)}
              note={season.played ? `${(season.tally / season.played).toFixed(2)} por jogo` : "sem jogos"}
            />
            <Metric
              label="Nota média"
              value={season.rating !== null ? season.rating.toFixed(1) : "—"}
              icon={Star}
              note="fórmula por definir"
            />
          </>
        ) : (
          <>
            <Metric
              label="Assiduidade"
              value={attendance.rate !== null ? percent(attendance.rate) : "—"}
              icon={ClipboardCheck}
              note={`${attendance.recorded} treinos registados`}
            />
            <Metric label="Faltas" value={String(attendance.absent)} note="não justificadas" />
            <Metric label="Justificadas" value={String(attendance.justified)} note="com aviso" />
            <Metric label="Atrasos" value={String(attendance.late)} note="chegou depois" />
          </>
        )}
      </MetricRow>

      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Panel>
          <PanelHead title="Ficha física" hint="actualizada manualmente" />
          <dl className="px-5 py-1.5">
            <PhysicalRow icon={Cake} label="Data de nascimento" value={`${longDate(new Date(athlete.birthdate))} de ${new Date(athlete.birthdate).getFullYear()}`} />
            <PhysicalRow icon={Ruler} label="Altura" value={athlete.heightCm ? `${athlete.heightCm} cm` : "—"} />
            <PhysicalRow icon={Weight} label="Peso" value={athlete.weightKg ? `${athlete.weightKg} kg` : "—"} />
            {/* O rótulo vem da modalidade: "Pé dominante" no futebol, "Mão
                dominante" no basquetebol, e nada na natação. */}
            {sideLabel && (
              <PhysicalRow icon={Footprints} label={sideLabel} value={athlete.dominantSide ?? "—"} />
            )}
          </dl>
        </Panel>

        {hasMatches ? (
          <Panel>
            <PanelHead title="Últimos jogos" hint={recent.length ? `${recent.length}` : undefined} />
            {recent.length === 0 ? (
              <div className="px-5 py-10">
                <Empty title="Ainda sem jogos" detail="Aparecem aqui assim que houver participações registadas." />
              </div>
            ) : (
              <ul className="px-5 py-1.5">
                {recent.map((m) => (
                  <li key={m.event.id} className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
                    <OutcomeDot outcome={m.outcome} />
                    <span className="min-w-0 flex-1 truncate text-body text-ink-2">
                      {m.match.home ? "vs" : "@"} {m.match.opponent}
                    </span>
                    <span className="shrink-0 text-meta text-ink-3 tabular">{m.appearance.minutes}′</span>
                    {m.tally > 0 && <Pill tone="signal">{m.tally}</Pill>}
                    <span className="w-8 shrink-0 text-right text-meta font-semibold text-ink tabular">
                      {m.appearance.rating?.toFixed(1) ?? "—"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ) : (
          <AttendancePanel athleteId={athlete.id} />
        )}
      </div>

      {hasMatches && <AttendancePanel athleteId={athlete.id} />}
    </div>
  );
}

function PhysicalRow({ icon: Icon, label, value }: { icon: typeof Ruler; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line py-2.5 last:border-0">
      <Icon className="size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />
      <dt className="min-w-0 flex-1 text-body text-ink-3">{label}</dt>
      <dd className="shrink-0 text-body font-medium text-ink">{value}</dd>
    </div>
  );
}

function OutcomeDot({ outcome }: { outcome: "win" | "draw" | "loss" }) {
  const tone = outcome === "win" ? "bg-ok" : outcome === "loss" ? "bg-risk" : "bg-ink-4";
  const label = outcome === "win" ? "V" : outcome === "loss" ? "D" : "E";
  return (
    <span className={cx("flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white", tone)}>
      {label}
    </span>
  );
}

function AttendancePanel({ athleteId }: { athleteId: string }) {
  const s = athleteAttendanceSummary(athleteId);

  return (
    <Panel>
      <PanelHead title="Assiduidade" hint="últimos 6 meses" />
      {s.recorded === 0 ? (
        <div className="px-5 py-10">
          <Empty title="Sem treinos registados" detail="A assiduidade aparece quando os treinos forem registados." />
        </div>
      ) : (
        <div className="space-y-3 p-5">
          <div className="flex items-baseline gap-2">
            <span className="text-metric text-ink tabular">{percent(s.rate ?? 0)}</span>
            <span className="text-meta text-ink-3">
              {s.present + s.late} de {s.recorded} treinos
            </span>
          </div>
          <Bar value={s.rate ?? 0} tone={(s.rate ?? 0) >= 0.85 ? "ok" : (s.rate ?? 0) >= 0.7 ? "signal" : "warn"} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-ink-3">
            <span>{s.present} presenças</span>
            <span>{s.late} atrasos</span>
            <span>{s.justified} justificadas</span>
            <span className={s.absent > 0 ? "font-medium text-risk" : ""}>{s.absent} faltas</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Jogos                                                                       */
/* -------------------------------------------------------------------------- */

function Matches({ athleteId, matches }: { athleteId: string; matches: AthleteMatch[] }) {
  const noun = tallyNoun(athleteById(athleteId)?.teamId);
  const season = summariseSeason(athleteId, matches);

  const columns: Column<AthleteMatch>[] = [
    {
      key: "date",
      header: "Data",
      width: "96px",
      render: (m) => <span className="text-ink-3 tabular">{shortDate(m.event.start)}</span>,
    },
    {
      key: "match",
      header: "Jogo",
      render: (m) => (
        <div className="flex items-center gap-2.5">
          <OutcomeDot outcome={m.outcome} />
          <div className="min-w-0">
            <div className="truncate font-medium text-ink">
              {m.match.home ? "vs" : "@"} {m.match.opponent}
            </div>
            <div className="text-meta text-ink-3 tabular">
              {m.match.result!.ourScore}–{m.match.result!.theirScore} · {time(m.event.start)}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "team",
      header: "Escalão",
      hideBelow: "md",
      // Guardamos o escalão por que jogou, não o actual — um Sub-13 que jogou
      // por Sub-15 tem de continuar a ver isso na ficha no ano seguinte.
      render: (m) => <span className="text-ink-2">{teamById(m.teamId)?.name}</span>,
    },
    {
      key: "minutes",
      header: "Minutos",
      align: "right",
      hideBelow: "sm",
      render: (m) => <span className="text-ink-2 tabular">{m.appearance.minutes}′</span>,
    },
    {
      key: "tally",
      header: `${noun[0].toUpperCase()}${noun.slice(1)}s`,
      align: "right",
      hideBelow: "sm",
      render: (m) => (m.tally > 0 ? <Pill tone="signal">{m.tally}</Pill> : <span className="text-ink-4">—</span>),
    },
    {
      key: "rating",
      header: "Nota",
      align: "right",
      width: "80px",
      render: (m) =>
        m.appearance.rating !== undefined ? (
          <span className="font-semibold text-ink tabular">{m.appearance.rating.toFixed(1)}</span>
        ) : (
          <span className="text-ink-4">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-3">
      <MetricRow>
        <Metric label="Jogos" value={String(season.played)} icon={Trophy} note={`${season.wins}V ${season.draws}E ${season.losses}D`} />
        <Metric label="Minutos" value={String(season.minutes)} icon={Timer} note={season.played ? `${Math.round(season.minutes / season.played)}′ por jogo` : "—"} />
        <Metric label={`${noun[0].toUpperCase()}${noun.slice(1)}s`} value={String(season.tally)} />
        <Metric label="Nota média" value={season.rating !== null ? season.rating.toFixed(1) : "—"} icon={Star} note="fórmula por definir" />
      </MetricRow>

      <Panel>
        <PanelHead
          title="Registo de jogos"
          hint="a nota do jogo é provisória — a fórmula ainda vai ser definida"
        />
        <DataTable
          columns={columns}
          rows={matches}
          keyOf={(m) => m.event.id}
          empty={<Empty icon={Trophy} title="Ainda sem jogos" detail="As participações aparecem aqui assim que forem registadas no calendário." />}
        />
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Assiduidade                                                                 */
/* -------------------------------------------------------------------------- */

const STATUS_META: Record<string, { label: string; tone: "ok" | "warn" | "risk" | "neutral" }> = {
  present: { label: "Presente", tone: "ok" },
  late: { label: "Atrasado", tone: "neutral" },
  justified: { label: "Justificada", tone: "warn" },
  absent: { label: "Faltou", tone: "risk" },
};

function Attendance({ athleteId }: { athleteId: string }) {
  const records = athleteSessions(athleteId);
  const summary = athleteAttendanceSummary(athleteId);

  const columns: Column<AthleteSessionRecord>[] = [
    {
      key: "date",
      header: "Data",
      width: "110px",
      render: (r) => {
        const d = new Date(r.session.start);
        return (
          <div>
            <div className="text-ink-2 tabular">{shortDate(d)}</div>
            <div className="text-meta text-ink-4">{relativeDays(d, today)}</div>
          </div>
        );
      },
    },
    {
      key: "session",
      header: "Treino",
      render: (r) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{teamById(r.session.teamId)?.name}</div>
          <div className="text-meta text-ink-3">
            <span className="font-mono tabular">{time(new Date(r.session.start))}</span> · {r.session.venue}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Estado",
      align: "right",
      render: (r) => {
        // "Por registar" não é uma falta nem uma presença — é uma lacuna, e
        // mostrá-la como tal impede que a assiduidade minta.
        if (r.status === null) return <span className="text-meta text-ink-4">por registar</span>;
        const meta = STATUS_META[r.status];
        return (
          <span className="inline-flex flex-col items-end gap-0.5">
            <Pill tone={meta.tone}>{meta.label}</Pill>
            {/* O motivo da justificação à vista de quem lê a ficha — é o que
                distingue uma falta com aviso de uma falta seca. */}
            {r.status === "justified" && r.note && (
              <span className="max-w-[220px] truncate text-meta text-ink-3" title={r.note}>
                {r.note}
              </span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-3">
      <MetricRow>
        <Metric
          label="Assiduidade"
          value={summary.rate !== null ? percent(summary.rate) : "—"}
          icon={ClipboardCheck}
          note="últimos 6 meses"
        />
        <Metric label="Presenças" value={String(summary.present + summary.late)} note={`de ${summary.recorded} registados`} />
        <Metric label="Faltas" value={String(summary.absent)} note="não justificadas" />
        <Metric label="Justificadas" value={String(summary.justified)} note="com aviso prévio" />
      </MetricRow>

      <Panel>
        <PanelHead title="Registo de treinos" hint={`${records.length}`} />
        <DataTable
          columns={columns}
          rows={records}
          keyOf={(r) => r.session.id}
          empty={<Empty icon={ClipboardCheck} title="Sem treinos no período" />}
        />
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Boletim clínico                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Reencaminha para o painel partilhado: a mesma peça serve a ficha do atleta e o
 * ecrã do departamento clínico, e assim as regras de privacidade vivem num sítio só.
 */
function Clinical({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  return <ClinicalPanel athlete={athlete} session={session} />;
}

/* -------------------------------------------------------------------------- */

function Family({ athlete }: { athlete: Athlete }) {
  const guardians = guardiansOf(athlete.id);

  return (
    <div className="space-y-3">
      <TaxIdPanel athlete={athlete} />

    <Panel>
      <PanelHead title="Encarregado de educação" hint={`${guardians.length}`} />
      {guardians.length === 0 ? (
        <div className="px-5 py-12">
          <Empty icon={Home} title="Sem encarregado associado" detail="Um atleta devia ter sempre alguém a quem a academia possa telefonar." />
        </div>
      ) : (
        <ul>
          {guardians.map((g) => (
            <li key={g.id} className="border-b border-line px-5 py-4 last:border-0">
              <div className="mb-2 flex items-center gap-2.5">
                <Monogram name={g.name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-ink">{g.name}</div>
                  <div className="text-meta text-ink-3">{g.relation}</div>
                </div>
                {g.appInstalled ? <Pill tone="ok">App instalada</Pill> : <Pill tone="warn">Sem a app</Pill>}
              </div>
              <dl className="space-y-1 pl-[38px] text-meta">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">Telemóvel</dt>
                  <dd className="text-ink-2 tabular">{g.phone}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-3">E-mail</dt>
                  <dd className="truncate text-ink-2">{g.email}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Panel>
    </div>
  );
}

/**
 * O NIF do atleta.
 *
 * ## Porque é que vive no separador da família
 *
 * Porque é aqui que ele serve para alguma coisa. O NIF mais a data de nascimento
 * são a chave com que um pai se liga a este atleta ao instalar a app — sem o
 * campo preenchido, o link que a academia manda não consegue ligar ninguém a esta
 * criança, e a secretaria fica com um telefonema para atender sem saber porquê.
 *
 * Por isso o vazio aqui não é um traço discreto: é um aviso, com a consequência
 * escrita.
 */
function TaxIdPanel({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  const mayEdit = can(session, "athlete:write");

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(athlete.taxId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Já não se aceita vazio: o NIF passou a ser obrigatório, e apagá-lo para o
  // corrigir a seguir deixava, entre as duas coisas, um atleta que nenhuma família
  // consegue reclamar. Corrige-se escrevendo o certo por cima.
  const valid = /^\d{9}$/.test(value.replace(/\s/g, ""));

  async function save() {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/athletes/${athlete.id}/nif`, { taxId: value.replace(/\s/g, "") });
      await reloadAcademy();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <PanelHead title="NIF" hint="liga a família à app" />
      <div className="px-5 py-4">
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="numeric"
              maxLength={11}
              placeholder="123456789"
              autoFocus
              className="h-9 w-[160px] rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body tabular text-ink focus:border-line-strong focus:outline-none"
            />
            <button type="button" onClick={save} disabled={!valid || busy} className="ctl-primary">
              {busy ? "A guardar…" : "Guardar"}
            </button>
            <button type="button" onClick={() => { setEditing(false); setValue(athlete.taxId ?? ""); }} className="ctl-ghost">
              Cancelar
            </button>
            {!valid && <span className="text-meta text-[#a82a20]">São nove dígitos.</span>}
            {error && <span className="text-meta text-[#a82a20]">{error}</span>}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {athlete.taxId ? (
              <span className="text-body tabular text-ink">{athlete.taxId}</span>
            ) : (
              <span className="text-meta leading-relaxed text-[#8a5a12]">
                Por preencher — enquanto estiver assim, nenhum encarregado consegue reclamar este atleta na app.
              </span>
            )}
            {mayEdit && (
              <button type="button" onClick={() => setEditing(true)} className="ctl-outline">
                {athlete.taxId ? "Alterar" : "Preencher"}
              </button>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

/**
 * Desenvolvimento: o que a academia escreveu sobre este atleta.
 *
 * ## Porque é que as avaliações e os relatórios vivem no mesmo separador
 *
 * Porque respondem à mesma pergunta com dois formatos. A avaliação é o boletim
 * regular — as mesmas competências, período a período, e é por isso que aparece
 * como histórico: o valor está na sequência, não na última linha. O relatório é o
 * texto de quando houve alguma coisa para dizer.
 *
 * Separá-los em dois separadores obrigava a saltar entre eles para responder a "como
 * está este miúdo", que é a pergunta que traz alguém a esta página.
 *
 * ## E porque é que se escreve um relatório daqui
 *
 * Porque é aqui que se decide escrevê-lo. Obrigar a ir a Relatórios e escolher o
 * atleta de uma lista é o caminho longo para a mesma coisa — e o caminho longo é o
 * que fica por fazer.
 */
function Development({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  const [writing, setWriting] = useState(false);

  const { data: evaluationData } = useApi<ApiEvaluation[]>(can(session, "evaluation:read") ? "/api/evaluations" : null);
  const { data: reportData, reload } = useApi<ApiReport[]>(
    can(session, "report:read") ? "/api/reports" : null,
    { athleteId: athlete.id },
  );

  const evaluations = (evaluationData ?? []).filter((e) => e.athleteId === athlete.id);
  const reports = reportData ?? [];

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {writing && (
        <ReportDialog report={null} athletes={[athlete]} onClose={() => setWriting(false)} onSaved={reload} />
      )}

      <Panel>
        <PanelHead title="Avaliações" hint={evaluations.length ? `${evaluations.length} períodos` : undefined} />
        {evaluations.length === 0 ? (
          <div className="px-5 py-10">
            <Empty icon={Gauge} title="Ainda sem avaliações" detail="As avaliações do período aparecem aqui, e comparam-se umas com as outras." />
          </div>
        ) : (
          <ul>
            {evaluations.map((e) => {
              const media = average(e.scores);
              return (
                <li key={e.id} className="border-b border-line px-5 py-3 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-body font-medium text-ink">{e.period}</div>
                      <div className="truncate text-meta text-ink-3">
                        {e.coachName.split(" ")[0]}
                        {e.publishedAt && ` · entregue ${shortDate(new Date(e.publishedAt))}`}
                      </div>
                    </div>
                    {media !== null && <span className="shrink-0 text-body font-semibold text-ink tabular">{media.toFixed(1)}</span>}
                    {e.status === "PUBLISHED" ? <Pill tone="ok">Entregue</Pill> : <Pill tone="warn">Rascunho</Pill>}
                  </div>

                  {/* As competências em linha: é o que se compara entre períodos. */}
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {Object.entries(e.scores).map(([skill, value]) => (
                      <div key={skill} className="flex items-baseline gap-1.5">
                        <dt className="text-meta text-ink-3">{skill}</dt>
                        <dd className="text-meta font-medium text-ink tabular">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  {e.strengths && <p className="mt-1.5 text-meta leading-relaxed text-ink-2">{e.strengths}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel>
        <PanelHead title="Relatórios" hint={reports.length ? `${reports.length}` : undefined}>
          {can(session, "report:write") && (
            <button type="button" onClick={() => setWriting(true)} className="ctl-outline">
              Escrever
            </button>
          )}
        </PanelHead>

        {reports.length === 0 ? (
          <div className="px-5 py-10">
            <Empty
              icon={FileText}
              title="Ainda sem relatórios"
              detail="Um texto sobre o percurso deste atleta — interno, ou partilhado com a família."
            />
          </div>
        ) : (
          <ul>
            {reports.map((r) => (
              <li key={r.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-ink">{r.title}</div>
                  <div className="truncate text-meta text-ink-3">
                    {[r.period, r.authorName.split(" ")[0], shortDate(new Date(r.publishedAt ?? r.createdAt))]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                {r.status === "DRAFT" ? <Pill tone="warn">Rascunho</Pill> : <VisibilityPill visibility={r.visibility} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mensalidades                                                                */
/* -------------------------------------------------------------------------- */

type AthleteFee = {
  source: "individual" | "team" | "none";
  effectiveAmountCents: number | null;
  individualAmountCents: number | null;
  teamAmountCents: number | null;
  teamName: string | null;
};

const FEE_STATUS_TONE = { paid: "ok", processing: "signal", pending: "warn", overdue: "risk", void: "neutral" } as const;
const FEE_STATUS_LABEL = { paid: "Pago", processing: "A confirmar", pending: "Pendente", overdue: "Vencido", void: "Anulada" };

/**
 * O que este atleta paga, e o histórico de cobranças.
 *
 * O valor efectivo é sempre um só: individual se houver ajuste, senão o da
 * equipa, senão nenhum — nunca os dois lado a lado a competir pela atenção.
 */
function FeesTab({ athlete }: { athlete: Athlete }) {
  const { session } = useSession();
  const mayConfigure = can(session, "billing:write");
  const history = feeHistory(athlete.id);

  const [fee, setFee] = useState<AthleteFee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setFee(await apiGet<AthleteFee>(`/api/athletes/${athlete.id}/fee`));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível carregar.");
    } finally {
      setLoading(false);
    }
  }, [athlete.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <Panel>
        <PanelHead title="Mensalidade" />
        <div className="px-5 py-5">
          {loading ? (
            <Spinner className="py-3" />
          ) : error ? (
            <p className="text-meta text-risk">{error}</p>
          ) : (
            fee && <FeeEditor athleteId={athlete.id} fee={fee} mayConfigure={mayConfigure} onSaved={load} />
          )}
        </div>
      </Panel>

      <Panel>
        <PanelHead title="Histórico" hint={`${history.length}`} />
        {history.length === 0 ? (
          <div className="px-5 py-12">
            <Empty icon={Wallet} title="Sem mensalidades ainda" />
          </div>
        ) : (
          <ul className="px-5 py-1.5">
            {history.map((f) => (
              <li key={f.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
                <span className="min-w-0 flex-1 truncate text-body text-ink-2">{periodLabel(f.period)}</span>
                <span className="shrink-0 text-meta text-ink tabular">{money(f.amountCents)}</span>
                <Pill tone={FEE_STATUS_TONE[f.status]}>{FEE_STATUS_LABEL[f.status]}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/**
 * O valor efectivo em destaque, com a origem por baixo, e a acção certa consoante
 * o estado: ajustar (quando ainda não há ajuste), mudar ou reverter (quando já há).
 */
function FeeEditor({
  athleteId,
  fee,
  mayConfigure,
  onSaved,
}: {
  athleteId: string;
  fee: AthleteFee;
  mayConfigure: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(fee.individualAmountCents !== null ? (fee.individualAmountCents / 100).toFixed(2) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const cents = Math.round(Number(value.trim().replace(",", ".")) * 100);
    if (!Number.isFinite(cents) || cents < 100) {
      setError("Indica um valor válido, de pelo menos 1 €.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/api/athletes/${athleteId}/fee`, { amountCents: cents });
      await reloadAcademy();
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/athletes/${athleteId}/fee`);
      await reloadAcademy();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível reverter.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="max-w-[280px]">
        <label className="mb-1.5 block text-meta font-medium text-ink-3">Valor individual, por mês</label>
        <div className="flex items-center gap-2">
          <span className="text-body text-ink-3">€</span>
          <input
            type="text"
            inputMode="decimal"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            className="h-9 flex-1 rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body tabular focus:border-line-strong focus:outline-none"
          />
        </div>
        {error && <p className="mt-1.5 text-meta text-risk">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => setEditing(false)} disabled={busy} className="ctl-ghost">
            Cancelar
          </button>
          <button type="button" onClick={() => void save()} disabled={busy} className="ctl-primary">
            {busy ? "A guardar…" : "Guardar"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {fee.effectiveAmountCents === null ? (
        <p className="text-body text-ink-3">Ainda não há preço configurado para este atleta.</p>
      ) : (
        <>
          <div className="text-[36px] leading-none font-semibold text-ink tabular">{money(fee.effectiveAmountCents)}</div>
          <p className="mt-2 text-meta text-ink-3">
            {fee.source === "individual" ? (
              <>
                Ajuste individual — a equipa paga{" "}
                <span className="font-medium text-ink-2">{fee.teamAmountCents !== null ? money(fee.teamAmountCents) : "—"}</span>.
              </>
            ) : (
              <>Preço da equipa{fee.teamName ? ` — ${fee.teamName}` : ""}.</>
            )}
          </p>
        </>
      )}

      {error && <p className="mt-2 text-meta text-risk">{error}</p>}

      {mayConfigure && (
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => setEditing(true)} className="ctl-outline">
            {fee.source === "individual" ? "Alterar valor individual" : "Ajustar individualmente"}
          </button>
          {fee.source === "individual" && (
            <button type="button" onClick={() => void clear()} disabled={busy} className="ctl-ghost">
              {busy ? "A reverter…" : "Reverter para o preço da equipa"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
