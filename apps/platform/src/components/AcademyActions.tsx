import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { apiDelete, apiPatch, ApiError } from "@/lib/http";
import { cx } from "./primitives";
import type { Academy, Me } from "@/lib/types";

/**
 * Fechar ou apagar um clube.
 *
 * ## Duas acções, e uma delas quase nunca se usa
 *
 * **Desactivar** é a normal: põe o clube em `CANCELLED`, e a partir daí nenhum
 * endereço dele responde — nem a consola, nem a página do clube, nem a de
 * sócios. Os dados ficam todos, e reactivar devolve-o onde estava.
 *
 * **Apagar** leva tudo: atletas, presenças, boletins clínicos, mensalidades,
 * famílias. É a operação mais destrutiva do produto, e por isso pede o endereço
 * do clube escrito à mão. Um "tens a certeza?" não é proporcional — quem está a
 * apagar o clube errado responde "sim" com a mesma facilidade. Escrever o
 * endereço obriga a olhar para qual.
 */
export function AcademyActions({
  academy,
  me,
  onDone,
  onClose,
}: {
  academy: Academy;
  me: Me;
  onDone: () => void;
  onClose: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apagar, setApagar] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cancelada = academy.status === "CANCELLED";
  const mayDelete = me.role === "OWNER";

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/academies/${academy.id}/estado`, { active: cancelada });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível mudar o estado.");
      setBusy(false);
    }
  }

  async function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/academies/${academy.id}`, { slug: slug.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível apagar.");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/25 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-[440px] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="text-panel text-ink">{academy.name}</h2>
          <button type="button" onClick={onClose} className="ctl-ghost size-8 justify-center px-0" aria-label="Fechar">
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </header>

        <div className="space-y-4 p-5">
          {/* --- Desactivar / reactivar ---------------------------------- */}
          <div className="rounded-[var(--radius-control)] border border-line p-3.5">
            <p className="text-body font-medium text-ink">{cancelada ? "Reactivar" : "Desactivar"}</p>
            <p className="mt-1 text-meta leading-relaxed text-ink-3">
              {cancelada
                ? "O clube volta a abrir, exactamente onde estava. Ninguém perdeu nada."
                : "Ninguém entra e nenhum endereço do clube responde — nem a consola, nem a app das famílias. Os dados ficam todos, e podes reactivar quando quiseres."}
            </p>
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={busy}
              className={cx("mt-3", cancelada ? "ctl-primary" : "ctl-outline text-[#8a5a12]")}
            >
              {busy ? "…" : cancelada ? "Reactivar clube" : "Desactivar clube"}
            </button>
          </div>

          {/* --- Apagar --------------------------------------------------- */}
          {mayDelete && (
            <div className="rounded-[var(--radius-control)] border border-[#f0c9c2] bg-[#fdf6f5] p-3.5">
              <p className="text-body font-medium text-[#a82a20]">Apagar de vez</p>
              <p className="mt-1 text-meta leading-relaxed text-ink-2">
                Leva tudo: atletas, equipas, presenças, avaliações, boletins clínicos, mensalidades e as contas das
                famílias. Não há como voltar atrás.
              </p>

              {!apagar ? (
                <button type="button" onClick={() => setApagar(true)} className="ctl-ghost mt-3 text-[#a82a20]">
                  Quero apagar este clube
                </button>
              ) : (
                <form onSubmit={remove} className="mt-3 space-y-2">
                  <label className="block">
                    <span className="mb-1.5 block text-meta text-ink-2">
                      Escreve <strong className="font-mono font-medium text-ink">{academy.slug}</strong> para confirmar
                    </span>
                    <input
                      value={slug}
                      onChange={(e) => setSlug(e.target.value)}
                      autoFocus
                      placeholder={academy.slug}
                      className="h-9 w-full rounded-[var(--radius-control)] border border-line bg-surface px-2.5 font-mono text-[13px] text-ink focus:border-line-strong focus:outline-none"
                    />
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={busy || slug.trim().toLowerCase() !== academy.slug.toLowerCase()}
                      className="ctl-primary bg-[#a82a20] hover:bg-[#8f231a] disabled:bg-ink-4"
                    >
                      {busy ? "A apagar…" : "Apagar para sempre"}
                    </button>
                    <button type="button" onClick={() => setApagar(false)} className="ctl-ghost">
                      Cancelar
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-[var(--radius-control)] bg-[#fae9e7] px-3 py-2 text-meta leading-relaxed text-[#a82a20]">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
