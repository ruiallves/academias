import { useState } from "react";
import { CalendarPlus, Pencil } from "lucide-react";
import { apiPatch } from "@/lib/http";
import { diaLegivel, googleReuniaoUrl, hhmm, paraInputLocal, telefoneLegivel } from "@/lib/comercial";
import { MEETING_MODE_LABEL, MEETING_STATUS_LABEL, type Me, type MeetingStatus, type SalesMeeting } from "@/lib/types";
import { cx } from "@/components/primitives";
import { Dialog, Field, Linha, TEXTAREA } from "./ui";
import { FichaReuniao } from "./RegistarChamada";

/**
 * Uma reunião: a ficha para ler antes de entrar e, depois, como correu.
 *
 * Quem faz a reunião (dono, administrador) marca Feita, Faltaram ou Cancelada e
 * decide se conta para a comissão. O comercial remarca, completa a ficha ou
 * cancela as suas.
 */
export function ReuniaoDialog({
  reuniao,
  me,
  onClose,
  onSaved,
}: {
  reuniao: SalesMeeting;
  me: Me;
  onClose: () => void;
  onSaved: (m: SalesMeeting) => void;
}) {
  const gere = me.role === "OWNER" || me.role === "ADMIN";
  const [m, setM] = useState(reuniao);
  const [editar, setEditar] = useState(false);
  const [nota, setNota] = useState(m.outcomeNote ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ficha, setFicha] = useState(() => paraFicha(m));

  const clube = m.contact?.name ?? "Clube";
  const d = new Date(m.scheduledAt);
  const passou = d.getTime() < Date.now();

  async function guardar(body: Record<string, unknown>) {
    setBusy(true);
    setErro(null);
    try {
      const r = await apiPatch<SalesMeeting>(`/comercial/reunioes/${m.id}`, body);
      setM(r);
      setFicha(paraFicha(r));
      onSaved(r);
      return true;
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível guardar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function estado(s: MeetingStatus) {
    if (s === "CANCELADA" && !confirm(`Cancelar a reunião com ${clube}?`)) return;
    await guardar({ status: s, ...(gere ? { outcomeNote: nota.trim() || null } : {}) });
  }

  async function guardarFicha() {
    if (!ficha.scheduledAt || ficha.personName.trim().length < 2) {
      setErro("Falta o dia e a hora ou o nome da pessoa.");
      return;
    }
    const ok = await guardar({
      scheduledAt: new Date(ficha.scheduledAt).toISOString(),
      durationMin: ficha.durationMin,
      mode: ficha.mode,
      location: ficha.location.trim() || null,
      personName: ficha.personName.trim(),
      personRole: ficha.personRole.trim() || null,
      personPhone: ficha.personPhone.trim() || null,
      decides: ficha.decides,
      athletes: ficha.athletes ? Number(ficha.athletes) : null,
      teams: ficha.teams.trim() || null,
      currentTool: ficha.currentTool.trim() || null,
      pain: ficha.pain.trim() || null,
      suggestedPlan: ficha.suggestedPlan || null,
      notes: ficha.notes.trim() || null,
    });
    if (ok) setEditar(false);
  }

  return (
    <Dialog
      title={clube}
      subtitle={
        <>
          {diaLegivel(d)}, {hhmm(d)} · {MEETING_MODE_LABEL[m.mode]} · {m.durationMin} min
          {m.status !== "MARCADA" && <> · {MEETING_STATUS_LABEL[m.status]}</>}
        </>
      }
      onClose={onClose}
      width={620}
    >
      {editar ? (
        <div className="space-y-4 px-5 py-5">
          <FichaReuniao r={ficha} setR={setFicha} />
          {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditar(false)} className="ctl-ghost h-10 cursor-pointer px-3">
              Cancelar
            </button>
            <button type="button" onClick={guardarFicha} disabled={busy} className="ctl-primary h-10 cursor-pointer px-4">
              {busy ? "A guardar…" : "Guardar ficha"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 border-b border-line bg-canvas/50 px-5 py-2.5">
            <a href={googleReuniaoUrl(m, clube)} target="_blank" rel="noreferrer" className="ctl-outline">
              <CalendarPlus className="size-3.5" strokeWidth={1.75} />
              Pôr no Google Calendar
            </a>
            {m.status === "MARCADA" && (
              <button type="button" onClick={() => setEditar(true)} className="ctl-ghost cursor-pointer">
                <Pencil className="size-3.5" strokeWidth={1.75} />
                Remarcar ou editar a ficha
              </button>
            )}
          </div>

          <dl className="px-5 py-2">
            <Linha label="Com quem">
              {m.personName}
              {m.personRole && <span className="text-ink-3">, {m.personRole}</span>}
              {m.decides !== null && <span className="block text-meta text-ink-3">{m.decides ? "Decide sozinho" : "Não decide sozinho"}</span>}
            </Linha>
            {(m.personPhone || m.personEmail) && (
              <Linha label="Contacto">
                {m.personPhone && (
                  <a href={`tel:${m.personPhone.replace(/[^\d+]/g, "")}`} className="font-mono tabular hover:text-signal">
                    {telefoneLegivel(m.personPhone)}
                  </a>
                )}
                {m.personEmail && <span className="block text-meta text-ink-3">{m.personEmail}</span>}
              </Linha>
            )}
            {m.location && <Linha label={m.mode === "PRESENCIAL" ? "Morada" : "Link"}>{m.location}</Linha>}
            {m.athletes !== null && <Linha label="Atletas">{m.athletes}</Linha>}
            {m.teams && <Linha label="Modalidades">{m.teams}</Linha>}
            {m.currentTool && <Linha label="Usam hoje">{m.currentTool}</Linha>}
            {m.pain && <Linha label="O que os incomoda">{m.pain}</Linha>}
            {m.suggestedPlan && <Linha label="Plano indicado">{m.suggestedPlan}</Linha>}
            {m.notes && <Linha label="Notas">{m.notes}</Linha>}
            <Linha label="Marcada por">
              {m.bookedByName ?? "—"}
              <span className="text-ink-3"> · {new Date(m.createdAt).toLocaleDateString("pt-PT", { day: "numeric", month: "short" })}</span>
            </Linha>
          </dl>

          <section className="space-y-3 border-t border-line px-5 py-5">
            <h3 className="text-panel text-ink">{m.status === "MARCADA" ? (passou ? "Como correu?" : "Resultado") : "Resultado"}</h3>

            {gere ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {(["REALIZADA", "FALTARAM", "CANCELADA"] as MeetingStatus[]).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy}
                      onClick={() => estado(m.status === s ? "MARCADA" : s)}
                      aria-pressed={m.status === s}
                      className={cx(
                        "h-11 cursor-pointer rounded-[var(--radius-control)] border text-body font-medium transition-colors duration-150",
                        m.status === s ? "border-ink bg-ink text-surface" : "border-line text-ink hover:border-line-strong hover:bg-canvas",
                      )}
                    >
                      {MEETING_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
                <Field label="Nota" hint="vai para o histórico do clube">
                  <textarea rows={2} className={TEXTAREA} value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Ex.: gostaram, querem proposta para o Connect" />
                </Field>
                {m.status !== "MARCADA" && nota.trim() !== (m.outcomeNote ?? "") && (
                  <button type="button" onClick={() => guardar({ outcomeNote: nota.trim() || null })} className="ctl-outline cursor-pointer">
                    Guardar a nota
                  </button>
                )}
                <label className="flex cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border border-line px-3 py-2.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-[var(--color-signal)]"
                    checked={m.countsForCommission}
                    onChange={(e) => guardar({ countsForCommission: e.target.checked })}
                  />
                  <span className="text-body text-ink">Conta para a comissão de {m.bookedByName ?? "quem marcou"}</span>
                </label>
                <p className="text-[11px] text-ink-4">
                  Para passar o clube a proposta ou a cliente, abre a ficha do clube em Clubes.
                </p>
              </>
            ) : m.status === "MARCADA" ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-meta text-ink-3">O resultado é marcado por quem faz a reunião.</p>
                <button type="button" onClick={() => estado("CANCELADA")} disabled={busy} className="ctl-ghost cursor-pointer text-risk">
                  O clube cancelou
                </button>
              </div>
            ) : (
              <p className="text-body text-ink">
                {MEETING_STATUS_LABEL[m.status]}
                {m.outcomeNote && <span className="block text-meta text-ink-3">{m.outcomeNote}</span>}
                <span className="block text-meta text-ink-3">{m.countsForCommission ? "Conta para a comissão." : "Não conta para a comissão."}</span>
              </p>
            )}
            {m.status === "CANCELADA" && !gere && m.bookedById === me.id && (
              <button type="button" onClick={() => estado("MARCADA")} disabled={busy} className="ctl-outline cursor-pointer">
                Voltar a marcar
              </button>
            )}
            {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}
          </section>
        </>
      )}
    </Dialog>
  );
}

function paraFicha(m: SalesMeeting) {
  return {
    scheduledAt: paraInputLocal(m.scheduledAt),
    durationMin: m.durationMin,
    mode: m.mode,
    location: m.location ?? "",
    personName: m.personName,
    personRole: m.personRole ?? "",
    personPhone: m.personPhone ?? "",
    decides: m.decides,
    athletes: m.athletes !== null ? String(m.athletes) : "",
    teams: m.teams ?? "",
    currentTool: m.currentTool ?? "",
    pain: m.pain ?? "",
    suggestedPlan: m.suggestedPlan ?? "",
    notes: m.notes ?? "",
  };
}
