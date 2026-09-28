import { cloneElement, type FormEvent, isValidElement, type ReactElement, type ReactNode, useEffect, useId, useState } from "react";
import { CalendarPlus, Check, Mail, MessageCircle, Phone, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";
import { googleEventUrl, telHref, whatsappHref } from "@/lib/google";
import { shortDate } from "@/lib/format";
import {
  ASSOCIACOES_FUTEBOL,
  CHANNEL_LABEL,
  CONTACT_STATUS,
  CONTACT_STATUS_LABEL,
  MODALIDADES,
  MODALIDADES_COM_AF,
  type Contact,
  type ContactStatus,
  type Me,
} from "@/lib/types";
import { cx } from "./primitives";

/**
 * A ficha de um clube contactado.
 *
 * Primeiro o que se regista todos os dias: mandámos email, ligámos, o que
 * responderam, quando se volta a falar. Depois o clube (nome, modalidade,
 * associação, contactos gerais) e, se se souber, a pessoa com quem se fala.
 * Nada disto obriga a saber o nome de alguém.
 *
 * Marcar email ou chamada, e mudar a resposta, deixa uma linha no histórico com
 * a data e quem foi: é o que se lê antes de voltar a ligar.
 */
type Props = {
  contact: Contact | null;
  /** A lista toda, para avisar quando o clube já lá está. */
  todos: Contact[];
  /** O filtro de associação aberto na lista: um clube novo nasce nele. */
  grupo: string;
  me: Me;
  onClose: () => void;
  onSaved: () => void;
};

export function ContactDialog({ contact, todos, grupo, me, onClose, onSaved }: Props) {
  const [full, setFull] = useState<Contact | null>(contact);

  // A lista traz o essencial; o histórico só vem quando se abre a ficha.
  useEffect(() => {
    if (!contact) return;
    apiGet<Contact>(`/contactos/${contact.id}`).then(setFull).catch(() => {});
  }, [contact]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 py-10 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[600px] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-panel text-ink">{full ? full.name : "Novo clube"}</h2>
            {full && (
              <p className="truncate text-meta text-ink-3">
                {[full.association ?? "sem associação", full.sport !== "Futebol" ? full.sport : null].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 shrink-0 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        {full && <QuickActions contact={full} />}

        <div className="max-h-[72vh] overflow-y-auto">
          <Ficha
            key={full?.updatedAt ?? "novo"}
            contact={full}
            todos={todos}
            grupo={grupo}
            me={me}
            onSaved={(c) => {
              setFull(c);
              onSaved();
            }}
            onDeleted={onSaved}
            onClose={onClose}
          />
          {full?.touches && full.touches.length > 0 && <History touches={full.touches} />}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Ligar, WhatsApp, agendar. Só aparecem os que fazem sentido com o que se sabe. */
function QuickActions({ contact }: { contact: Contact }) {
  const when = contact.nextActionAt ? new Date(contact.nextActionAt) : defaultFollowUp();

  return (
    <div className="flex flex-wrap gap-1.5 border-b border-line bg-sunken/40 px-5 py-2.5">
      {contact.phone && (
        <>
          <a href={telHref(contact.phone)} className="ctl-outline">
            <Phone className="size-3.5" strokeWidth={1.75} />
            {contact.phone}
          </a>
          <a href={whatsappHref(contact.phone)} target="_blank" rel="noreferrer" className="ctl-ghost">
            <MessageCircle className="size-3.5" strokeWidth={1.75} />
            WhatsApp
          </a>
        </>
      )}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className="ctl-ghost">
          <Mail className="size-3.5" strokeWidth={1.75} />
          {contact.email}
        </a>
      )}
      <a href={googleEventUrl(contact, when)} target="_blank" rel="noreferrer" className="ctl-ghost">
        <CalendarPlus className="size-3.5" strokeWidth={1.75} />
        Agendar no Google
      </a>
    </div>
  );
}

/** Um clube novo nasce na associação do filtro aberto; sem filtro, AF Porto. */
function inicial(grupo: string): { sport: string; association: string } {
  if (grupo.startsWith("a:")) {
    const [sport, assoc] = grupo.slice(2).split("|");
    return { sport, association: assoc === "Sem associação" ? "" : assoc };
  }
  if (grupo.startsWith("s:")) {
    const sport = grupo.slice(2);
    return { sport, association: MODALIDADES_COM_AF.includes(sport) ? "AF Porto" : "" };
  }
  return { sport: "Futebol", association: "AF Porto" };
}

function Ficha({
  contact,
  todos,
  grupo,
  me,
  onSaved,
  onDeleted,
  onClose,
}: {
  contact: Contact | null;
  todos: Contact[];
  grupo: string;
  me: Me;
  onSaved: (c: Contact) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const base = contact ? { sport: contact.sport, association: contact.association ?? "" } : inicial(grupo);

  const [name, setName] = useState(contact?.name ?? "");
  const [sport, setSport] = useState(base.sport);
  const [outraModalidade, setOutraModalidade] = useState(!MODALIDADES.includes(base.sport));
  const [association, setAssociation] = useState(base.association);
  const [emailed, setEmailed] = useState(Boolean(contact?.emailedAt));
  const [called, setCalled] = useState(Boolean(contact?.calledAt));
  const [status, setStatus] = useState<ContactStatus>(contact?.status ?? "NOVO");
  const [replyNote, setReplyNote] = useState(contact?.replyNote ?? "");
  const [next, setNext] = useState(toLocalInput(contact?.nextActionAt ?? null));
  const [nextNote, setNextNote] = useState(contact?.nextActionNote ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [personName, setPersonName] = useState(contact?.personName ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 2 && sport.trim().length > 0;
  const mayDelete = me.role === "OWNER" || me.role === "ADMIN";
  const comAF = MODALIDADES_COM_AF.includes(sport);

  /** O mesmo clube já na lista, pelo nome sem acentos nem maiúsculas. */
  const repetido = name.trim().length >= 3
    ? todos.find((c) => c.id !== contact?.id && chave(c.name) === chave(name))
    : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    const body = {
      name: name.trim(),
      sport: sport.trim(),
      association: association.trim(),
      emailed,
      called,
      status,
      replyNote: replyNote.trim(),
      nextActionAt: next ? new Date(next).toISOString() : null,
      nextActionNote: nextNote.trim(),
      email: email.trim(),
      phone: phone.trim(),
      personName: personName.trim(),
      role: role.trim(),
      notes: notes.trim(),
    };

    try {
      const result = contact
        ? await apiPatch<Contact>(`/contactos/${contact.id}`, body)
        : await apiPost<Contact>("/contactos", body);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      onSaved(result);
      if (!contact) onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!contact) return;
    if (!confirm(`Apagar ${contact.name}? O histórico vai com ele.`)) return;
    try {
      await apiDelete(`/contactos/${contact.id}`);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível apagar.");
    }
  }

  return (
    <form onSubmit={submit}>
      <section className="space-y-3 border-b border-line px-5 py-4">
        <div className="text-meta font-medium text-ink">Contacto</div>
        <div className="grid grid-cols-2 gap-2">
          <Toggle
            ligado={emailed}
            quando={contact?.emailedAt ?? null}
            icon={<Mail className="size-3.5" strokeWidth={1.75} />}
            rotulo="Email enviado"
            onClick={() => setEmailed((v) => !v)}
          />
          <Toggle
            ligado={called}
            quando={contact?.calledAt ?? null}
            icon={<Phone className="size-3.5" strokeWidth={1.75} />}
            rotulo="Ligámos"
            onClick={() => setCalled((v) => !v)}
          />
        </div>

        <Field label="Resposta">
          <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value as ContactStatus)}>
            {CONTACT_STATUS.map((s) => (
              <option key={s} value={s}>
                {CONTACT_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="O que responderam" hint="opcional">
          <textarea
            value={replyNote}
            onChange={(e) => setReplyNote(e.target.value)}
            rows={2}
            placeholder="Ex.: pediram para voltar a falar em janeiro, já usam outra plataforma…"
            className={TEXTAREA}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Voltar a falar" hint="vai ao calendário">
            <input type="datetime-local" className={INPUT} value={next} onChange={(e) => setNext(e.target.value)} />
          </Field>
          <Field label="A fazer" hint="opcional">
            <input className={INPUT} value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="Ligar ao presidente" />
          </Field>
        </div>
      </section>

      <section className="space-y-3 border-b border-line px-5 py-4">
        <div className="text-meta font-medium text-ink">Clube</div>
        <Field label="Nome do clube">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="FC Ferreirense" autoFocus={!contact} />
        </Field>
        {repetido && (
          <p className="rounded-[var(--radius-control)] bg-[#fdf3e1] px-3 py-2 text-meta text-[#8a5a12]">
            Já existe "{repetido.name}" ({repetido.association ?? "sem associação"}).
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Modalidade">
            {outraModalidade ? (
              <input
                className={INPUT}
                value={sport}
                onChange={(e) => setSport(e.target.value)}
                placeholder="Ex.: Padel"
              />
            ) : (
              <select
                className={INPUT}
                value={sport}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__outra") {
                    setOutraModalidade(true);
                    setSport("");
                    setAssociation("");
                    return;
                  }
                  // Mudar entre futebol e outra modalidade troca o tipo de associação.
                  if (MODALIDADES_COM_AF.includes(v) !== MODALIDADES_COM_AF.includes(sport)) {
                    setAssociation(MODALIDADES_COM_AF.includes(v) ? "AF Porto" : "");
                  }
                  setSport(v);
                }}
              >
                {MODALIDADES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
                <option value="__outra">Outra…</option>
              </select>
            )}
          </Field>
          <Field label="Associação">
            {comAF ? (
              <select className={INPUT} value={association} onChange={(e) => setAssociation(e.target.value)}>
                {ASSOCIACOES_FUTEBOL.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
                <option value="">Sem associação</option>
              </select>
            ) : (
              <input
                className={INPUT}
                value={association}
                onChange={(e) => setAssociation(e.target.value)}
                placeholder="Ex.: Associação de Basquetebol do Porto"
              />
            )}
          </Field>
          <Field label="Email do clube" hint="opcional">
            <input type="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="geral@clube.pt" />
          </Field>
          <Field label="Telefone" hint="opcional">
            <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="912 345 678" inputMode="tel" />
          </Field>
        </div>
      </section>

      <section className="space-y-3 px-5 py-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-meta font-medium text-ink">Pessoa de contacto</span>
          <span className="text-[11px] text-ink-4">se se souber</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nome">
            <input className={INPUT} value={personName} onChange={(e) => setPersonName(e.target.value)} />
          </Field>
          <Field label="Cargo">
            <input className={INPUT} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Presidente" />
          </Field>
        </div>
        <Field label="Notas">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Quantos atletas, o que usam hoje, quem decide."
            className={TEXTAREA}
          />
        </Field>

        {contact?.academy && (
          <p className="rounded-[var(--radius-control)] bg-signal-soft/50 px-3 py-2 text-meta text-signal-ink">
            Virou cliente: {contact.academy.name} · {contact.academy.slug}.academias.pt
          </p>
        )}

        {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}

        <div className="flex items-center justify-between gap-2 pt-0.5">
          {contact && mayDelete ? (
            <button type="button" onClick={remove} className="ctl-ghost text-[#a82a20]">
              <Trash2 className="size-3.5" strokeWidth={1.75} />
              Apagar
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            {saved && <span className="text-meta text-ink-3">Guardado</span>}
            {contact && (
              <span className="text-[11px] text-ink-4">
                {contact.owner ? `${contact.owner.name} · ` : ""}desde {shortDate(contact.createdAt)}
              </span>
            )}
            <button type="submit" className="ctl-primary" disabled={!valid || busy}>
              {busy ? "A guardar…" : contact ? "Guardar" : "Criar"}
            </button>
          </div>
        </div>
      </section>
    </form>
  );
}

/** Email enviado / Ligámos: um botão que se liga e desliga, com a data quando já estava. */
function Toggle({
  ligado,
  quando,
  icon,
  rotulo,
  onClick,
}: {
  ligado: boolean;
  quando: string | null;
  icon: ReactNode;
  rotulo: string;
  onClick: () => void;
}) {
  const data = ligado ? (quando ? shortDate(quando) : "hoje") : "ainda não";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ligado}
      className={cx(
        "flex items-center justify-between gap-2 rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors duration-[120ms]",
        ligado ? "border-[#b9dcc5] bg-[#e6f2ea] text-[#1f6b3a]" : "border-line text-ink-3 hover:border-line-strong hover:text-ink",
      )}
    >
      <span className="flex items-center gap-2 text-meta font-medium">
        {ligado ? <Check className="size-3.5" strokeWidth={2.25} /> : icon}
        {rotulo}
      </span>
      <span className="text-[11px] opacity-75">{data}</span>
    </button>
  );
}

/** O histórico, do mais recente para o mais antigo. */
function History({ touches }: { touches: NonNullable<Contact["touches"]> }) {
  return (
    <section className="border-t border-line bg-sunken/30 px-5 py-4">
      <h3 className="mb-2.5 text-meta font-medium text-ink">Histórico</h3>
      <ol className="space-y-2.5">
        {touches.map((t) => (
          <li key={t.id} className="border-l-2 border-line pl-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-meta font-medium text-ink">
                {t.channel === "OUTRO" && t.status ? "Resposta" : CHANNEL_LABEL[t.channel]}
                {t.status && <span className="ml-1.5 font-normal text-ink-3">→ {CONTACT_STATUS_LABEL[t.status]}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-ink-4">
                {new Date(t.happenedAt).toLocaleString("pt-PT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
            {t.note && <p className="mt-0.5 text-meta leading-relaxed text-ink-2">{t.note}</p>}
            {t.byName && <p className="text-[11px] text-ink-4">{t.byName}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* -------------------------------------------------------------------------- */

const INPUT =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none";

const TEXTAREA =
  "w-full resize-y rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  /*
   * A ligação ao campo, quando é um só e não traz `id` seu. É o que mantém o
   * rótulo a focar o campo sem o pôr à volta dele — ver `DialogField`.
   */
  const soUmCampo =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type) &&
    !(children.props as { id?: string }).id;

  return (
    <div className="block">
      <label {...(soUmCampo ? { htmlFor: id } : {})} className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </label>
      {soUmCampo ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}
    </div>
  );
}

/** Para comparar nomes de clubes: sem acentos, sem maiúsculas, sem espaços a mais. */
function chave(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** `<input type="datetime-local">` fala em hora local sem fuso; o servidor fala em ISO. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sem data marcada, o botão do Google propõe amanhã de manhã. */
function defaultFollowUp(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}
