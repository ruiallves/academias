import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { CalendarClock, Check, Mail, MessageCircle, PhoneMissed, PhoneOff, Send, ThumbsDown, Users } from "lucide-react";
import { apiPost } from "@/lib/http";
import { whatsappHref } from "@/lib/google";
import { amanhaAsDez, dataCurta, hhmm, OUTCOMES, paraInputLocal } from "@/lib/comercial";
import {
  LOST_REASON_LABEL,
  LOST_REASONS,
  MEETING_MODE_LABEL,
  PLANOS,
  type CallOutcome,
  type Contact,
  type LostReason,
  type MeetingMode,
} from "@/lib/types";
import { cx } from "@/components/primitives";
import { Field, INPUT, Kbd, TEXTAREA } from "./ui";

const ICONE: Record<CallOutcome, typeof PhoneMissed> = {
  NAO_ATENDEU: PhoneMissed,
  LIGAR_MAIS_TARDE: CalendarClock,
  PEDIU_INFO: Send,
  REUNIAO: Users,
  SEM_INTERESSE: ThumbsDown,
  NUMERO_ERRADO: PhoneOff,
};

/**
 * Como correu a chamada.
 *
 * Seis botões grandes, um por resultado, e por baixo só o que esse resultado
 * pede: a data para voltar a ligar, o motivo da recusa, a ficha da reunião. O
 * resto (o estado do clube, a data do próximo seguimento, as tentativas) faz o
 * servidor. Com teclado: 1 a 6 escolhem, Enter regista, Esc volta atrás.
 */
export function RegistarChamada({
  contact,
  atalhos = false,
  onDone,
}: {
  contact: Contact;
  /** Liga os atalhos de teclado (só no cartão da próxima chamada). */
  atalhos?: boolean;
  onDone: (c: Contact, resultado: CallOutcome) => void;
}) {
  const [resultado, setResultado] = useState<CallOutcome | null>(null);
  const [nota, setNota] = useState("");
  const [voltarEm, setVoltarEm] = useState(paraInputLocal(amanhaAsDez()));
  const [motivo, setMotivo] = useState<LostReason | null>(null);
  const [tentarDeNovo, setTentarDeNovo] = useState<"nao" | "3m" | "epoca" | "data">("nao");
  const [dataTentar, setDataTentar] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [r, setR] = useState(() => ({
    scheduledAt: "",
    durationMin: 45,
    mode: "VIDEOCHAMADA" as MeetingMode,
    location: "",
    personName: contact.personName ?? "",
    personRole: contact.role ?? "",
    personPhone: contact.phone ?? "",
    decides: null as boolean | null,
    athletes: "",
    teams: "",
    currentTool: "",
    pain: "",
    suggestedPlan: "",
    notes: "",
  }));
  const formRef = useRef<HTMLFormElement>(null);

  const valido = useMemo(() => {
    if (!resultado) return false;
    if (resultado === "LIGAR_MAIS_TARDE") return Boolean(voltarEm);
    if (resultado === "REUNIAO") return Boolean(r.scheduledAt) && r.personName.trim().length >= 2;
    if (resultado === "SEM_INTERESSE") return Boolean(motivo) && (tentarDeNovo !== "data" || Boolean(dataTentar));
    return true;
  }, [resultado, voltarEm, r.scheduledAt, r.personName, motivo, tentarDeNovo, dataTentar]);

  // Atalhos: 1–6, Enter, Esc. Só fora dos campos de texto.
  useEffect(() => {
    if (!atalhos) return;
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      const aEscrever = ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName) || alvo.isContentEditable;
      if (e.key === "Escape" && resultado) {
        setResultado(null);
        return;
      }
      if (aEscrever || e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= OUTCOMES.length) {
        e.preventDefault();
        setResultado(OUTCOMES[n - 1].id);
      } else if (e.key === "Enter" && resultado && valido) {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [atalhos, resultado, valido]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!resultado || !valido || busy) return;
    setBusy(true);
    setErro(null);
    const body: Record<string, unknown> = { resultado, nota: nota.trim() || null };
    if (resultado === "LIGAR_MAIS_TARDE" || resultado === "PEDIU_INFO") {
      if (resultado === "LIGAR_MAIS_TARDE") body.voltarEm = new Date(voltarEm).toISOString();
    }
    if (resultado === "SEM_INTERESSE") {
      body.motivo = motivo;
      const quando = tentarDeNovo === "3m" ? daquiAMeses(3) : tentarDeNovo === "epoca" ? inicioDaEpoca() : tentarDeNovo === "data" ? new Date(dataTentar) : null;
      body.voltarEm = quando ? quando.toISOString() : null;
    }
    if (resultado === "REUNIAO") {
      body.reuniao = {
        scheduledAt: new Date(r.scheduledAt).toISOString(),
        durationMin: r.durationMin,
        mode: r.mode,
        location: r.location.trim() || null,
        personName: r.personName.trim(),
        personRole: r.personRole.trim() || null,
        personPhone: r.personPhone.trim() || null,
        decides: r.decides,
        athletes: r.athletes ? Number(r.athletes) : null,
        teams: r.teams.trim() || null,
        currentTool: r.currentTool.trim() || null,
        pain: r.pain.trim() || null,
        suggestedPlan: r.suggestedPlan || null,
        notes: r.notes.trim() || null,
      };
    }
    try {
      const c = await apiPost<Contact>(`/comercial/clubes/${contact.id}/chamada`, body);
      onDone(c, resultado);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível registar.");
    } finally {
      setBusy(false);
    }
  }

  const tentativa = contact.noAnswerCount + 1;
  const proximo = (() => {
    if (tentativa >= 4) return "Passa a sem resposta. Volta a aparecer daqui a duas semanas.";
    const d = new Date();
    let n = tentativa;
    while (n > 0) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() !== 0 && d.getDay() !== 6) n--;
    }
    return `Volta à fila ${dataCurta(d)} às ${hhmm(new Date())} (${tentativa + 1}.ª tentativa).`;
  })();

  return (
    <form ref={formRef} onSubmit={submit}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {OUTCOMES.map((o, i) => {
          const Icon = ICONE[o.id];
          const on = resultado === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => setResultado(on ? null : o.id)}
              aria-pressed={on}
              className={cx(
                "group flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-[var(--radius-control)] border px-3 py-2 text-left transition-all duration-150",
                on
                  ? "border-ink bg-ink text-surface"
                  : "border-line bg-surface text-ink hover:border-line-strong hover:bg-canvas active:scale-[0.99]",
              )}
            >
              <Icon className={cx("size-4 shrink-0", on ? "text-surface" : "text-ink-3 group-hover:text-ink-2")} strokeWidth={1.75} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{o.label}</span>
                <span className={cx("block truncate text-[11px]", on ? "text-surface/70" : "text-ink-4")}>{o.hint}</span>
              </span>
              {atalhos && !on && <Kbd>{i + 1}</Kbd>}
            </button>
          );
        })}
      </div>

      {resultado && (
        <div key={resultado} className="com-open mt-4 space-y-4 border-t border-line pt-4">
          {resultado === "NAO_ATENDEU" && <p className="text-meta text-ink-3">{proximo}</p>}

          {resultado === "LIGAR_MAIS_TARDE" && (
            <div className="space-y-2">
              <Field label="Quando voltar a ligar">
                <input type="datetime-local" className={INPUT} value={voltarEm} onChange={(e) => setVoltarEm(e.target.value)} required />
              </Field>
              <div className="flex flex-wrap gap-1.5">
                {atalhosDeHora().map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => setVoltarEm(paraInputLocal(a.quando))}
                    className={cx(
                      "h-8 cursor-pointer rounded-full border px-3 text-meta transition-colors duration-150",
                      voltarEm === paraInputLocal(a.quando) ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                    )}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {resultado === "PEDIU_INFO" && (contact.email || contact.phone) && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-meta text-ink-3">Mandar agora:</span>
              {contact.email && (
                <a href={mailInfo(contact)} className="ctl-outline">
                  <Mail className="size-3.5" strokeWidth={1.75} />
                  Email
                </a>
              )}
              {contact.phone && (
                <a href={`${whatsappHref(contact.phone)}?text=${encodeURIComponent(textoInfo(contact))}`} target="_blank" rel="noreferrer" className="ctl-outline">
                  <MessageCircle className="size-3.5" strokeWidth={1.75} />
                  WhatsApp
                </a>
              )}
            </div>
          )}

          {resultado === "SEM_INTERESSE" && (
            <>
              <Field label="Porquê">
                <div className="flex flex-wrap gap-1.5">
                  {LOST_REASONS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMotivo(m)}
                      aria-pressed={motivo === m}
                      className={cx(
                        "h-9 cursor-pointer rounded-full border px-3.5 text-meta font-medium transition-colors duration-150",
                        motivo === m ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                      )}
                    >
                      {LOST_REASON_LABEL[m]}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Voltar a tentar">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      ["nao", "Não"],
                      ["3m", "Daqui a 3 meses"],
                      ["epoca", "No início da época"],
                      ["data", "Noutra data"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTentarDeNovo(id)}
                      className={cx(
                        "h-9 cursor-pointer rounded-full border px-3.5 text-meta font-medium transition-colors duration-150",
                        tentarDeNovo === id ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                  {tentarDeNovo === "data" && (
                    <input type="date" className={cx(INPUT, "h-9 w-auto")} value={dataTentar} onChange={(e) => setDataTentar(e.target.value)} />
                  )}
                </div>
              </Field>
            </>
          )}

          {resultado === "REUNIAO" && <FichaReuniao r={r} setR={setR} />}

          {resultado === "NUMERO_ERRADO" && (
            <p className="text-meta text-ink-3">Sai da fila. Se souberes o número certo, corrige-o na ficha do clube.</p>
          )}

          <Field label={resultado === "REUNIAO" ? "Notas da chamada" : "O que disseram"} hint="opcional">
            <textarea
              rows={2}
              className={TEXTAREA}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder={resultado === "NAO_ATENDEU" ? "Ex.: tocou até ao fim, sem voicemail" : "Ex.: falar com o coordenador, só à noite"}
            />
          </Field>

          {erro && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{erro}</p>}

          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setResultado(null)} className="ctl-ghost h-10 cursor-pointer px-3">
              Voltar
            </button>
            <button
              type="submit"
              disabled={!valido || busy}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] bg-signal px-4 text-body font-medium text-white transition-colors duration-150 hover:bg-signal-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="size-4" strokeWidth={2} />
              {busy ? "A registar…" : resultado === "REUNIAO" ? "Marcar reunião" : "Registar"}
              {atalhos && <span className="hidden font-mono text-[11px] opacity-60 [@media(hover:hover)]:inline">↵</span>}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

/* -------------------------------------------------------------------------- */

type FichaState = {
  scheduledAt: string;
  durationMin: number;
  mode: MeetingMode;
  location: string;
  personName: string;
  personRole: string;
  personPhone: string;
  decides: boolean | null;
  athletes: string;
  teams: string;
  currentTool: string;
  pain: string;
  suggestedPlan: string;
  notes: string;
};

/** A ficha da reunião: o que o Rui lê antes de entrar. Obrigatório só o quando e o com quem. */
export function FichaReuniao({ r, setR }: { r: FichaState; setR: (f: (x: FichaState) => FichaState) => void }) {
  const set = <K extends keyof FichaState>(k: K, v: FichaState[K]) => setR((x) => ({ ...x, [k]: v }));
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
        <Field label="Dia e hora *">
          <input type="datetime-local" className={INPUT} value={r.scheduledAt} onChange={(e) => set("scheduledAt", e.target.value)} required />
        </Field>
        <Field label="Duração">
          <select className={INPUT} value={r.durationMin} onChange={(e) => set("durationMin", Number(e.target.value))}>
            {[30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Como">
        <div className="flex gap-1.5">
          {(Object.keys(MEETING_MODE_LABEL) as MeetingMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => set("mode", m)}
              className={cx(
                "h-9 flex-1 cursor-pointer rounded-[var(--radius-control)] border text-meta font-medium transition-colors duration-150",
                r.mode === m ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
              )}
            >
              {MEETING_MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </Field>
      {r.mode !== "TELEFONE" && (
        <Field label={r.mode === "PRESENCIAL" ? "Morada" : "Link"} hint="opcional">
          <input
            className={INPUT}
            value={r.location}
            onChange={(e) => set("location", e.target.value)}
            placeholder={r.mode === "PRESENCIAL" ? "Sede do clube, Rua…" : "Fica para mandar depois, se ainda não houver"}
          />
        </Field>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Com quem *">
          <input className={INPUT} value={r.personName} onChange={(e) => set("personName", e.target.value)} placeholder="Nome" />
        </Field>
        <Field label="Cargo">
          <input className={INPUT} value={r.personRole} onChange={(e) => set("personRole", e.target.value)} placeholder="Presidente, coordenador…" />
        </Field>
        <Field label="Telefone dessa pessoa">
          <input className={INPUT} inputMode="tel" value={r.personPhone} onChange={(e) => set("personPhone", e.target.value)} />
        </Field>
        <Field label="Decide sozinho?">
          <div className="flex gap-1.5">
            {(
              [
                [true, "Sim"],
                [false, "Não"],
                [null, "Não sei"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={label}
                type="button"
                onClick={() => set("decides", v)}
                className={cx(
                  "h-10 flex-1 cursor-pointer rounded-[var(--radius-control)] border text-meta font-medium transition-colors duration-150",
                  r.decides === v ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
        <Field label="Atletas">
          <input className={INPUT} inputMode="numeric" value={r.athletes} onChange={(e) => set("athletes", e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="≈ 150" />
        </Field>
        <Field label="Modalidades e escalões">
          <input className={INPUT} value={r.teams} onChange={(e) => set("teams", e.target.value)} placeholder="Futebol, dos petizes aos juniores" />
        </Field>
      </div>

      <Field label="O que usam hoje">
        <input className={INPUT} list="ferramentas-hoje" value={r.currentTool} onChange={(e) => set("currentTool", e.target.value)} placeholder="Excel, papel, outro programa…" />
        <datalist id="ferramentas-hoje">
          {["Excel", "Papel", "WhatsApp e Excel", "EmJogo", "Adjunto", "Nada"].map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Field>

      <Field label="O que mais os incomoda">
        <textarea rows={2} className={TEXTAREA} value={r.pain} onChange={(e) => set("pain", e.target.value)} placeholder="Cobrar as mensalidades, falar com os pais, convocatórias…" />
      </Field>

      <Field label="Plano que parece indicado">
        <div className="flex flex-wrap gap-1.5">
          {[...PLANOS, ""].map((p) => (
            <button
              key={p || "nao-sei"}
              type="button"
              onClick={() => set("suggestedPlan", p)}
              className={cx(
                "h-9 cursor-pointer rounded-full border px-3.5 text-meta font-medium transition-colors duration-150",
                r.suggestedPlan === p ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong",
              )}
            >
              {p || "Não sei"}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Outras notas para a reunião" hint="opcional">
        <textarea rows={2} className={TEXTAREA} value={r.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function atalhosDeHora(): { label: string; quando: Date }[] {
  const daqui2h = new Date();
  daqui2h.setMinutes(0, 0, 0);
  daqui2h.setHours(daqui2h.getHours() + 2);
  const amanha = amanhaAsDez();
  const amanhaTarde = new Date(amanha);
  amanhaTarde.setHours(18, 0, 0, 0);
  const proximaSemana = new Date();
  proximaSemana.setDate(proximaSemana.getDate() + ((8 - proximaSemana.getDay()) % 7 || 7));
  proximaSemana.setHours(10, 0, 0, 0);
  return [
    { label: "Daqui a 2 horas", quando: daqui2h },
    { label: `${dataCurta(amanha)}, 10h`, quando: amanha },
    { label: `${dataCurta(amanhaTarde)}, 18h`, quando: amanhaTarde },
    { label: "Segunda, 10h", quando: proximaSemana },
  ];
}

function daquiAMeses(n: number): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  d.setHours(10, 0, 0, 0);
  return d;
}

/** 1 de julho seguinte, quando os clubes preparam a época. */
function inicioDaEpoca(): Date {
  const d = new Date();
  const ano = d.getMonth() >= 6 ? d.getFullYear() + 1 : d.getFullYear();
  return new Date(ano, 6, 1, 10, 0, 0, 0);
}

function textoInfo(c: Contact): string {
  const quem = c.personName ? `Olá ${c.personName.split(" ")[0]}` : "Olá";
  return `${quem}, obrigado pelo tempo ao telefone. Fica aqui a informação sobre a Academias, a plataforma de gestão para clubes: https://academias.pt. Se fizer sentido, marcamos uma demonstração de 30 minutos.`;
}

function mailInfo(c: Contact): string {
  const assunto = `Academias: informação para o ${c.name}`;
  return `mailto:${c.email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(textoInfo(c))}`;
}
