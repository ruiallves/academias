import { Link } from "react-router-dom";
import { PageHeader } from "@/components/Shell";
import { Attention } from "@/components/Attention";
import {
  AvailabilityTag,
  Empty,
  Metric,
  MetricRow,
  Monogram,
  Panel,
  PanelHead,
  PanelLink,
  Pill,
} from "@/components/primitives";
import { Apple, Brain, CircleCheck, HeartPulse, Stethoscope } from "@/lib/icons";
import { medicalState } from "@/lib/medical";
import { listAthletes, teamById, today } from "@/lib/api";
import { activeRestriction, availabilityOf, clinicalOf, KIND_LABEL, useClinicalRecords } from "@/lib/clinical";
import { greeting, relativeDays, shortDate, shortName } from "@/lib/format";
import { useSession } from "@/session";
import type { AttentionItem, ClinicalEntry } from "@/data/types";

/**
 * A visão geral do departamento clínico.
 *
 * A pergunta dele não é "como vai a academia?" — é "quem está parado, quem volta
 * esta semana, e quem tem o exame por renovar?". Por isso esta página não repete
 * as métricas do diretor: as únicas contagens que aqui aparecem são as que geram
 * trabalho clínico.
 */
export default function MedicalOverview() {
  const { session } = useSession();
  useClinicalRecords();

  const athletes = listAthletes(session);
  const out = athletes.filter((a) => availabilityOf(a.id) === "out");
  const limited = athletes.filter((a) => availabilityOf(a.id) === "limited");

  /*
   * "Sem exame" conta como expirado para o departamento clínico.
   *
   * Não é a mesma coisa, mas exige o mesmo trabalho — e a lista existe para
   * mostrar o trabalho. Antes, um atleta sem exame nenhum não aparecia em lado
   * nenhum destes ecrãs: `new Date("")` não é menor do que hoje, por isso
   * escapava ao filtro e ficava invisível para quem tem de o mandar fazer.
   */
  const expiredExams = athletes.filter((a) => ["expired", "missing"].includes(medicalState(a)));
  const expiringExams = athletes.filter((a) => medicalState(a) === "soon");

  // Quem retoma nos próximos sete dias — é o que o departamento tem de reavaliar.
  const returning = [...out, ...limited]
    .map((a) => ({ athlete: a, entry: activeRestriction(a.id) }))
    .filter((x) => {
      if (!x.entry?.expectedReturn) return false;
      const d = new Date(x.entry.expectedReturn).getTime();
      return d >= today.getTime() && d <= today.getTime() + 7 * 86_400_000;
    })
    .sort((a, b) => (a.entry!.expectedReturn! < b.entry!.expectedReturn! ? -1 : 1));

  const items: AttentionItem[] = [];
  if (expiredExams.length > 0) {
    items.push({
      id: "exams-expired",
      severity: "risk",
      title: `${expiredExams.length} exames médicos expirados`,
      detail: "Sem exame válido o atleta não pode competir",
      to: "/clinico?filtro=exames",
      action: "Ver",
    });
  }
  if (returning.length > 0) {
    items.push({
      id: "returning",
      severity: "warn",
      title: `${returning.length} ${returning.length === 1 ? "reavaliação" : "reavaliações"} esta semana`,
      detail: "Atletas com retoma prevista nos próximos 7 dias",
      to: "/clinico?filtro=baixa",
      action: "Rever",
    });
  }
  if (expiringExams.length > 0) {
    items.push({
      id: "exams-soon",
      severity: "info",
      title: `${expiringExams.length} exames a expirar`,
      detail: "Nos próximos 30 dias",
      to: "/clinico?filtro=exames",
      action: "Ver",
    });
  }

  const firstName = session.name.split(" ")[0];

  return (
    <>
      <PageHeader
        eyebrow="Departamento clínico"
        title={`${greeting(today)}, ${firstName}`}
        subtitle={`${athletes.length} atletas acompanhados em toda a academia`}
      />

      <div className="space-y-3">
        <Attention items={items} />

        <MetricRow>
          <Metric label="De baixa" value={String(out.length)} icon={HeartPulse} note="não treinam nem jogam" />
          <Metric label="Condicionados" value={String(limited.length)} note="treinam, não competem" />
          <Metric label="Exames expirados" value={String(expiredExams.length)} note={`${expiringExams.length} a expirar`} />
          <Metric
            label="Aptos"
            value={String(athletes.length - out.length - limited.length)}
            icon={CircleCheck}
            note="sem limitações"
          />
        </MetricRow>

        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <Panel className="flex flex-col">
            <PanelHead title="Atletas parados" hint={`${out.length + limited.length}`} />
            {out.length + limited.length === 0 ? (
              <div className="flex-1 px-5 py-12">
                <Empty icon={CircleCheck} tone="ok" title="Plantel completo" detail="Nenhum atleta com restrição clínica activa." />
              </div>
            ) : (
              <ul className="flex-1">
                {[...out, ...limited].slice(0, 8).map((a) => {
                  const entry = activeRestriction(a.id);
                  return (
                    <li key={a.id} className="flex items-center gap-2.5 border-b border-line px-5 py-3 last:border-0">
                      <Monogram name={a.name} photoUrl={a.photoUrl} size="sm" />
                      <Link to={`/atletas/${a.id}`} className="min-w-0 flex-1">
                        <span className="block truncate text-body font-medium text-ink hover:underline">
                          {shortName(a.name)}
                        </span>
                        <span className="block truncate text-meta text-ink-3">
                          {teamById(a.teamId)?.name} · {entry?.title}
                        </span>
                      </Link>
                      {entry?.expectedReturn && (
                        <span className="shrink-0 text-meta text-ink-3">
                          {relativeDays(new Date(entry.expectedReturn), today)}
                        </span>
                      )}
                      <AvailabilityTag availability={availabilityOf(a.id)} size="sm" />
                    </li>
                  );
                })}
              </ul>
            )}
            <PanelLink to="/clinico">Ver boletins</PanelLink>
          </Panel>

          <Panel className="flex flex-col">
            <PanelHead title="Acompanhamento" hint="últimos registos" />
            <RecentFollowUps />
            <PanelLink to="/clinico/consultas">Ver consultas</PanelLink>
          </Panel>
        </div>
      </div>
    </>
  );
}

/**
 * Nutrição e psicologia — o trabalho contínuo que não afasta ninguém e por isso
 * não aparece em nenhuma outra lista do produto.
 */
function RecentFollowUps() {
  const { session } = useSession();
  const athletes = listAthletes(session);

  const recent: { athleteId: string; entry: ClinicalEntry }[] = [];
  for (const a of athletes) {
    for (const e of clinicalOf(a.id)) {
      if (e.kind === "nutrition" || e.kind === "psychology" || e.kind === "physio") {
        recent.push({ athleteId: a.id, entry: e });
      }
    }
  }
  recent.sort((a, b) => b.entry.date.localeCompare(a.entry.date));

  if (recent.length === 0) {
    return (
      <div className="flex-1 px-5 py-12">
        <Empty icon={Stethoscope} title="Sem consultas registadas" />
      </div>
    );
  }

  const icon = { nutrition: Apple, psychology: Brain, physio: Stethoscope } as const;

  return (
    <ul className="flex-1">
      {recent.slice(0, 6).map(({ athleteId, entry }) => {
        const Icon = icon[entry.kind as keyof typeof icon] ?? Stethoscope;
        return (
          <li key={entry.id} className="flex items-center gap-2.5 border-b border-line px-5 py-3 last:border-0">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
              <Icon className="size-3.5" strokeWidth={1.75} />
            </span>
            <Link to={`/atletas/${athleteId}`} className="min-w-0 flex-1">
              <span className="block truncate text-body text-ink hover:underline">{entry.title}</span>
              <span className="block truncate text-meta text-ink-3">
                {shortName(listAthletes(session).find((a) => a.id === athleteId)?.name ?? "—")}
              </span>
            </Link>
            <Pill>{KIND_LABEL[entry.kind]}</Pill>
            <span className="shrink-0 text-meta text-ink-4 tabular">{shortDate(new Date(entry.date))}</span>
          </li>
        );
      })}
    </ul>
  );
}
