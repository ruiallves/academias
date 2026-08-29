import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Attention } from "@/components/Attention";
import { WeekStrip } from "@/components/WeekStrip";
import { Bar, Empty, Monogram, Panel, PanelHead, PanelLink, Pill } from "@/components/primitives";
import { CalendarDays, ClipboardCheck, Gauge, MapPin, Users } from "@/lib/icons";
import {
  attendanceRate,
  attentionItems,
  athleteById,
  listAthletes,
  listEvaluations,
  listTeams,
  nextSession,
  teamById,
  today,
} from "@/lib/api";
import { greeting, longDate, relativeDays, shortName, time } from "@/lib/format";
import type { TrainingSession } from "@/data/types";
import { useSession } from "@/session";

/**
 * A pergunta do treinador é "o que tenho de fazer hoje?".
 *
 * Por isso a página abre com o próximo treino — não com métricas da academia, que
 * não são dele. As métricas só aparecem quando explicam a equipa dele.
 */
export default function CoachOverview() {
  const { session } = useSession();
  const teams = listTeams(session);
  const next = nextSession(session);
  const firstName = session.name.split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow="Academia Life Club"
        title={`${greeting(today)}, ${firstName}`}
        subtitle={`${teams.map((t) => t.name).join(" · ")}`}
      />

      <div className="space-y-3">
        {next && <NextSession training={next} />}

        <Attention items={attentionItems(session)} />

        <WeekStrip session={session} to="/treinos" />

        <div className="grid gap-3 lg:grid-cols-2">
          <MyTeams />
          <PendingEvaluations />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Próximo treino.
 *
 * É o único bloco do produto que se dá ao luxo de ocupar espaço com pouca
 * informação, porque é a informação que o treinador abriu a app para ver. Tudo
 * o que precisa está aqui: quando, onde, com quem, e o que fazer a seguir.
 */
function NextSession({ training: s }: { training: TrainingSession }) {
  const { session } = useSession();
  const team = teamById(s.teamId);
  const start = new Date(s.start);
  const end = new Date(s.end);
  const roster = listAthletes(session).filter((a) => a.teamId === s.teamId && a.status === "active");

  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
        {/* Marca de sinal à esquerda: é o bloco mais importante da página. */}
        <div className="flex items-center gap-4">
          <span className="w-px self-stretch bg-signal" aria-hidden />
          <div>
            <div className="mb-0.5 text-group text-signal-ink uppercase">Próximo treino · {relativeDays(start, today)}</div>
            <h2 className="text-page text-ink">{team?.name}</h2>
            <p className="mt-0.5 text-body text-ink-3">
              {capitalize(longDate(start))} ·{" "}
              <span className="font-mono tabular">
                {time(start)}–{time(end)}
              </span>
            </p>
          </div>
        </div>

        <dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <Fact icon={MapPin} label="Local" value={s.venue} />
          <Fact icon={Users} label="Plantel" value={`${roster.length} atletas`} />
        </dl>

        {/* Um treino não tem convocatória — vai o plantel todo, e quem falta
            marca-se depois. Convocar é escolher quem joga, e isso só existe em
            jogos (ver EventDetail). */}
        <div className="ml-auto flex items-center gap-2">
          <Link to={`/equipas/${team?.id}`} className="ctl-outline">
            Ver plantel
          </Link>
          {/* `/treinos` deixou de ser as Presenças — é o planner. O registo de
              faltas mora em `/presencas`, e o plano do treino é o gesto novo. */}
          <Link to="/presencas" className="ctl-outline">
            <ClipboardCheck className="size-3.5" strokeWidth={1.75} />
            Registar presenças
          </Link>
          <Link to={`/treinos/${s.id}`} className="ctl-primary">
            Abrir plano
          </Link>
        </div>
      </div>
    </Panel>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-8 items-center justify-center rounded-full bg-sunken text-ink-3">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
      <div>
        <dt className="text-[11px] text-ink-3">{label}</dt>
        <dd className="text-body font-medium text-ink">{value}</dd>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function MyTeams() {
  const { session } = useSession();
  const teams = listTeams(session);
  const athletes = listAthletes(session);

  return (
    <Panel className="flex flex-col">
      <PanelHead title="As minhas equipas" hint={`${teams.length}`} />
      <ul className="flex-1 px-5 py-1.5">
        {teams.map((t) => {
          const count = athletes.filter((a) => a.teamId === t.id).length;
          const rate = attendanceRate(session, 30, t.id);
          return (
            <li key={t.id} className="flex items-center gap-3 border-b border-line py-3 last:border-0">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-[7px] bg-sunken text-ink-3">
                <CalendarDays className="size-4" strokeWidth={1.75} />
              </span>
              <div className="min-w-0 flex-1">
                <Link to={`/equipas/${t.id}`} className="block truncate text-body font-medium text-ink hover:underline">
                  {t.name}
                </Link>
                <span className="text-meta text-ink-3">
                  {count} atletas · {t.schedule.length}× por semana
                </span>
              </div>
              {rate !== null && (
                <span className="flex w-24 shrink-0 items-center gap-2">
                  <Bar value={rate} tone={rate >= 0.85 ? "ok" : "signal"} />
                  <span className="text-meta font-semibold text-ink tabular">{Math.round(rate * 100)}%</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <PanelLink to="/equipas">Ver equipas</PanelLink>
    </Panel>
  );
}

function PendingEvaluations() {
  const { session } = useSession();
  const drafts = listEvaluations(session).filter((e) => e.status === "draft").slice(0, 5);

  return (
    <Panel className="flex flex-col">
      <PanelHead title="Avaliações por publicar" hint={drafts.length ? "os pais ainda não as vêem" : undefined} />

      {drafts.length === 0 ? (
        <div className="flex-1 px-5 py-12">
          <Empty icon={Gauge} tone="ok" title="Nada por publicar" detail="Todas as avaliações das tuas equipas estão publicadas." />
        </div>
      ) : (
        <ul className="flex-1 px-5 py-1.5">
          {drafts.map((e) => {
            const a = athleteById(e.athleteId);
            const avg = Object.values(e.scores).reduce((n, v) => n + v, 0) / Object.values(e.scores).length;
            return (
              <li key={e.id} className="flex items-center gap-2.5 border-b border-line py-3 last:border-0">
                <Monogram name={a?.name ?? "?"} photoUrl={a?.photoUrl} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body font-medium text-ink">{shortName(a?.name ?? "—")}</div>
                  <div className="text-meta text-ink-3">
                    {teamById(a?.teamId ?? "")?.name} · editada {relativeDays(new Date(e.updatedAt), today)}
                  </div>
                </div>
                <span className="shrink-0 text-meta font-semibold text-ink tabular">{avg.toFixed(1)}</span>
                <Pill tone="warn">Rascunho</Pill>
              </li>
            );
          })}
        </ul>
      )}

      <PanelLink to="/avaliacoes">Ver avaliações</PanelLink>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
