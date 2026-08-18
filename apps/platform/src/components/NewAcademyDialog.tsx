import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/http";
import { euros } from "@/lib/format";
import type { Plan } from "@/lib/types";
import { cx } from "./primitives";

/**
 * Criar academia e convidar o diretor.
 *
 * Um formulário só, quatro campos. Um assistente de vários passos para isto seria
 * cerimónia: o que a academia precisa de saber sobre si própria — cor, modalidades,
 * equipas — é o diretor que preenche no onboarding dele, com conhecimento de causa.
 * Nós só precisamos de saber quem é o cliente e a quem mandar o link.
 *
 * O endereço é derivado do nome enquanto ninguém lhe tocar. É o que faz o campo
 * desaparecer para quem não se importa e continuar lá para quem se importa.
 */
type Created = { academy: { id: string; slug: string; name: string }; inviteLink: string; trialEndsAt: string };

export function NewAcademyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [directorName, setDirectorName] = useState("");
  const [directorEmail, setDirectorEmail] = useState("");
  const [planId, setPlanId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  useEffect(() => {
    apiGet<Plan[]>("/plans")
      .then((p) => {
        setPlans(p);
        setPlanId((current) => current || p[0]?.id || "");
      })
      .catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (created ? onCreated() : onClose());
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onCreated, created]);

  const effectiveSlug = slugTouched ? slug : slugify(name);
  const valid = name.trim().length >= 3 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(directorEmail.trim()) && effectiveSlug.length >= 3;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);

    try {
      const result = await apiPost<Created>("/academies", {
        name: name.trim(),
        slug: effectiveSlug,
        directorName: directorName.trim(),
        directorEmail: directorEmail.trim(),
        planId: planId || undefined,
      });
      setCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível criar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && (created ? onCreated() : onClose())}
    >
      <div role="dialog" aria-modal="true" className="max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3.5">
          <h2 className="text-panel text-ink">{created ? "Academia criada" : "Nova academia"}</h2>
          <button type="button" onClick={created ? onCreated : onClose} className="ctl-ghost size-8 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        {created ? <Result created={created} onDone={onCreated} /> : (
          <form onSubmit={submit} className="space-y-4 p-5">
            <Field label="Nome da academia">
              <input className={INPUT} value={name} onChange={(e) => setName(e.target.value)} placeholder="Academia Life Club" autoFocus />
            </Field>

            <Field label="Endereço" hint="onde o clube vive">
              <div className="flex items-center gap-1.5">
                <input
                  className={cx(INPUT, "font-mono text-[13px]")}
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                  placeholder="life-club"
                />
                <span className="shrink-0 font-mono text-meta text-ink-3">.academias.pt</span>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Nome do diretor">
                <input className={INPUT} value={directorName} onChange={(e) => setDirectorName(e.target.value)} placeholder="Helena Sá Pereira" />
              </Field>
              <Field label="E-mail do diretor" hint="recebe o convite">
                <input type="email" className={INPUT} value={directorEmail} onChange={(e) => setDirectorEmail(e.target.value)} placeholder="direcao@clube.pt" />
              </Field>
            </div>

            <div>
              <span className="mb-1.5 block text-meta font-medium text-ink">Plano</span>
              <div className="space-y-1.5">
                {plans.map((p) => (
                  <label
                    key={p.id}
                    className={cx(
                      "flex cursor-pointer items-center gap-3 rounded-[var(--radius-control)] border px-3 py-2.5 transition-colors duration-[120ms]",
                      planId === p.id ? "border-signal bg-signal-soft/40" : "border-line hover:bg-sunken",
                    )}
                  >
                    <input type="radio" name="plano" checked={planId === p.id} onChange={() => setPlanId(p.id)} className="size-3.5 accent-[var(--color-signal)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-medium text-ink">{p.name}</span>
                      <span className="block text-meta text-ink-3">
                        {euros(p.amountCents)}/mês · até {p.includedAthletes} atletas
                        {p.perAthleteCents > 0 && `, depois ${(p.perAthleteCents / 100).toFixed(2).replace(".", ",")} € cada`}
                      </span>
                    </span>
                    <span className="shrink-0 text-meta text-ink-4">{p.trialDays}d grátis</span>
                  </label>
                ))}
              </div>
            </div>

            {error && <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta text-[#a82a20]">{error}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="ctl-ghost">Cancelar</button>
              <button type="submit" className="ctl-primary" disabled={!valid || busy}>
                {busy ? "A criar…" : "Criar e gerar convite"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * O link, uma vez.
 *
 * Na base guarda-se só o hash do token — ninguém, nem nós, o consegue reconstruir.
 * Quem perder o link revoga e emite outro, e é dito aqui para não parecer falha da
 * interface.
 */
function Result({ created, onDone }: { created: Created; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* sem permissão: o link está à vista para copiar à mão */
    }
  }

  return (
    <div className="space-y-4 p-5">
      <p className="text-body leading-relaxed text-ink-2">
        <strong className="font-medium text-ink">{created.academy.name}</strong> está criada em{" "}
        <span className="font-mono text-[13px]">{created.academy.slug}.academias.pt</span>. Envia este link ao diretor —
        ao abri-lo escolhe a palavra-passe e começa a montar a academia.
      </p>

      <div className="rounded-[var(--radius-control)] border border-line bg-sunken p-3">
        <code className="block break-all font-mono text-[12px] leading-relaxed text-ink">{created.inviteLink}</code>
        <button type="button" onClick={copy} className="ctl-outline mt-2.5 w-full justify-center">
          {copied ? <><Check className="size-3.5" strokeWidth={2} /> Copiado</> : <><Copy className="size-3.5" strokeWidth={1.75} /> Copiar link</>}
        </button>
      </div>

      <ul className="space-y-1.5 text-meta leading-relaxed text-ink-3">
        <li>· Válido 7 dias e só pode ser usado uma vez.</li>
        <li>· Avaliação até {new Date(created.trialEndsAt).toLocaleDateString("pt-PT")}.</li>
        <li>· Guarda-o agora: por segurança, o link não volta a ser mostrado.</li>
      </ul>

      <div className="flex justify-end">
        <button type="button" onClick={onDone} className="ctl-primary">Concluído</button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

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

/** Gémeo do `slugify` do servidor. O servidor é que decide; isto é a pré-visualização. */
function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
