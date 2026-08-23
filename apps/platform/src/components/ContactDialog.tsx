import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { CalendarPlus, MessageCircle, Phone, Trash2, X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";
import { googleEventUrl, telHref, whatsappHref } from "@/lib/google";
import { shortDate } from "@/lib/format";
import {
  CHANNEL_LABEL,
  CONTACT_STATUS,
  CONTACT_STATUS_LABEL,
  type Contact,
  type ContactChannel,
  type ContactStatus,
  type Me,
} from "@/lib/types";
import { cx } from "./primitives";

/**
 * A ficha de um contacto.
 *
 * ## Porque é que registar vem primeiro
 *
 * Porque é o que se está a fazer quando isto abre: acabou-se de desligar o
 * telefone. O que aconteceu, em que pé ficou e quando se volta a falar são a mesma
 * pergunta nesse momento, e por isso são um bloco só, no topo, com o botão à mão.
 *
 * Os dados da pessoa — nome, número, clube — vêm a seguir. Corrigem-se de vez em
 * quando; registam-se conversas todos os dias.
 *
 * ## E porque é que a data do próximo passo está nos dois sítios
 *
 * Porque é o campo que faz a lista funcionar. Um contacto sem data marcada é um
 * contacto que ninguém volta a ver — e a única altura em que se sabe mesmo quando
 * voltar a ligar é logo a seguir a ter ligado.
 */
type Mode = { contact: Contact | null; me: Me; onClose: () => void; onSaved: () => void };

export function ContactDialog({ contact, me, onClose, onSaved }: Mode) {
  const [full, setFull] = useState<Contact | null>(contact);

  // A lista traz o essencial; o histórico das conversas só vem quando se abre a
  // ficha. Carregá-lo em todas as linhas seria pagar por trinta históricos para
  // ler um.
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
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 py-10"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[560px] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-panel text-ink">{full ? full.name : "Novo contacto"}</h2>
            {full && (
              <p className="truncate text-meta text-ink-3">
                {[full.role, full.club].filter(Boolean).join(" · ") || "sem clube"}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 shrink-0 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        {full && <QuickActions contact={full} />}

        <div className="max-h-[70vh] overflow-y-auto">
          {full && <TouchForm contact={full} onDone={(c) => { setFull(c); onSaved(); }} />}
          <Details contact={full} me={me} onSaved={(c) => { setFull(c); onSaved(); }} onDeleted={onSaved} onClose={onClose} />
          {full?.touches && full.touches.length > 0 && <History touches={full.touches} />}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/** Ligar, WhatsApp, agendar. Os três verbos que uma ficha destas serve. */
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
      <a href={googleEventUrl(contact, when)} target="_blank" rel="noreferrer" className="ctl-ghost">
        <CalendarPlus className="size-3.5" strokeWidth={1.75} />
        Agendar no Google
      </a>
    </div>
  );
}

/**
 * Registar o que aconteceu.
 *
 * O estado por omissão é o que o contacto já tem — quem só quer deixar nota de uma
 * chamada não é obrigado a re-escolher onde está. Mudar o estado é uma decisão, e
 * as decisões pedem-se explicitamente.
 */
function TouchForm({ contact, onDone }: { contact: Contact; onDone: (c: Contact) => void }) {
  const [channel, setChannel] = useState<ContactChannel>("CHAMADA");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<ContactStatus>(contact.status);
  const [next, setNext] = useState(toLocalInput(contact.nextActionAt));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const updated = await apiPost<Contact>(`/contactos/${contact.id}/interacoes`, {
        channel,
        note: note.trim() || undefined,
        status,
        nextActionAt: next ? new Date(next).toISOString() : null,
      });
      setNote("");
      onDone(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível registar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 border-b border-line px-5 py-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-meta font-medium text-ink">Registar contacto</span>
        <span className="text-[11px] text-ink-4">
          {contact.touchCount === 0 ? "primeiro contacto" : `${contact.touchCount} até agora`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1">
        {(Object.keys(CHANNEL_LABEL) as ContactChannel[]).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            aria-pressed={channel === c}
            className={cx(
              "rounded-[var(--radius-control)] border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
              channel === c ? "border-signal bg-signal-soft text-signal-ink" : "border-line text-ink-3 hover:text-ink",
            )}
          >
            {CHANNEL_LABEL[c]}
          </button>
        ))}
      </div>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="O que ficou dito. É isto que se lê antes de voltar a ligar."
        className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Ficou em">
          <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value as ContactStatus)}>
            {CONTACT_STATUS.map((s) => (
              <option key={s} value={s}>{CONTACT_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="Voltar a falar" hint="vai ao calendário">
          <input type="datetime-local" className={INPUT} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>

      {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}

      <div className="flex justify-end">
        <button type="submit" className="ctl-primary" disabled={busy}>
          {busy ? "A registar…" : "Registar"}
        </button>
      </div>
    </form>
  );
}

/** Os dados da pessoa. Também é o formulário de criação — os campos são os mesmos. */
function Details({
  contact,
  me,
  onSaved,
  onDeleted,
  onClose,
}: {
  contact: Contact | null;
  me: Me;
  onSaved: (c: Contact) => void;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [club, setClub] = useState(contact?.club ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [status, setStatus] = useState<ContactStatus>(contact?.status ?? "NOVO");
  const [next, setNext] = useState(toLocalInput(contact?.nextActionAt ?? null));
  const [nextNote, setNextNote] = useState(contact?.nextActionNote ?? "");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length >= 2;
  const mayDelete = me.role === "OWNER" || me.role === "ADMIN";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    const body = {
      name: name.trim(),
      phone: phone.trim(),
      club: club.trim(),
      role: role.trim(),
      email: email.trim(),
      status,
      notes: notes.trim(),
      nextActionNote: nextNote.trim(),
      nextActionAt: next ? new Date(next).toISOString() : null,
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
    if (!confirm(`Apagar ${contact.name}? O histórico das conversas vai com ele.`)) return;
    try {
      await apiDelete(`/contactos/${contact.id}`);
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível apagar.");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3.5 px-5 py-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nome">
          <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Helena Sá Pereira" autoFocus={!contact} />
        </Field>
        <Field label="Número">
          <input className={INPUT} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="912 345 678" inputMode="tel" />
        </Field>
        <Field label="Clube">
          <input className={INPUT} value={club} onChange={(e) => setClub(e.target.value)} placeholder="Life Club" />
        </Field>
        <Field label="Cargo" hint="opcional">
          <input className={INPUT} value={role} onChange={(e) => setRole(e.target.value)} placeholder="Diretora" />
        </Field>
        <Field label="Email" hint="opcional">
          <input type="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="direcao@clube.pt" />
        </Field>
        <Field label="Estado">
          <select className={INPUT} value={status} onChange={(e) => setStatus(e.target.value as ContactStatus)}>
            {CONTACT_STATUS.map((s) => (
              <option key={s} value={s}>{CONTACT_STATUS_LABEL[s]}</option>
            ))}
          </select>
        </Field>
        <Field label="Próximo passo" hint="vai ao calendário">
          <input type="datetime-local" className={INPUT} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="A fazer" hint="aparece no evento">
          <input className={INPUT} value={nextNote} onChange={(e) => setNextNote(e.target.value)} placeholder="Ligar a confirmar a demo" />
        </Field>
      </div>

      <Field label="Notas">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Contexto que não cabe numa conversa: quantos atletas, o que usam hoje, quem decide."
          className="w-full resize-y rounded-[var(--radius-control)] border border-line bg-surface px-2.5 py-2 text-body text-ink placeholder:text-ink-4 focus:border-line-strong focus:outline-none"
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
            {busy ? "A guardar…" : contact ? "Guardar" : "Criar contacto"}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * O histórico.
 *
 * Do mais recente para o mais antigo, e sem paginação: um contacto com mais de
 * vinte interações é raro, e quando existir é precisamente o que se quer ler todo.
 */
function History({ touches }: { touches: NonNullable<Contact["touches"]> }) {
  return (
    <section className="border-t border-line bg-sunken/30 px-5 py-4">
      <h3 className="mb-2.5 text-meta font-medium text-ink">Histórico</h3>
      <ol className="space-y-2.5">
        {touches.map((t) => (
          <li key={t.id} className="border-l-2 border-line pl-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-meta font-medium text-ink">
                {CHANNEL_LABEL[t.channel]}
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

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-meta font-medium text-ink">{label}</span>
        {hint && <span className="text-[11px] text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** `<input type="datetime-local">` fala em hora local sem fuso; o servidor fala em ISO. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sem data marcada, o botão do Google propõe amanhã de manhã. É melhor palpite que agora. */
function defaultFollowUp(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}
