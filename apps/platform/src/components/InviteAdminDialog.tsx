import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, X } from "lucide-react";
import { apiPost } from "@/lib/http";
import { ADMIN_ROLE_LABEL, type PlatformRole } from "@/lib/types";
import { cx } from "./primitives";

/**
 * Convidar um administrador — gémeo do `NewAcademyDialog`.
 *
 * Um formulário só: nome, email, papel. Não há campo de password — quem convida
 * decide quem entra e com que papel; quem resgata só prova que é a pessoa,
 * escolhendo a própria password no link. Ver o cabeçalho de
 * `admin-invites.service.ts` no servidor para o porquê.
 */
type Created = { link: string; expiresAt: string };

const ROLES: PlatformRole[] = ["ADMIN", "SUPPORT", "OWNER"];

export function InviteAdminDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PlatformRole>("ADMIN");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (created ? onCreated() : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onCreated, created]);

  const valid = name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      const result = await apiPost<Created>("/admins/convite", { name: name.trim(), email: email.trim(), role });
      setCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível convidar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && (created ? onCreated() : onClose())}
    >
      <div role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-[440px] overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <h2 className="text-panel text-ink">{created ? "Convite criado" : "Convidar administrador"}</h2>
          <button type="button" onClick={created ? onCreated : onClose} className="ctl-ghost size-8 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        {created ? (
          <Result created={created} onDone={onCreated} />
        ) : (
          <form onSubmit={submit} className="space-y-4 p-5">
            <Field label="Nome">
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Helena Sá Pereira" autoFocus />
            </Field>

            <Field label="Email" hint="recebe o convite">
              <input type="email" className={INPUT} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="helena@academias.pt" />
            </Field>

            <div>
              <span className="mb-1.5 block text-meta font-medium text-ink">Papel</span>
              <div className="space-y-1.5">
                {ROLES.map((r) => (
                  <label
                    key={r}
                    className={cx(
                      "flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 transition-colors duration-[120ms]",
                      role === r ? "border-signal bg-signal-soft/40" : "border-line hover:bg-sunken",
                    )}
                  >
                    <input type="radio" name="papel" checked={role === r} onChange={() => setRole(r)} className="size-3.5 accent-[var(--color-signal)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-medium text-ink">{ADMIN_ROLE_LABEL[r]}</span>
                      <span className="block text-meta text-ink-3">{ROLE_HINT[r]}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="ctl-ghost">Cancelar</button>
              <button type="submit" className="ctl-primary" disabled={!valid || busy}>
                {busy ? "A convidar…" : "Criar convite"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const ROLE_HINT: Record<PlatformRole, string> = {
  OWNER: "Tudo, incluindo gerir administradores e planos",
  ADMIN: "Academias, subscrições, convites, analítica",
  SUPPORT: "Leitura e apoio ao cliente — não mexe em faturação",
};

/** O link, uma vez — a base guarda só o hash do token. */
function Result({ created, onDone }: { created: Created; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão: o link está à vista para copiar à mão */
    }
  }

  return (
    <div className="space-y-4 p-5">
      <p className="text-body leading-relaxed text-ink-2">
        Envia este link à pessoa. Ao abri-lo, escolhe a própria password e entra já como administrador.
      </p>

      <div className="rounded-[var(--radius-control)] border border-line bg-sunken p-3">
        <code className="block break-all font-mono text-[12px] leading-relaxed text-ink">{created.link}</code>
        <button type="button" onClick={copy} className="ctl-outline mt-2.5 w-full justify-center">
          {copied ? <><Check className="size-3.5" strokeWidth={2} /> Copiado</> : <><Copy className="size-3.5" strokeWidth={1.75} /> Copiar link</>}
        </button>
      </div>

      <ul className="space-y-1.5 text-meta leading-relaxed text-ink-3">
        <li>· Válido 7 dias e só pode ser usado uma vez.</li>
        <li>· Expira em {new Date(created.expiresAt).toLocaleDateString("pt-PT")}.</li>
        <li>· Guarda-o agora: por segurança, o link não volta a ser mostrado.</li>
      </ul>

      <div className="flex justify-end">
        <button type="button" onClick={onDone} className="ctl-primary">Concluído</button>
      </div>
    </div>
  );
}

const INPUT =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
