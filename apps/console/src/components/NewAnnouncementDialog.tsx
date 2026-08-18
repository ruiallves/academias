import { useState, type FormEvent } from "react";
import { apiPatch, apiPost } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import type { Session } from "@/lib/permissions";
import type { Announcement } from "@/data/types";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx } from "./primitives";

/**
 * Novo aviso.
 *
 * ## Quem escolhe o público
 *
 * A direção decide para quem vai: **Geral**, **Pais** ou **Treinadores**. O
 * treinador não escolhe — fala só com os pais das suas equipas, e por isso o
 * selector nem lhe aparece. A condição é a mesma do servidor (`teamScopeFilter`):
 * quem não tem `scope.teamIds` vê a academia toda; quem tem, vê só o seu âmbito.
 * A interface não é a fronteira — o servidor recusa qualquer público a mais —, mas
 * também não oferece o que depois vai ser negado.
 */

type Audience = "all" | "guardians" | "coaches";

const AUDIENCE_META: { value: Audience; label: string; hint: string }[] = [
  { value: "all", label: "Geral", hint: "toda a academia" },
  { value: "guardians", label: "Pais", hint: "encarregados de educação" },
  { value: "coaches", label: "Treinadores", hint: "equipa técnica" },
];

export function NewAnnouncementDialog({
  session,
  editing,
  onClose,
}: {
  session: Session;
  /** Presente = a editar um aviso já publicado; ausente = a escrever um novo. */
  editing?: Announcement;
  onClose: () => void;
}) {
  const isEditing = editing !== undefined;

  // Sem âmbito de equipa = vê a academia toda e escolhe o público. Com âmbito
  // (treinador) = só os pais das suas equipas, sem escolha. Ao editar, o público
  // não muda — quem recebeu, recebeu —, por isso o selector nem aparece.
  const mayChooseAudience = !isEditing && session.scope?.teamIds === undefined;

  const [audience, setAudience] = useState<Audience>(mayChooseAudience ? "all" : "guardians");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = title.trim().length >= 2 && body.trim().length >= 1;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isEditing) {
        await apiPatch(`/api/announcements/${editing.id}`, { title: title.trim(), body: body.trim() });
      } else {
        await apiPost("/api/announcements", { title: title.trim(), body: body.trim(), audience });
      }
      await reloadAcademy();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível guardar o aviso.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      labelledBy="novo-aviso"
      title={isEditing ? "Editar aviso" : "Novo aviso"}
      subtitle={
        isEditing
          ? "Corrige a mensagem — muda na app de quem a recebeu. A notificação já enviada ao telemóvel não se altera."
          : "As famílias são avisadas na app, sem grupos de WhatsApp."
      }
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" onClick={onClose} className="ctl-ghost">
            Cancelar
          </button>
          <button type="submit" form="form-novo-aviso" className="ctl-primary" disabled={!valid || busy}>
            {busy ? "A guardar…" : isEditing ? "Guardar alterações" : "Publicar e avisar"}
          </button>
        </>
      }
    >
      <form id="form-novo-aviso" onSubmit={submit} className="space-y-4 p-5">
        <DialogField label="Para quem">
          {isEditing ? (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-3 py-2.5 text-meta text-ink-3">
              Foi enviado para <strong className="font-medium text-ink">{editing.audience}</strong> — o público
              não muda ao editar.
            </p>
          ) : mayChooseAudience ? (
            <div className="grid grid-cols-3 gap-1.5">
              {AUDIENCE_META.map((a) => (
                <button
                  key={a.value}
                  type="button"
                  onClick={() => setAudience(a.value)}
                  aria-pressed={audience === a.value}
                  className={cx(
                    "flex flex-col items-start rounded-[var(--radius-control)] border px-3 py-2 text-left transition-colors duration-[120ms]",
                    audience === a.value
                      ? "border-signal bg-signal-soft"
                      : "border-line hover:border-line-strong hover:bg-sunken",
                  )}
                >
                  <span className={cx("text-body font-medium", audience === a.value ? "text-signal-ink" : "text-ink")}>
                    {a.label}
                  </span>
                  <span className="text-[11px] text-ink-3">{a.hint}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-[var(--radius-control)] border border-dashed border-line bg-sunken/50 px-3 py-2.5 text-meta text-ink-3">
              Vai para os <strong className="font-medium text-ink">pais dos teus atletas</strong> — os
              encarregados das tuas equipas.
            </p>
          )}
        </DialogField>

        <DialogField label="Título">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ex.: Treino de sábado muda de hora"
            maxLength={120}
            className={dialogInputClass}
            required
            autoFocus
          />
        </DialogField>

        <DialogField label="Mensagem">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreve o aviso. As famílias recebem-no na app."
            maxLength={2000}
            rows={5}
            className={cx(dialogInputClass, "resize-none py-2 leading-relaxed")}
            required
          />
        </DialogField>

        {error && (
          <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>
        )}
      </form>
    </Dialog>
  );
}
