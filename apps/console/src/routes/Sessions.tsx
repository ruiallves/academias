import { useMemo, useState } from "react";
import { PageHeader } from "@/components/Shell";
import { Bar, DataTable, Empty, Metric, MetricRow, Monogram, Panel, Pill, type Column } from "@/components/primitives";
import { ResultCount, Segmented, Toolbar } from "@/components/filters";
import { AttendanceDialog } from "@/components/AttendanceDialog";
import { CircleCheck, ClipboardCheck } from "@/lib/icons";
import { attendanceRate, coachById, listSessions, teamById, today, unrecordedSessions } from "@/lib/api";
import { useAttendanceRecords } from "@/lib/attendance";
import { dayShort, percent, relativeDays, time } from "@/lib/format";
import { can, isAcademyWide } from "@/lib/permissions";
import type { TrainingSession } from "@/data/types";
import { useSession } from "@/session";

type Range = "semana" | "por-registar" | "proximos";

/**
 * Presenças (diretor) e Treinos (treinador) são o mesmo ecrã.
 *
 * O que muda é a pergunta: o diretor quer saber *se está a ser registado*, o
 * treinador quer *registar*. Por isso a diferença está no título, na ordenação por
 * omissão e na acção da linha — não em dois ecrãs paralelos que divergem com o tempo.
 */
export default function Sessions() {
  const { session } = useSession();
  const oversight = isAcademyWide(session);
  const [range, setRange] = useState<Range>(oversight ? "semana" : "por-registar");
  const [recording, setRecording] = useState<TrainingSession | null>(null);

  // Subscrever o armazém faz a tabela redesenhar-se assim que um registo é
  // guardado — sem isto, a linha continuava a dizer "por registar".
  useAttendanceRecords();

  const from = new Date(today.getTime() - 21 * 86_400_000);
  const to = new Date(today.getTime() + 14 * 86_400_000);
  const all = listSessions(session, from, to);
  const pending = unrecordedSessions(session);
  const rate = attendanceRate(session, 30);

  const rows = useMemo(() => {
    if (range === "por-registar") return [...pending].sort((a, b) => a.start.localeCompare(b.start));
    if (range === "proximos") return all.filter((s) => new Date(s.start) >= today && s.status !== "cancelled");
    const weekAgo = new Date(today.getTime() - 7 * 86_400_000);
    return all.filter((s) => new Date(s.start) >= weekAgo).sort((a, b) => b.start.localeCompare(a.start));
  }, [range, all, pending]);

  const thisWeek = all.filter((s) => {
    const d = new Date(s.start);
    return d >= new Date(today.getTime() - 7 * 86_400_000) && d <= today;
  });

  const columns: Column<TrainingSession>[] = [
    {
      key: "when",
      header: "Treino",
      render: (s) => {
        const d = new Date(s.start);
        return (
          <div className="flex items-center gap-3">
            <div className="w-11 shrink-0 rounded-[6px] border border-line bg-sunken/50 py-1 text-center">
              <div className="text-[10px] font-semibold text-ink-3 uppercase">{dayShort(d)}</div>
              <div className="text-body font-semibold text-ink tabular">{d.getDate()}</div>
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{teamById(s.teamId)?.name}</div>
              <div className="text-meta text-ink-3">
                <span className="font-mono tabular">{time(d)}</span> · {s.venue}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: "coach",
      header: "Treinador",
      hideBelow: "md",
      render: (s) => {
        const c = s.coachId ? coachById(s.coachId) : undefined;
        // Um treino agendado sem treinador é um problema, não um campo vazio.
        if (!c) return <Pill tone="risk">Por atribuir</Pill>;
        return (
          <div className="flex items-center gap-2">
            <Monogram name={c.name} size="sm" />
            <span className="truncate text-ink-2">{c.name.split(" ")[0]}</span>
          </div>
        );
      },
    },
    {
      key: "attendance",
      header: "Presenças",
      hideBelow: "sm",
      width: "220px",
      render: (s) => {
        if (s.status === "cancelled") return <span className="text-meta text-ink-4">—</span>;
        if (!s.attendance) {
          return new Date(s.start) < today ? (
            <span className="text-meta text-ink-4">por registar</span>
          ) : (
            <span className="text-meta text-ink-4">agendado</span>
          );
        }
        // O total vem do plantel, não do registo: guardamos faltas, e os
        // presentes são tudo o resto.
        const total = teamById(s.teamId)?.athleteIds.length ?? 0;
        const missed = s.attendance.absences.filter((x) => x.kind !== "late").length;
        const present = Math.max(0, total - missed);
        const r = total ? present / total : 0;
        return (
          <div className="flex items-center gap-2.5">
            <Bar value={r} tone={r >= 0.85 ? "ok" : r >= 0.7 ? "signal" : "warn"} />
            <span className="w-16 shrink-0 text-right text-meta text-ink-2 tabular">
              {present}/{total}
            </span>
          </div>
        );
      },
    },
    {
      key: "status",
      header: "",
      align: "right",
      width: "140px",
      render: (s) => {
        if (s.status === "cancelled") return <Pill>Cancelado</Pill>;
        if (s.attendance) return <span className="text-meta text-ink-3">{relativeDays(new Date(s.start), today)}</span>;
        if (new Date(s.start) < today && can(session, "attendance:write")) {
          return (
            <button type="button" onClick={() => setRecording(s)} className="ctl-outline">
              <ClipboardCheck className="size-3.5" strokeWidth={1.75} />
              Registar
            </button>
          );
        }
        return <span className="text-meta text-ink-3">{relativeDays(new Date(s.start), today)}</span>;
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={oversight ? "Presenças" : "Treinos"}
        subtitle={
          oversight
            ? "Cada treino sem registo é um buraco no relatório do atleta."
            : "Regista as presenças no fim do treino — os pais vêem no mesmo dia."
        }
      />

      <div className="space-y-3">
        <MetricRow>
          <Metric label="Presença média" value={rate !== null ? percent(rate) : "—"} note="últimos 30 dias" />
          <Metric label="Treinos na semana" value={String(thisWeek.length)} note="realizados" />
          <Metric label="Por registar" value={String(pending.length)} note={pending.length ? "últimos 21 dias" : "tudo registado"} />
          <Metric
            label="Próximos 7 dias"
            value={String(all.filter((s) => {
              const d = new Date(s.start);
              return d >= today && d <= new Date(today.getTime() + 7 * 86_400_000) && s.status !== "cancelled";
            }).length)}
            note="agendados"
          />
        </MetricRow>

        <Panel>
          <Toolbar>
            <Segmented
              value={range}
              onChange={setRange}
              options={[
                { value: "por-registar", label: "Por registar", count: pending.length },
                { value: "semana", label: "Últimos 7 dias" },
                { value: "proximos", label: "Próximos" },
              ]}
            />
            <ResultCount n={rows.length} noun={["treino", "treinos"]} />
          </Toolbar>

          <DataTable
            columns={columns}
            rows={rows}
            keyOf={(s) => s.id}
            empty={
              range === "por-registar" ? (
                <Empty icon={CircleCheck} tone="ok" title="Nada por registar" detail="Todos os treinos das últimas três semanas têm presenças." />
              ) : (
                <Empty title="Sem treinos neste período" />
              )
            }
          />
        </Panel>
      </div>

      {recording && (
        <AttendanceDialog training={recording} session={session} onClose={() => setRecording(null)} />
      )}
    </>
  );
}
