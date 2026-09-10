import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { LegalMarkdown } from "@academia/ui/legal-markdown";
import { apiGet } from "@/lib/http";
import {
  AUDIENCE_LABEL,
  KIND_LABEL,
  SCOPE_LABEL,
  createDocument,
  updateDocument,
  type LegalAcceptanceKind,
  type LegalAudience,
  type LegalDocumentFull,
  type LegalScope,
  type LegalTypeGroup,
} from "@/lib/legal";
import { cx } from "./primitives";

/**
 * Uma versão de um documento legal — a escrever, ou a ler.
 *
 * ## Uma versão nova nasce da anterior
 *
 * Ninguém escreve Termos de Serviço do zero para corrigir dois parágrafos. Ao
 * criar a versão seguinte, o texto e os metadados vêm da versão em vigor; a
 * versão sugere-se a partir dela ("1.0" → "1.1"). O que muda escreve-se na nota
 * de alteração, que é o que o gate vai mostrar como "o que é novo".
 *
 * ## Publicada é imutável
 *
 * O servidor recusa editar o que está publicado — o hash do texto está nas
 * aceitações. Aqui, uma versão publicada abre-se só para ler.
 */
type Props = {
  group: LegalTypeGroup;
  /** Editar/ler esta versão; sem id, cria-se uma nova a partir de `from`. */
  id: string | null;
  /** O texto de partida de uma versão nova (a versão em vigor, se houver). */
  from: string | null;
  suggestedVersion: string;
  canWrite: boolean;
  onClose: () => void;
  onSaved: () => void;
};

const INPUT =
  "h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 text-body text-ink focus:border-line-strong focus:outline-none";

export function LegalDocumentDialog({ group, id, from, suggestedVersion, canWrite, onClose, onSaved }: Props) {
  const [loaded, setLoaded] = useState<LegalDocumentFull | null>(null);
  const [version, setVersion] = useState(suggestedVersion);
  const [title, setTitle] = useState(group.label);
  const [summary, setSummary] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [effectiveAt, setEffectiveAt] = useState("");
  const [scope, setScope] = useState<LegalScope>(group.defaults.scope);
  const [audiences, setAudiences] = useState<LegalAudience[]>(group.defaults.audiences);
  const [kind, setKind] = useState<LegalAcceptanceKind>(group.defaults.acceptanceKind);
  const [content, setContent] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readOnly = loaded !== null && loaded.status !== "DRAFT";
  const editable = canWrite && !readOnly;

  useEffect(() => {
    const source = id ?? from;
    if (!source) return;
    apiGet<LegalDocumentFull>(`/legal/documents/${source}`)
      .then((d) => {
        if (id) {
          setLoaded(d);
          setVersion(d.version);
          setEffectiveAt(toLocalInput(d.effectiveAt));
        }
        setTitle(d.title);
        setSummary(d.summary ?? "");
        setChangeNote(id ? (d.changeNote ?? "") : "");
        setScope(d.scope);
        setAudiences(d.audiences);
        setKind(d.acceptanceKind);
        setContent(d.content);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Não foi possível abrir."));
  }, [id, from]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editable || busy) return;
    setBusy(true);
    setError(null);
    const input = {
      version: version.trim(),
      title: title.trim(),
      summary: summary.trim() || null,
      content,
      scope,
      audiences,
      acceptanceKind: kind,
      effectiveAt: effectiveAt ? new Date(effectiveAt).toISOString() : null,
      changeNote: changeNote.trim() || null,
    };
    try {
      if (id) await updateDocument(id, input);
      else await createDocument({ type: group.type, ...input });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  };

  const toggleAudience = (a: LegalAudience) =>
    setAudiences((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]));

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 py-8 max-md:items-end max-md:p-0"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[880px] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-panel text-ink">
              {id ? `${group.label} · v${loaded?.version ?? ""}` : `Nova versão · ${group.label}`}
            </h2>
            <p className="truncate text-meta text-ink-3">
              {readOnly ? "Publicada — só de leitura. Para mudar o texto, cria uma versão nova." : group.hint}
            </p>
          </div>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 shrink-0 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="space-y-4">
            <Field label="Versão" hint="1.0, 1.1, 2.0">
              <input className={INPUT} value={version} onChange={(e) => setVersion(e.target.value)} disabled={!editable} />
            </Field>
            <Field label="Título">
              <input className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} />
            </Field>
            <Field label="Resumo" hint="uma frase, para o gate e o índice">
              <textarea
                className={cx(INPUT, "h-20 resize-none py-2")}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                disabled={!editable}
              />
            </Field>
            <Field label="O que mudou" hint="mostrado a quem já tinha aceite a anterior">
              <textarea
                className={cx(INPUT, "h-20 resize-none py-2")}
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                disabled={!editable}
              />
            </Field>
            <Field label="Em vigor desde" hint="vazio = ao publicar">
              <input
                type="datetime-local"
                className={INPUT}
                value={effectiveAt}
                onChange={(e) => setEffectiveAt(e.target.value)}
                disabled={!editable}
              />
            </Field>
            <Field label="Âmbito">
              <select className={INPUT} value={scope} onChange={(e) => setScope(e.target.value as LegalScope)} disabled={!editable}>
                {(Object.keys(SCOPE_LABEL) as LegalScope[]).map((s) => (
                  <option key={s} value={s}>
                    {SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Gesto pedido">
              <select
                className={INPUT}
                value={kind}
                onChange={(e) => setKind(e.target.value as LegalAcceptanceKind)}
                disabled={!editable}
              >
                {(Object.keys(KIND_LABEL) as LegalAcceptanceKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Quem tem de aceitar" hint="vazio = ninguém é obrigado">
              <div className="space-y-1.5 pt-1">
                {(Object.keys(AUDIENCE_LABEL) as LegalAudience[]).map((a) => (
                  <label key={a} className="flex items-center gap-2 text-body text-ink-2">
                    <input
                      type="checkbox"
                      checked={audiences.includes(a)}
                      onChange={() => toggleAudience(a)}
                      disabled={!editable}
                      className="size-4 accent-[var(--color-signal)]"
                    />
                    {AUDIENCE_LABEL[a]}
                  </label>
                ))}
              </div>
            </Field>
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-meta font-medium text-ink-2">Texto (Markdown)</span>
              <div className="flex gap-1">
                <button type="button" className={cx("ctl-ghost", !preview && "bg-sunken text-ink")} onClick={() => setPreview(false)}>
                  Escrever
                </button>
                <button type="button" className={cx("ctl-ghost", preview && "bg-sunken text-ink")} onClick={() => setPreview(true)}>
                  Pré-visualizar
                </button>
              </div>
            </div>
            {preview ? (
              <div className="max-h-[60vh] overflow-y-auto rounded-[var(--radius-control)] border border-line px-5 py-4">
                <LegalMarkdown content={content} className="legal-prose" />
              </div>
            ) : (
              <textarea
                className="h-[60vh] w-full resize-none rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2.5 font-mono text-[12.5px] leading-[1.55] text-ink focus:border-line-strong focus:outline-none"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={!editable}
                spellCheck={false}
              />
            )}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
          <p className="text-meta text-risk">{error}</p>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="ctl-outline">
              {editable ? "Cancelar" : "Fechar"}
            </button>
            {editable && (
              <button type="submit" className="ctl-primary" disabled={busy || !version.trim() || !title.trim()}>
                {id ? "Gravar rascunho" : "Criar rascunho"}
              </button>
            )}
          </div>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-meta font-medium text-ink-2">{label}</span>
        {hint && <span className="text-meta text-ink-4">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
