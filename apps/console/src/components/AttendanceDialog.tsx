import { useState } from "react";
import { Dialog } from "./Dialog";
import { AvailabilityTag, cx, Monogram, SelectField } from "./primitives";
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

/**
 * Os quatro estados, na ordem em que um treinador pensa neles: primeiro o normal,
 * depois as excepções por gravidade. "Presente" é o valor por omissão — escolhê-lo
 * apaga a marca, porque a presença é a ausência de falta.
 */
const STATUS_OPTIONS: { value: "present" | AbsenceKind; label: string }[] = [
  { value: "present", label: "Presente" },
  { value: "absent", label: "Faltou" },
  { value: "justified", label: "Justificada" },
  { value: "late", label: "Atrasado" },
];

/** Cor do ponto ao lado do nome — um sinal rápido sem depender de ler o dropdown. */
const DOT_TONE: Record<AbsenceKind, string> = {
  absent: "bg-risk",
  justified: "bg-warn",
  late: "bg-ink-3",
};

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
  // O motivo de cada falta justificada, à parte do estado. Restaurado ao reabrir.
  const [notes, setNotes] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (training.attendance?.absences ?? [])
        .filter((x) => x.kind === "justified" && x.note)
        .map((x) => [x.athleteId, x.note as string]),
    ),
  );

  const setStatus = (athleteId: string, value: "present" | AbsenceKind) => {
    setAbsences((current) => {
      const next = { ...current };
      // "Presente" não é um estado guardado — é a ausência de marca.
      if (value === "present") delete next[athleteId];
      else next[athleteId] = value;
      return next;
    });
    // Deixar de ser justificada apaga o motivo — não fica um motivo órfão preso a
    // uma falta que já não é justificada.
    if (value !== "justified") {
      setNotes((current) => {
        if (!current[athleteId]) return current;
        const next = { ...current };
        delete next[athleteId];
        return next;
      });
    }
  };

  const setNote = (athleteId: string, note: string) =>
    setNotes((current) => ({ ...current, [athleteId]: note }));

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
      Object.entries(absences).map(([athleteId, kind]) => ({
        athleteId,
        kind,
        // O motivo só faz sentido numa falta justificada; nas outras vai vazio.
        ...(kind === "justified" && notes[athleteId]?.trim() ? { note: notes[athleteId].trim() } : {}),
      })),
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
        Escolhe o estado de cada atleta. Por omissão estão todos{" "}
        <strong className="font-medium text-ink">presentes</strong>.
      </p>

      <ul className="p-2">
        {roster.map((a) => {
          const kind = absences[a.id];
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
              <div className="rounded-[var(--radius-control)] px-3 py-1.5">
                <div className="flex w-full items-center gap-2.5">
                  <Monogram name={a.name} size="sm" />

                  {/* Ponto de cor: o estado lê-se de relance, sem abrir o dropdown. */}
                  <span
                    className={cx("size-1.5 shrink-0 rounded-full", kind ? DOT_TONE[kind] : "bg-ok")}
                    aria-hidden
                  />

                  <span
                    className={cx(
                      "min-w-0 flex-1 truncate text-body",
                      kind && kind !== "late" ? "text-ink-3 line-through" : "text-ink",
                    )}
                  >
                    {shortName(a.name)}
                  </span>

                  <SelectField
                    size="sm"
                    className="w-[134px] shrink-0"
                    aria-label={`Estado de ${a.name}`}
                    value={kind ?? "present"}
                    onChange={(v) => setStatus(a.id, v)}
                    options={STATUS_OPTIONS}
                  />
                </div>

                {/* Só a falta justificada pede um motivo — é o que a distingue de uma
                    falta seca. Alinhado com o nome, recuado pelo tamanho do monograma. */}
                {kind === "justified" && (
                  <div className="mt-1.5 pl-[34px]">
                    <input
                      type="text"
                      value={notes[a.id] ?? ""}
                      onChange={(e) => setNote(a.id, e.target.value)}
                      placeholder="Motivo da justificação (ex.: consulta médica)"
                      maxLength={200}
                      className="h-8 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-meta text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);
