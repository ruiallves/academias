import { useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { PersonLink } from "@/components/PersonLink";
import { Bar, Empty, Metric, MetricRow, Monogram, Panel, PanelHead, Pill, cx } from "@/components/primitives";
import { AttendanceDialog } from "@/components/AttendanceDialog";
import { CircleCheck, ClipboardCheck, Clock } from "@/lib/icons";
import { attendanceRate, coachById, listSessions, teamById, today, unrecordedSessions } from "@/lib/api";
import { useAttendanceRecords } from "@/lib/attendance";
import { dayShort, percent, relativeDays, time } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import type { TrainingSession } from "@/data/types";
import { useSession } from "@/session";

/**
 * Presenças.
 *
 * ## Porque é que isto deixou de ser uma tabela
 *
 * Era uma tabela com um filtro, e a tabela é a forma errada. Uma tabela serve para
 * **comparar linhas** — qual o mais caro, qual o mais atrasado. Aqui não se compara
 * nada: um treinador abre isto para fazer uma coisa, registar quem faltou, e o
 * botão que fazia isso era o elemento mais pequeno da linha mais larga do ecrã.
 *
 * Agora são três blocos, por ordem de urgência, e a separação é visual em vez de
 * ser um filtro que é preciso descobrir:
 *
 *   1. **Por registar** — o trabalho. Linhas altas, clicáveis inteiras, com o
 *      atraso à vista. É o que fecha primeiro.
 *   2. **Registados** — o histórico, compacto, com a barra de assiduidade. Serve
 *      para conferir, não para agir.
 *   3. **A seguir** — os próximos treinos, leves. Não há nada a fazer com eles
 *      hoje.
 *
 * Quem não tem nada por registar vê o primeiro bloco dizer isso e sair da frente —
 * em vez de uma tabela vazia com um filtro por mudar.
 *
 * ## Um treino sem registo não é um treino sem faltas
 *
 * A distinção atravessa o produto: uma lista de faltas vazia significa "estiveram
 * todos", `attendance` ausente significa "ninguém verificou". A primeira conta para
 * a assiduidade; a segunda aparece aqui como trabalho por fazer.
 */
export default function Sessions() {
  const { session } = useSession();
  const oversight = isAcademyWide(session);
  const [recording, setRecording] = useState<TrainingSession | null>(null);

  // Subscrever o armazém faz a lista redesenhar-se assim que um registo é guardado.
  useAttendanceRecords();

  const from = new Date(today.getTime() - 30 * 86_400_000);
  const to = new Date(today.getTime() + 14 * 86_400_000);
  const all = listSessions(session, from, to);
  const pending = unrecordedSessions(session);
  const rate = attendanceRate(session, 30);
  const mayRecord = can(session, "attendance:write");

  const { registados, proximos } = useMemo(() => {
    const done = all
      .filter((s) => s.attendance && s.status !== "cancelled")
      .sort((a, b) => b.start.localeCompare(a.start));
    const next = all
      .filter((s) => new Date(s.start) >= today && s.status !== "cancelled")
      .sort((a, b) => a.start.localeCompare(b.start));
    return { registados: done, proximos: next };
  }, [all]);

  const semana = all.filter((s) => {
    const d = new Date(s.start);
    return d >= new Date(today.getTime() - 7 * 86_400_000) && d <= today;
  });

  return (
    <>
      <PageHeader
        title="Presenças"
        subtitle={
          oversight
            ? "Cada treino sem registo é um buraco no relatório do atleta."
            : "Regista no fim do treino — os pais vêem no mesmo dia."
        }
      />

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Presença média" value={rate !== null ? percent(rate) : "—"} note="últimos 30 dias" />
          <Metric label="Treinos na semana" value={String(semana.length)} note="realizados" />
          <Metric
            label="Por registar"
            value={String(pending.length)}
            note={pending.length ? "e a envelhecer" : "está tudo em dia"}
          />
          <Metric label="A seguir" value={String(proximos.length)} note="próximos 14 dias" />
        </MetricRow>

        <Pending sessions={pending} mayRecord={mayRecord} onRecord={setRecording} />

        <div className="grid gap-3 xl:grid-cols-2">
          <Recorded sessions={registados} onOpen={mayRecord ? setRecording : undefined} />
          <Upcoming sessions={proximos} />
        </div>
      </div>

      {recording && <AttendanceDialog training={recording} session={session} onClose={() => setRecording(null)} />}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Por registar — o trabalho                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A lista de tarefas.
 *
 * A linha inteira é o alvo de clique, e não um botão de 80px no fim. E o atraso
 * está escrito por extenso — "há 6 dias" — porque é isso que decide por onde
 * começar: um treino de ontem lembra-se, um de há duas semanas já não.
 */
function Pending({
  sessions,
  mayRecord,
  onRecord,
}: {
  sessions: TrainingSession[];
  mayRecord: boolean;
  onRecord: (s: TrainingSession) => void;
}) {
  if (sessions.length === 0) {
    return (
      <Panel className="flex items-center gap-3 px-5 py-3.5">
        <CircleCheck className="size-5 shrink-0 text-ok" strokeWidth={1.75} />
        <div className="min-w-0">
          <div className="text-body font-medium text-ink">Não há treinos por registar</div>
          <div className="text-meta text-ink-3">Tudo o que já aconteceu tem presenças lançadas.</div>
        </div>
      </Panel>
    );
  }

  const ordered = [...sessions].sort((a, b) => a.start.localeCompare(b.start));

  return (
    <Panel>
      <PanelHead title="Por registar" hint={`${sessions.length} ${sessions.length === 1 ? "treino" : "treinos"}`}>
        <Pill tone="warn">a envelhecer</Pill>
      </PanelHead>

      <ul>
        {ordered.map((s) => {
          const d = new Date(s.start);
          const dias = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
          const team = teamById(s.teamId);
          const coachName = s.coachName ?? (s.coachId ? coachById(s.coachId)?.name : undefined);

          const row = (
            <>
              <div className="w-12 shrink-0 rounded-[7px] border border-line bg-surface py-1.5 text-center">
                <div className="text-[10px] font-semibold text-ink-3 uppercase">{dayShort(d)}</div>
                <div className="text-panel font-semibold text-ink tabular">{d.getDate()}</div>
              </div>

              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">{team?.name}</div>
                <div className="truncate text-meta text-ink-3">
                  <span className="font-mono tabular">{time(d)}</span> · {s.venue}
                  {coachName && ` · ${coachName.split(" ")[0]}`}
                </div>
              </div>

              {/* O atraso é o que ordena o trabalho. Vermelho a partir de uma
                  semana: a partir daí o treinador já não se lembra de quem faltou. */}
              <span className={cx("shrink-0 text-meta font-medium", dias >= 7 ? "text-risk" : "text-ink-3")}>
                {dias <= 0 ? "hoje" : dias === 1 ? "ontem" : `há ${dias} dias`}
              </span>

              {mayRecord && (
                <span className="ctl-outline pointer-events-none shrink-0">
                  <ClipboardCheck className="size-3.5" strokeWidth={1.75} />
                  Registar
                </span>
              )}
            </>
          );

          return (
            <li key={s.id}>
              {mayRecord ? (
                <button
                  type="button"
                  onClick={() => onRecord(s)}
                  className="flex w-full items-center gap-3.5 border-b border-line px-5 py-3 text-left transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken"
                >
                  {row}
                </button>
              ) : (
                <div className="flex items-center gap-3.5 border-b border-line px-5 py-3 last:border-b-0">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Registados — o histórico                                                    */
/* -------------------------------------------------------------------------- */

function Recorded({ sessions, onOpen }: { sessions: TrainingSession[]; onOpen?: (s: TrainingSession) => void }) {
  return (
    <Panel>
      <PanelHead title="Registados" hint="últimos 30 dias" />

      {sessions.length === 0 ? (
        <div className="px-5 py-12">
          <Empty icon={ClipboardCheck} title="Ainda sem registos" />
        </div>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto">
          {sessions.map((s) => {
            const d = new Date(s.start);
            const team = teamById(s.teamId);

            // O total vem do plantel, não do registo: guardamos faltas, e os
            // presentes são tudo o resto.
            const total = team?.athleteIds.length ?? 0;
            const faltas = s.attendance?.absences.filter((x) => x.kind !== "late").length ?? 0;
            const presentes = Math.max(0, total - faltas);
            const r = total ? presentes / total : 0;

            const content = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink">{team?.name}</div>
                  <div className="text-meta text-ink-4">
                    {relativeDays(d, today)} · <span className="font-mono tabular">{time(d)}</span>
                  </div>
                </div>

                <div className="flex w-[140px] shrink-0 items-center gap-2.5">
                  <Bar value={r} tone={r >= 0.85 ? "ok" : r >= 0.7 ? "signal" : "warn"} />
                  <span className="w-12 shrink-0 text-right text-meta text-ink-2 tabular">
                    {presentes}/{total}
                  </span>
                </div>
              </>
            );

            return (
              <li key={s.id}>
                {onOpen ? (
                  <button
                    type="button"
                    onClick={() => onOpen(s)}
                    title="Corrigir o registo"
                    className="flex w-full items-center gap-3 border-b border-line px-5 py-2.5 text-left transition-colors duration-[120ms] last:border-b-0 hover:bg-sunken"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-b-0">{content}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* A seguir                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Os próximos treinos.
 *
 * Sem acção nenhuma — não há nada a registar num treino que ainda não aconteceu.
 * Está aqui para responder a "o que vem aí", e por isso é o bloco mais leve dos
 * três. Um treino sem treinador atribuído aparece marcado: é um problema que se
 * resolve antes do dia, não depois.
 */
function Upcoming({ sessions }: { sessions: TrainingSession[] }) {
  return (
    <Panel>
      <PanelHead title="A seguir" hint="próximos 14 dias" />

      {sessions.length === 0 ? (
        <div className="px-5 py-12">
          <Empty icon={Clock} title="Sem treinos agendados" />
        </div>
      ) : (
        <ul className="max-h-[420px] overflow-y-auto">
          {sessions.map((s) => {
            const d = new Date(s.start);
            const team = teamById(s.teamId);
            /*
             * O nome vem com a sessão, e só se recorre à lista de staff para obter
             * o link para a ficha.
             *
             * Um treinador não tem `staff:read` — essa lista chega-lhe vazia. Ao
             * procurar lá primeiro, o produto dizia "sem treinador" nos treinos do
             * próprio treinador que os estava a ver. Um alarme inventado por não se
             * conseguir resolver um nome é pior do que não mostrar nome nenhum.
             */
            const coach = s.coachId ? coachById(s.coachId) : undefined;
            const coachName = s.coachName ?? coach?.name;

            return (
              <li key={s.id} className="flex items-center gap-3 border-b border-line px-5 py-2.5 last:border-b-0">
                <span className="w-16 shrink-0 text-meta text-ink-3">
                  {dayShort(d)} {d.getDate()}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-body text-ink">{team?.name}</div>
                  <div className="truncate text-meta text-ink-4">
                    <span className="font-mono tabular">{time(d)}</span> · {s.venue}
                  </div>
                </div>

                {coachName ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <Monogram name={coachName} size="sm" />
                    <PersonLink id={coach?.id} name={coachName} short className="text-meta text-ink-3" />
                  </span>
                ) : (
                  // Sem treinador atribuído é um problema a sério — resolve-se antes
                  // do dia, não depois.
                  <Pill tone="risk">sem treinador</Pill>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
