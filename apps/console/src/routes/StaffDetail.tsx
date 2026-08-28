import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  DataTable,
  Empty,
  Metric,
  MetricRow,
  Panel,
  PanelHead,
  Pill,
  type Column,
} from "@/components/primitives";
import { Segmented } from "@/components/filters";
import { AccessPanel } from "@/components/AccessPanel";
import { StaffEditDialog } from "@/components/StaffEditDialog";
import { TeamStaffDialog } from "@/components/TeamStaffDialog";
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  Gauge,
  LayoutGrid,
  Mail,
  Phone,
  Shield,
  Trophy,
  Users,
} from "@/lib/icons";
import { sportById } from "@/lib/api";
import { useCustomEvents } from "@/lib/calendar";
import { hasOverrides, useAccessOverrides } from "@/lib/access";
import {
  coachActivity,
  coachMatches,
  matchRecord,
  seasonsCount,
  staffMember,
  teamHistory,
  useStaffEdits,
  yearsAtClub,
  type Stint,
} from "@/lib/staff";
import { shortDate } from "@/lib/format";
import { can, type Session } from "@/lib/permissions";
import { ROLE_LABEL, useSession } from "@/session";
import { DEPARTMENT_LABEL, type StaffMember } from "@/data/types";
import { PhotoPicker } from "@/components/PhotoPicker";
import { removeStaffPhoto, uploadStaffPhoto } from "@/lib/photos";
import { reloadAcademy } from "@/lib/store";

type Tab = "overview" | "teams" | "activity" | "access";

/**
 * A ficha de uma pessoa da academia.
 *
 * ## O que esta página responde
 *
 * Três perguntas que uma direção faz a sério, e que antes obrigavam a perguntar a
 * alguém: *quem é e como se lhe fala*, *por onde passou no clube*, e *o que é que
 * ela vê no produto*. A terceira é a que costuma ficar escondida em código — e
 * quando fica, ninguém consegue auditar quem tem acesso a quê.
 *
 * ## Porque é que os separadores mudam com a pessoa
 *
 * Um roupeiro não tem estatísticas de equipa, e mostrar-lhe um separador vazio a
 * explicar-se seria pior do que não o ter. O mesmo critério da ficha do atleta: o
 * que não se aplica não aparece — e o que não se pode ver também não.
 */
export default function StaffDetail() {
  const { id = "" } = useParams();
  const { session } = useSession();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [atribuir, setAtribuir] = useState(false);

  // Redesenha quando a ficha for editada ou quando um acesso mudar.
  useStaffEdits();
  useAccessOverrides();

  const member = staffMember(id);

  if (!member) {
    return (
      <>
        <BackLink />
        <Panel>
          <div>
            <Empty icon={Users} title="Pessoa não encontrada" detail="Pode ter saído da academia." />
          </div>
        </Panel>
      </>
    );
  }

  const history = teamHistory(id);
  /*
   * Quem trabalha com equipas — pelo papel, e não por já ter alguma.
   *
   * Era `history.length > 0`, e isso escondia o separador exactamente a quem
   * mais precisava dele: um treinador acabado de entrar, ainda sem escalão
   * nenhum. Sem separador, o único sítio onde se lhe podia atribuir uma equipa
   * era o formulário "Editar ficha" — que é para corrigir o telemóvel.
   *
   * O histórico continua a contar para quem já não é treinador: quem passou a
   * director não perde as épocas que treinou.
   */
  const usaEquipas = member.role === "COACH" || member.role === "STAFF" || member.role === "COORDINATOR";
  const worksWithTeams = usaEquipas || history.length > 0;

  const tabs: { value: Tab; label: string; icon: typeof LayoutGrid }[] = [
    { value: "overview", label: "Visão geral", icon: LayoutGrid },
    ...(worksWithTeams ? [{ value: "teams" as const, label: "Equipas", icon: Users }] : []),
    ...(worksWithTeams && can(session, "attendance:read")
      ? [{ value: "activity" as const, label: "Atividade", icon: Gauge }]
      : []),
    // O acesso de outra pessoa não é assunto de toda a gente: é preciso poder
    // geri-lo, ou pelo menos poder ver quem tem o quê.
    ...(can(session, "access:write") || can(session, "settings:write")
      ? [{ value: "access" as const, label: "Acesso", icon: Shield }]
      : []),
  ];

  return (
    <>
      <BackLink />

      <StaffHeader member={member} session={session} onEdit={() => setEditing(true)} />

      {editing && <StaffEditDialog member={member} session={session} onClose={() => setEditing(false)} />}

      {atribuir && (
        <TeamStaffDialog
          modo={{ tipo: "pessoa", membershipId: member.id }}
          session={session}
          onClose={() => setAtribuir(false)}
        />
      )}

      <div className="mb-3">
        <Segmented value={tab} onChange={setTab} options={tabs} />
      </div>

      {tab === "overview" && <Overview member={member} history={history} />}
      {tab === "teams" && (
        <Teams
          history={history}
          member={member}
          mayAssign={can(session, "access:write") && usaEquipas}
          onAssign={() => setAtribuir(true)}
        />
      )}
      {tab === "activity" && <Activity member={member} />}
      {tab === "access" && <AccessPanel member={member} session={session} />}
    </>
  );
}

function BackLink() {
  return (
    <Link to="/staff" className="mb-3 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
      <ArrowLeft className="size-3.5" strokeWidth={1.75} />
      Staff
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Cabeçalho                                                                   */
/* -------------------------------------------------------------------------- */

function StaffHeader({
  member,
  session,
  onEdit,
}: {
  member: StaffMember;
  session: Session;
  onEdit: () => void;
}) {
  const years = yearsAtClub(member.since);

  return (
    <div className="mb-5 flex flex-wrap items-center gap-4">
      {/*
        A fotografia de quem trabalha na academia.
        
        Editável por quem tem `staff:write` **ou** pela própria pessoa — pôr a sua
        própria foto nunca foi um privilégio, e obrigar um treinador a pedir à
        direção era garantir que ninguém tinha foto nenhuma.
      */}
      <PhotoPicker
        name={member.name}
        photoUrl={member.photoUrl}
        size={72}
        editable={can(session, "staff:write") || session.staffId === member.id}
        onUpload={async (file) => {
          await uploadStaffPhoto(member.id, file);
          await reloadAcademy();
        }}
        onRemove={async () => {
          await removeStaffPhoto(member.id);
          await reloadAcademy();
        }}
      />

      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-1.5">
          <Pill tone={member.department === "clinical" ? "signal" : "neutral"}>
            {DEPARTMENT_LABEL[member.department]}
          </Pill>
          <span className="text-meta text-ink-3">{ROLE_LABEL[member.role]}</span>
          {hasOverrides(member.id) && can(session, "access:write") && <Pill tone="warn">acesso alterado</Pill>}
          {!member.isActive && <Pill tone="warn">inactivo</Pill>}
        </div>

        <h1 className="text-page text-ink">{member.name}</h1>

        <p className="mt-0.5 text-body text-ink-3">
          {member.title} · na academia desde {new Date(member.since).getFullYear()}
          {years > 0 && ` · ${years} ${years === 1 ? "ano" : "anos"}`}
        </p>
      </div>

      {can(session, "staff:write") && (
        <button type="button" onClick={onEdit} className="ctl-ghost shrink-0">
          Editar ficha
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Visão geral                                                                 */
/* -------------------------------------------------------------------------- */

function Overview({ member, history }: { member: StaffMember; history: Stint[] }) {
  const { session } = useSession();
  const current = history.filter((s) => s.current);
  const seasons = seasonsCount(member.id);
  const activity = coachActivity(member.id);
  const showActivity = current.length > 0 && can(session, "attendance:read");

  return (
    <div className="space-y-3">
      {showActivity && (
        <MetricRow>
          <Metric label="Equipas" value={String(current.length)} icon={Users} note="esta época" />
          <Metric label="Atletas" value={String(activity.athletes)} icon={Users} note="sob a sua responsabilidade" />
          <Metric label="Treinos dados" value={String(activity.sessionsDone)} icon={CalendarDays} note="época a decorrer" />
          <Metric
            label="Épocas no clube"
            value={String(seasons)}
            icon={Trophy}
            note={seasons === 1 ? "a primeira" : "incluindo esta"}
          />
        </MetricRow>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel>
          <PanelHead title="Contactos" />
          <div className="space-y-0 px-5 py-1">
            <ContactRow icon={Phone} label="Telemóvel" value={member.phone} href={`tel:${member.phone.replace(/\s/g, "")}`} />
            <ContactRow icon={Mail} label="E-mail" value={member.email} href={`mailto:${member.email}`} />
          </div>
        </Panel>

        <Panel>
          <PanelHead title="Na academia" />
          <div className="space-y-0 px-5 py-1">
            <InfoRow label="Cargo" value={member.title} />
            <InfoRow label="Departamento" value={DEPARTMENT_LABEL[member.department]} />
            <InfoRow label="Acesso" value={ROLE_LABEL[member.role]} />
            <InfoRow label="Desde" value={shortDateFull(member.since)} />
            <InfoRow label="Estado" value={member.isActive ? "Activo" : "Já não trabalha na academia"} />
          </div>
        </Panel>
      </div>

      {current.length > 0 && (
        <Panel>
          <PanelHead title="Equipas esta época" hint={CURRENT_LABEL} />
          <div className="flex flex-wrap gap-2 p-5">
            {current.map((s) => (
              <TeamChip key={s.teamId} stint={s} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

const CURRENT_LABEL = "2026/27";

function ContactRow({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Phone;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <span className="flex items-center gap-2 text-meta text-ink-3">
        <Icon className="size-3.5 text-ink-4" strokeWidth={1.75} />
        {label}
      </span>
      <a href={href} className="truncate text-body font-medium text-ink hover:underline">
        {value}
      </a>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-2.5 last:border-0">
      <span className="text-meta text-ink-3">{label}</span>
      <span className="text-right text-body font-medium text-ink">{value}</span>
    </div>
  );
}

function TeamChip({ stint }: { stint: Stint }) {
  const sport = sportById(stint.sportId);
  const body = (
    <>
      <span className="text-body font-medium text-ink">{stint.teamName}</span>
      {sport && <span className="text-meta text-ink-3">{sport.name}</span>}
    </>
  );

  if (!stint.teamId) {
    return <span className="flex items-center gap-2 rounded-[var(--radius-control)] bg-sunken px-3 py-2">{body}</span>;
  }

  return (
    <Link
      to={`/equipas/${stint.teamId}`}
      className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2 transition-colors duration-[120ms] hover:bg-sunken"
    >
      {body}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Equipas — o histórico                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Por onde a pessoa passou.
 *
 * Agrupado por época e da mais recente para trás, porque é assim que um clube se
 * lembra ("o ano em que apanhei os Sub-11"). As equipas de épocas passadas não são
 * clicáveis: já não existem nesta época, e um link para uma página vazia seria pior
 * do que nenhum.
 */
function Teams({
  history,
  member,
  mayAssign,
  onAssign,
}: {
  history: Stint[];
  member: StaffMember;
  mayAssign: boolean;
  onAssign: () => void;
}) {
  const bySeason = new Map<string, Stint[]>();
  for (const s of history) {
    const list = bySeason.get(s.season) ?? [];
    list.push(s);
    bySeason.set(s.season, list);
  }

  if (history.length === 0) {
    return (
      <Panel>
        <div>
          <Empty
            icon={Users}
            title="Sem equipas"
            detail={
              mayAssign
                ? "Sem equipa atribuída, esta pessoa entra na consola sem ver atleta nenhum."
                : "Esta pessoa nunca esteve atribuída a um escalão."
            }
          >
            {mayAssign && (
              <button type="button" onClick={onAssign} className="ctl-primary">
                Atribuir equipas
              </button>
            )}
          </Empty>
        </div>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHead title="Histórico de equipas" hint={`${bySeason.size} ${bySeason.size === 1 ? "época" : "épocas"}`}>
        {/* O gesto vive aqui, e não no "Editar ficha" onde estava escondido:
            é esta a página onde alguém pensa nas equipas desta pessoa. */}
        {mayAssign && (
          <button type="button" onClick={onAssign} className="ctl-outline">
            <Users className="size-3.5" strokeWidth={1.75} />
            {member.teamIds.length === 0 ? "Atribuir equipas" : "Gerir equipas"}
          </button>
        )}
      </PanelHead>
      <ul>
        {[...bySeason.entries()].map(([season, stints]) => (
          <li key={season} className="flex flex-wrap gap-3 border-b border-line px-5 py-3.5 last:border-b-0">
            <div className="w-20 shrink-0">
              <div className="text-body font-semibold text-ink tabular">{season}</div>
              {stints[0].current && <div className="text-[11px] text-ink-3">a decorrer</div>}
            </div>

            <div className="min-w-0 flex-1 space-y-1.5">
              {stints.map((s, i) => (
                <div key={`${s.teamName}-${i}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  {s.teamId ? (
                    <Link to={`/equipas/${s.teamId}`} className="text-body font-medium text-ink hover:underline">
                      {s.teamName}
                    </Link>
                  ) : (
                    <span className="text-body font-medium text-ink">{s.teamName}</span>
                  )}
                  <span className="text-meta text-ink-3">{s.title}</span>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Atividade                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * O que a pessoa fez, e não o que vale.
 *
 * A distinção é deliberada e vem do produto: métricas de staff são sobre
 * **processo** — treinos registados, avaliações entregues — e nunca sobre
 * desempenho. Um número que se leia como nota de treinador transforma a ficha num
 * instrumento de avaliação de pessoas, e nenhuma academia pediu isso.
 *
 * Os resultados dos jogos estão aqui porque são o contexto do trabalho da equipa —
 * apresentados como balanço, sem ranking nem comparação entre treinadores.
 */
function Activity({ member }: { member: StaffMember }) {
  // Redesenha quando um resultado for registado no calendário.
  useCustomEvents();

  const activity = coachActivity(member.id);
  const matches = coachMatches(member.id);
  const record = matchRecord(member.id);

  const columns: Column<(typeof matches)[number]>[] = [
    {
      key: "date",
      header: "Data",
      render: (m) => <span className="text-ink-2 tabular">{shortDate(m.date)}</span>,
    },
    {
      key: "team",
      header: "Equipa",
      hideBelow: "sm",
      render: (m) =>
        m.teamId ? (
          <Link to={`/equipas/${m.teamId}`} className="text-ink hover:underline">
            {m.teamName}
          </Link>
        ) : (
          <span className="text-ink">{m.teamName}</span>
        ),
    },
    {
      key: "opponent",
      header: "Adversário",
      render: (m) => (
        <div className="min-w-0">
          <div className="truncate text-ink">{m.opponent}</div>
          <div className="text-meta text-ink-4">{m.home ? "em casa" : "fora"}</div>
        </div>
      ),
    },
    {
      key: "result",
      header: "Resultado",
      align: "right",
      render: (m) => (
        <span className="inline-flex items-center gap-2">
          <span className="font-medium text-ink tabular">
            {m.ourScore}–{m.theirScore}
          </span>
          <OutcomeDot outcome={m.outcome} />
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <MetricRow>
        <Metric
          label="Treinos registados"
          value={activity.recordRate === null ? "—" : `${activity.recordRate}%`}
          icon={ClipboardCheck}
          note={
            activity.sessionsPending > 0
              ? `${activity.sessionsPending} por registar`
              : `${activity.sessionsRecorded} de ${activity.sessionsDone}`
          }
        />
        <Metric
          label="Assiduidade"
          value={activity.attendanceRate === null ? "—" : `${activity.attendanceRate}%`}
          icon={Users}
          note="dos atletas das suas equipas"
        />
        <Metric
          label="Avaliações"
          value={String(activity.evaluationsPublished)}
          icon={Gauge}
          note={activity.evaluationsDraft > 0 ? `${activity.evaluationsDraft} por publicar` : "publicadas"}
        />
        {record && (
          <Metric
            label="Jogos"
            value={String(record.played)}
            icon={Trophy}
            note={`${record.wins}V · ${record.draws}E · ${record.losses}D`}
          />
        )}
      </MetricRow>

      {record && (
        <Panel>
          <PanelHead title="Balanço" hint="jogos com resultado registado" />
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 px-5 py-4 sm:grid-cols-4">
            <Balance label="Vitórias" value={record.wins} total={record.played} tone="win" />
            <Balance label="Empates" value={record.draws} total={record.played} tone="draw" />
            <Balance label="Derrotas" value={record.losses} total={record.played} tone="loss" />
            <div>
              <div className="text-[22px] leading-none font-semibold text-ink tabular">
                {record.scored}<span className="text-ink-4">–</span>{record.conceded}
              </div>
              <div className="mt-1 text-meta text-ink-3">marcados e sofridos</div>
            </div>
          </div>
        </Panel>
      )}

      <Panel>
        <PanelHead title="Últimos jogos" hint={matches.length ? `${matches.length} mais recentes` : undefined} />
        {matches.length === 0 ? (
          <div className="px-5 py-12">
            <Empty
              icon={Trophy}
              title="Sem jogos registados"
              detail="Aparecem aqui assim que houver resultados lançados no calendário."
            />
          </div>
        ) : (
          <DataTable columns={columns} rows={matches} keyOf={(m) => m.id} />
        )}
      </Panel>
    </div>
  );
}

function Balance({ label, value, total, tone }: { label: string; value: number; total: number; tone: "win" | "draw" | "loss" }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[22px] leading-none font-semibold text-ink tabular">{value}</span>
        <span className="text-meta text-ink-4 tabular">{pct}%</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <OutcomeDot outcome={tone} />
        <span className="text-meta text-ink-3">{label}</span>
      </div>
    </div>
  );
}

function OutcomeDot({ outcome }: { outcome: "win" | "draw" | "loss" }) {
  const color =
    outcome === "win" ? "bg-[#1f7a45]" : outcome === "loss" ? "bg-[#a82a20]" : "bg-ink-4";
  return <span className={`inline-block size-2 shrink-0 rounded-full ${color}`} aria-hidden="true" />;
}

function shortDateFull(iso: string): string {
  const d = new Date(iso);
  return `${shortDate(d)} ${d.getFullYear()}`;
}
