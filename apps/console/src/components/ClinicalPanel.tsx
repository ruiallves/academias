import { useState } from "react";
import { AvailabilityTag, cx, Empty, Metric, MetricRow, Panel, PanelHead, Pill } from "./primitives";
import { ClinicalEntryDialog } from "./ClinicalEntryDialog";
import { CalendarDays, Check, HeartPulse, Lock, Plus } from "@/lib/icons";
import { today } from "@/lib/api";
import {
  activeRestriction,
  availabilityOf,
  clearClinicalEntry,
  clinicalOf,
  KIND_LABEL,
  upcomingAppointments,
  useClinicalRecords,
} from "@/lib/clinical";
import { relativeDays, shortDate } from "@/lib/format";
import { can, type Session } from "@/lib/permissions";
import type { Athlete, ClinicalEntry } from "@/data/types";

/**
 * O boletim clínico de um atleta.
 *
 * Duas leituras muito diferentes consoante quem abre:
 *
 * - Com `clinical:read` (departamento clínico) — o boletim todo, com diagnóstico,
 *   notas e as acções de dar baixa e alta.
 * - Só com `clinical:status` (treinador, direção, família) — o estado e a data
 *   prevista de retoma, e mais nada. Dados de saúde são categoria especial no
 *   RGPD; o produto não deve tornar o diagnóstico o caminho fácil.
 *
 * Isto não é um detalhe de UI: é a razão de existirem duas permissões em vez de
 * uma. Ver `lib/permissions.ts`.
 */
export function ClinicalPanel({ athlete, session }: { athlete: Athlete; session: Session }) {
  useClinicalRecords();
  const [composing, setComposing] = useState<"done" | "scheduled" | null>(null);

  const all = clinicalOf(athlete.id);
  const appointments = upcomingAppointments(athlete.id);
  // O boletim é o historial; os agendamentos vivem à parte, em cima, porque são
  // trabalho por fazer e não registo do que passou.
  const entries = all.filter((e) => !appointments.some((a) => a.id === e.id));
  const restriction = activeRestriction(athlete.id);
  const availability = availabilityOf(athlete.id);
  const mayRead = can(session, "clinical:read");
  const mayWrite = can(session, "clinical:write");

  const medicalDate = new Date(athlete.medicalValidUntil);
  const expired = medicalDate < today;
  const soon = !expired && medicalDate.getTime() < today.getTime() + 30 * 86_400_000;

  return (
    <div className="space-y-3">
      {restriction && (
        <div
          className={cx(
            "flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border px-4 py-3",
            availability === "out" ? "border-risk/25 bg-risk-soft" : "border-warn/25 bg-warn-soft",
          )}
        >
          <AvailabilityTag availability={availability} />
          <span className={cx("min-w-0 flex-1 text-body", availability === "out" ? "text-risk" : "text-warn")}>
            {/* O título do diagnóstico só aparece a quem pode lê-lo. */}
            {mayRead ? restriction.title : "Restrição clínica em vigor"}
            {restriction.expectedReturn && ` · retoma prevista a ${shortDate(new Date(restriction.expectedReturn))}`}
          </span>
          {mayWrite && (
            <button
              type="button"
              onClick={() => clearClinicalEntry(athlete.id, restriction.id)}
              className="ctl-outline shrink-0"
            >
              <Check className="size-3.5" strokeWidth={2} />
              Dar alta
            </button>
          )}
        </div>
      )}

      <MetricRow>
        <Metric
          label="Exame médico"
          value={expired ? "Expirado" : soon ? "A expirar" : "Válido"}
          icon={HeartPulse}
          note={`até ${shortDate(medicalDate)} de ${medicalDate.getFullYear()}`}
        />
        <Metric label="Estado" value={availability === "out" ? "De baixa" : availability === "limited" ? "Condicionado" : "Apto"} note={restriction ? "restrição activa" : "sem limitações"} />
        <Metric label="Ocorrências" value={String(entries.filter((e) => e.kind === "injury").length)} note="lesões no historial" />
        <Metric label="Dias de paragem" value={String(entries.reduce((n, e) => n + (e.outDays ?? 0), 0))} note="acumulados" />
      </MetricRow>

      {mayRead && (
        <Panel>
          <PanelHead title="Agendado" hint={appointments.length ? `${appointments.length}` : undefined}>
            {mayWrite && (
              <button type="button" onClick={() => setComposing("scheduled")} className="ctl-outline">
                <CalendarDays className="size-3.5" strokeWidth={1.75} />
                Agendar
              </button>
            )}
          </PanelHead>

          {appointments.length === 0 ? (
            <div className="px-5 py-8">
              <Empty title="Nada agendado" detail="Exames, consultas e reavaliações aparecem aqui — e na app da família." />
            </div>
          ) : (
            <ul>
              {appointments.map((a) => (
                <li key={a.id} className="flex items-center gap-3 border-b border-line px-5 py-3 last:border-0">
                  <span className="flex size-9 shrink-0 flex-col items-center justify-center rounded-[8px] bg-sunken">
                    <span className="text-[9px] font-semibold text-ink-3 uppercase">
                      {new Date(a.date).toLocaleDateString("pt-PT", { month: "short" }).replace(".", "")}
                    </span>
                    <span className="text-meta font-semibold text-ink tabular">{new Date(a.date).getDate()}</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium text-ink">{a.title}</div>
                    <div className="truncate text-meta text-ink-3">
                      {a.time && <span className="font-mono tabular">{a.time}</span>}
                      {a.location && ` · ${a.location}`}
                    </div>
                  </div>
                  <Pill tone="signal">{KIND_LABEL[a.kind]}</Pill>
                  <span className="shrink-0 text-meta text-ink-3">{relativeDays(new Date(a.date), today)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      <Panel>
        <PanelHead title="Boletim clínico" hint={mayRead ? `${entries.length} registos` : "acesso restrito"}>
          {mayWrite && (
            <button type="button" onClick={() => setComposing("done")} className="ctl-primary">
              <Plus className="size-3.5" strokeWidth={2} />
              Novo registo
            </button>
          )}
        </PanelHead>

        {!mayRead ? (
          <div className="px-5 py-14">
            <Empty
              icon={Lock}
              title="Boletim restrito ao departamento clínico"
              detail="Vês o estado de disponibilidade e a data prevista de retoma. O diagnóstico e as notas de consulta são dados de saúde."
            />
          </div>
        ) : entries.length === 0 ? (
          <div className="px-5 py-14">
            <Empty icon={HeartPulse} title="Sem registos clínicos" />
          </div>
        ) : (
          <ul>
            {entries.map((e) => (
              <ClinicalRow
                key={e.id}
                entry={e}
                mayWrite={mayWrite}
                onClear={() => clearClinicalEntry(athlete.id, e.id)}
              />
            ))}
          </ul>
        )}
      </Panel>

      {composing && (
        <ClinicalEntryDialog
          athlete={athlete}
          session={session}
          defaultMode={composing}
          onClose={() => setComposing(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ClinicalRow({
  entry,
  mayWrite,
  onClear,
}: {
  entry: ClinicalEntry;
  mayWrite: boolean;
  onClear: () => void;
}) {
  const open = entry.impact !== "none" && !entry.clearedOn;

  return (
    <li className="flex items-start gap-3 border-b border-line px-5 py-3.5 last:border-0">
      <span
        className={cx(
          "mt-0.5 h-8 w-[3px] shrink-0 rounded-full",
          open && entry.impact === "out" ? "bg-risk" : open ? "bg-warn" : entry.kind === "exam" ? "bg-ok" : "bg-ink-4",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-ink">{entry.title}</span>
          <Pill tone={entry.kind === "injury" ? "risk" : entry.kind === "exam" ? "ok" : "neutral"}>
            {KIND_LABEL[entry.kind]}
          </Pill>
          {open && <Pill tone={entry.impact === "out" ? "risk" : "warn"}>{entry.impact === "out" ? "De baixa" : "Condicionado"}</Pill>}
          {entry.clearedOn && <Pill tone="ok">Alta a {shortDate(new Date(entry.clearedOn))}</Pill>}
        </div>
        {entry.detail && <p className="text-meta text-ink-3">{entry.detail}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="text-right">
          <div className="text-meta text-ink-2 tabular">{shortDate(new Date(entry.date))}</div>
          {entry.outDays !== undefined && <div className="text-[11px] text-ink-4">{entry.outDays} dias</div>}
        </div>
        {open && mayWrite && (
          <button type="button" onClick={onClear} className="ctl-outline h-7 text-meta">
            Dar alta
          </button>
        )}
      </div>
    </li>
  );
}
