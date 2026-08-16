import { useState } from "react";
import { Dialog } from "./Dialog";
import { AvailabilityTag, cx, Monogram } from "./primitives";
import { listAthletes, teamById } from "@/lib/api";
import { recordAttendance } from "@/lib/attendance";
import { availabilityOf, isUnavailable, useClinicalRecords } from "@/lib/clinical";
import { longDate, shortName, time } from "@/lib/format";
import type { AbsenceKind, TrainingSession } from "@/data/types";
import type { Session } from "@/lib/permissions";

/**
 * Registar presenças — que na prática é **marcar quem faltou**.
 *
 * Todos entram presentes. O treinador toca só nos que faltaram, e isso são dois
 * ou três toques em vez de dezoito. Se ninguém faltou, guarda-se de imediato sem
 * tocar em nada — que é o caso mais frequente e o que os produtos costumam tornar
 * mais trabalhoso.
 *
 * "Atrasado" existe à parte de "faltou" porque não é a mesma coisa para o
 * relatório do atleta: quem chegou tarde esteve lá, e conta como presente na
 * assiduidade (ver `attendanceRate`).
 */

const KINDS: { value: AbsenceKind; label: string; tone: string }[] = [
  { value: "absent", label: "Faltou", tone: "bg-risk-soft text-risk" },
  { value: "justified", label: "Justificada", tone: "bg-warn-soft text-warn" },
  { value: "late", label: "Atrasado", tone: "bg-sunken text-ink-2" },
];

export function AttendanceDialog({
  training,
  session,
  onClose,
}: {
  training: TrainingSession;
  session: Session;
  onClose: () => void;
}) {
  useClinicalRecords();
  const team = teamById(training.teamId);
  const roster = listAthletes(session)
    .filter((a) => a.teamId === training.teamId && a.status === "active")
    .sort((a, b) => a.name.localeCompare(b.name, "pt"));

  // Só quem falta entra neste mapa. A ausência de entrada é a presença.
  const [absences, setAbsences] = useState<Record<string, AbsenceKind>>(() =>
    Object.fromEntries((training.attendance?.absences ?? []).map((x) => [x.athleteId, x.kind])),
  );

  const cycle = (athleteId: string) => {
    setAbsences((current) => {
      const next = { ...current };
      const now = next[athleteId];
      // presente → faltou → justificada → atrasado → presente
      if (!now) next[athleteId] = "absent";
      else if (now === "absent") next[athleteId] = "justified";
      else if (now === "justified") next[athleteId] = "late";
      else delete next[athleteId];
      return next;
    });
  };

  // Quem está de baixa não entra na conta: não faltou ao treino, está impedido de
  // o fazer. Contá-lo como falta puniria o atleta pela lesão no seu próprio
  // relatório de assiduidade.
  const injured = roster.filter((a) => isUnavailable(a.id));
  const eligible = roster.filter((a) => !isUnavailable(a.id));
  const missing = eligible.filter((a) => absences[a.id] && absences[a.id] !== "late").length;
  const present = eligible.length - missing;

  const save = () => {
    recordAttendance(
      training.id,
      Object.entries(absences).map(([athleteId, kind]) => ({ athleteId, kind })),
    );
    onClose();
  };

  return (
    <Dialog
      labelledBy="registar-presencas"
      title="Registar presenças"
      subtitle={`${team?.name} · ${capitalize(longDate(new Date(training.start)))}, ${time(new Date(training.start))}`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <span className="mr-auto text-meta text-ink-3 tabular">
            {present} de {eligible.length} presentes
            {injured.length > 0 && <span className="text-ink-4"> · {injured.length} de baixa</span>}
          </span>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="button" onClick={save} className="ctl-primary">
            Guardar
          </button>
        </>
      }
    >
      <p className="border-b border-line bg-sunken/40 px-5 py-2.5 text-meta text-ink-3">
        Toca num atleta para marcar que <strong className="font-medium text-ink">faltou</strong>. Os
        restantes ficam presentes.
      </p>

      <ul className="p-2">
        {roster.map((a) => {
          const kind = absences[a.id];
          const meta = KINDS.find((k) => k.value === kind);
          const injured = isUnavailable(a.id);

          if (injured) {
            return (
              <li key={a.id}>
                <div className="flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 opacity-70">
                  <Monogram name={a.name} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-body text-ink-3">{shortName(a.name)}</span>
                  <AvailabilityTag availability={availabilityOf(a.id)} size="sm" />
                </div>
              </li>
            );
          }

          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => cycle(a.id)}
                className={cx(
                  "flex w-full items-center gap-2.5 rounded-[var(--radius-control)] px-3 py-2 text-left transition-colors duration-[120ms]",
                  kind ? "bg-sunken/60" : "hover:bg-sunken/50",
                )}
              >
                <Monogram name={a.name} size="sm" />
                <span
                  className={cx(
                    "min-w-0 flex-1 truncate text-body",
                    kind && kind !== "late" ? "text-ink-3 line-through" : "text-ink",
                  )}
                >
                  {shortName(a.name)}
                </span>

                {meta ? (
                  <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", meta.tone)}>
                    {meta.label}
                  </span>
                ) : (
                  <span className="shrink-0 text-[11px] font-medium text-ok">Presente</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
