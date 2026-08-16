import { Link } from "react-router-dom";
import { useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Attention } from "@/components/Attention";
import { NewAthleteDialog } from "@/components/NewAthleteDialog";
import { WeekStrip } from "@/components/WeekStrip";
import { Bar, Metric, MetricRow, Monogram, Panel, PanelHead, PanelLink, Pill } from "@/components/primitives";
import { CalendarDays, Megaphone, Plus, Receipt, Users, Wallet } from "@/lib/icons";
import {
  attendanceRate,
  attentionItems,
  currentPeriod,
  feeSummary,
  listAnnouncements,
  listAthletes,
  listFees,
  listGuardians,
  listTeams,
  today,
} from "@/lib/api";
import { greeting, longDate, money, percent, relativeDays } from "@/lib/format";
import { useSession } from "@/session";

export default function DirectorOverview() {
  const { session } = useSession();
  const [creating, setCreating] = useState(false);

  const athletes = listAthletes(session).filter((a) => a.status === "active");
  const guardians = listGuardians();
  const fees = feeSummary(session);
  const attendance = attendanceRate(session, 30);

  // Comparações honestas: período anterior real, não uma percentagem inventada.
  const prevPeriod = shiftPeriod(currentPeriod, -1);
  const prevFees = feeSummary(session, prevPeriod);
  const prevAttendance = attendanceRate(session, 60);

  const collectionRate = fees.billedCents ? fees.collectedCents / fees.billedCents : 0;
  const prevCollectionRate = prevFees.billedCents ? prevFees.collectedCents / prevFees.billedCents : 0;

  const joinedThisMonth = athletes.filter((a) => a.joinedAt.startsWith(currentPeriod)).length;
  const withApp = guardians.filter((g) => g.appInstalled).length;

  const firstName = session.name.split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow="Academia Life Club"
        title={`${greeting(today)}, ${firstName}`}
        subtitle={`${capitalize(weekdayName(today))}, ${longDate(today)}`}
      >
        <Link to="/comunicacao" className="ctl-outline">
          <Megaphone className="size-3.5" strokeWidth={1.75} />
          Comunicar
        </Link>
        <button type="button" onClick={() => setCreating(true)} className="ctl-primary">
          <Plus className="size-3.5" strokeWidth={2} />
          Novo atleta
        </button>
      </PageHeader>

      <div className="space-y-3">
        {/* Trabalho antes de estatística. */}
        <Attention items={attentionItems(session)} />

        <MetricRow>
          <Metric
            label="Atletas activos"
            value={String(athletes.length)}
            icon={Users}
            note={joinedThisMonth > 0 ? `+${joinedThisMonth} este mês` : "sem entradas este mês"}
          />
          <Metric
            label="Cobrado em agosto"
            value={money(fees.collectedCents, { compact: true })}
            icon={Wallet}
            delta={round1((collectionRate - prevCollectionRate) * 100)}
            note={`de ${money(fees.billedCents, { compact: true })} facturado`}
          />
          <Metric
            label="Presença média"
            value={attendance !== null ? percent(attendance) : "—"}
            icon={CalendarDays}
            delta={attendance !== null && prevAttendance !== null ? round1((attendance - prevAttendance) * 100) : undefined}
            note="últimos 30 dias"
          />
          <Metric
            label="Famílias com a app"
            value={percent(withApp / guardians.length)}
            icon={Receipt}
            note={`${withApp} de ${guardians.length} famílias`}
          />
        </MetricRow>

        <WeekStrip session={session} />

        {/* Em ecrãs muito largos a cobrança ganha o espaço extra — é a coluna com
            mais linhas. O painel de comunicação estica mal. */}
        <div className="grid gap-3 lg:grid-cols-[1.55fr_1fr] 2xl:grid-cols-[2.2fr_1fr]">
          <BillingByTeam />
          <RecentComms />
        </div>
      </div>

      {creating && <NewAthleteDialog session={session} onClose={() => setCreating(false)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Cobrança por escalão.
 *
 * Um donut diria "78% cobrado" e deixaria o diretor sem saber o que fazer a seguir.
 * Por escalão, ele vê onde está o buraco e a quem telefonar — e as barras ordenam-se
 * pelo pior, porque é aí que está o trabalho.
 */
function BillingByTeam() {
  const { session } = useSession();
  const teams = listTeams(session);
  const athletes = listAthletes(session);
  const fees = listFees(session, currentPeriod);

  const rows = teams
    .map((team) => {
      const ids = new Set(athletes.filter((a) => a.teamId === team.id).map((a) => a.id));
      const mine = fees.filter((f) => ids.has(f.athleteId));
      const billed = mine.reduce((n, f) => n + f.amountCents, 0);
      const collected = mine.filter((f) => f.status === "paid").reduce((n, f) => n + f.amountCents, 0);
      const open = mine.filter((f) => f.status === "overdue").length;
      return { team, billed, collected, open, rate: billed ? collected / billed : 1 };
    })
    .sort((a, b) => a.rate - b.rate);

  return (
    <Panel>
      <PanelHead title="Cobrança de agosto" hint="por escalão">
        <Link to="/mensalidades" className="ctl-ghost">
          Ver tudo
        </Link>
      </PanelHead>

      <ul className="px-5 py-1.5">
        {rows.map(({ team, collected, billed, open, rate }) => (
          <li key={team.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
            <span className="w-40 shrink-0 truncate text-body font-medium text-ink">{team.name}</span>

            <span className="min-w-0 flex-1">
              <Bar value={rate} tone={rate >= 0.9 ? "ok" : rate >= 0.75 ? "signal" : "warn"} />
            </span>

            <span className="w-14 shrink-0 text-right text-meta font-semibold text-ink tabular">{percent(rate)}</span>

            <span className="w-24 shrink-0 text-right text-meta text-ink-3 tabular">
              {money(collected, { compact: true })} / {money(billed, { compact: true })}
            </span>

            <span className="w-16 shrink-0 text-right">
              {open > 0 ? <Pill tone="risk">{open} em falta</Pill> : <Pill tone="ok">completo</Pill>}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function RecentComms() {
  const items = listAnnouncements().slice(0, 3);

  return (
    <Panel className="flex flex-col">
      <PanelHead title="Comunicação" hint="últimos avisos" />

      <ul className="flex-1 px-5 py-1.5">
        {items.map((a) => (
          <li key={a.id} className="border-b border-line py-3 last:border-0">
            <div className="mb-1 flex items-start gap-2">
              <Monogram name={a.audience} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-body font-medium text-ink">{a.title}</p>
                <p className="text-meta text-ink-3">
                  {a.audience} · {relativeDays(new Date(a.publishedAt), today)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pl-8">
              <Bar value={a.read / a.reach} tone={a.read / a.reach >= 0.8 ? "ok" : "signal"} />
              <span className="shrink-0 text-[11px] text-ink-3 tabular">
                {a.read}/{a.reach} lido
              </span>
            </div>
          </li>
        ))}
      </ul>

      <PanelLink to="/comunicacao">Ver comunicação</PanelLink>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function shiftPeriod(period: string, months: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
const weekdayName = (d: Date) => WEEKDAYS[d.getDay()];
const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
