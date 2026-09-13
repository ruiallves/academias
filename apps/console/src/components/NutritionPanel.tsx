import { useState, type FormEvent } from "react";
import { Dialog, DialogField, dialogInputClass } from "./Dialog";
import { cx, Empty, Panel, PanelHead, Pill } from "./primitives";
import { Apple, Plus, Send, Trash2 } from "@/lib/icons";
import { apiDelete, apiPatch, apiPost } from "@/lib/http";
import { useApi } from "@/lib/query";
import { longDate } from "@/lib/format";
import { can, type Session } from "@/lib/permissions";
import type { Athlete } from "@/data/types";

/**
 * Planos de nutrição — o painel da ficha, no separador clínico.
 *
 * ## O que é
 *
 * Um texto que vale durante semanas — o que o atleta abre na app antes do
 * jantar — escrito pela nutricionista (`clinical:write`). Não é a consulta:
 * essa é uma entrada do boletim, com data e impacto. Vários planos por atleta,
 * do mais recente para trás; o de Setembro não apaga o de Março.
 *
 * ## Publicar e partilhar são duas decisões
 *
 * Um plano nasce em rascunho e não sai da consola. Publicar entrega-o; a quem,
 * decide-o quem escreve — o atleta, a família, ou os dois — e a app só mostra
 * a intersecção: publicado **e** aberto àquele chapéu. O mesmo desenho dos
 * relatórios.
 */

type NutritionPlan = {
  id: string;
  athleteId: string;
  title: string;
  body: string;
  familyVisible: boolean;
  athleteVisible: boolean;
  status: "DRAFT" | "PUBLISHED";
  authorName: string;
  publishedAt: string | null;
  createdAt: string;
};

export function NutritionPanel({ athlete, session }: { athlete: Athlete; session: Session }) {
  const mayRead = can(session, "clinical:read");
  const mayWrite = can(session, "clinical:write");
  const { data, reload } = useApi<NutritionPlan[]>(mayRead ? `/api/athletes/${athlete.id}/nutricao` : null);
  const [editing, setEditing] = useState<NutritionPlan | "new" | null>(null);

  if (!mayRead) return null;
  const plans = data ?? [];

  return (
    <Panel>
      <PanelHead title="Nutrição" hint={plans.length > 0 ? `${plans.length}` : undefined}>
        {mayWrite && (
          <button type="button" className="ctl-outline" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" strokeWidth={2} />
            Novo plano
          </button>
        )}
      </PanelHead>

      {plans.length === 0 ? (
        <Empty
          icon={Apple}
          title="Sem plano de nutrição"
          detail={
            mayWrite
              ? "Escreve o plano e decide quem o lê na app — o atleta, a família, ou os dois."
              : "Quando o departamento clínico escrever um, aparece aqui."
          }
          compact
        />
      ) : (
        <ul>
          {plans.map((p) => (
            <li key={p.id} className="border-b border-line last:border-0">
              <button
                type="button"
                onClick={() => (mayWrite ? setEditing(p) : undefined)}
                className={cx("flex w-full items-start gap-3 px-5 py-3.5 text-left", mayWrite && "hover:bg-sunken/60")}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-ink-3">
                  <Apple className="size-4" strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium text-ink">{p.title}</span>
                  <span className="block truncate text-meta text-ink-3">
                    {p.authorName} · {longDate(new Date(p.publishedAt ?? p.createdAt))}
                  </span>
                  <span className="mt-1 line-clamp-2 block text-meta leading-relaxed text-ink-2">{p.body}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  {p.status === "DRAFT" ? <Pill tone="neutral">Rascunho</Pill> : <Pill tone="ok">Publicado</Pill>}
                  {p.status === "PUBLISHED" && (
                    <span className="text-[11px] text-ink-3">
                      {[p.athleteVisible && "atleta", p.familyVisible && "família"].filter(Boolean).join(" · ") || "só a academia"}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <NutritionDialog
          athlete={athlete}
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={reload}
        />
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */

function NutritionDialog({
  athlete,
  plan,
  onClose,
  onSaved,
}: {
  athlete: Athlete;
  plan: NutritionPlan | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(plan?.title ?? "");
  const [body, setBody] = useState(plan?.body ?? "");
  const [athleteVisible, setAthleteVisible] = useState(plan?.athleteVisible ?? true);
  const [familyVisible, setFamilyVisible] = useState(plan?.familyVisible ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const published = plan?.status === "PUBLISHED";
  const valid = title.trim().length >= 2 && body.trim().length >= 5;
  const payload = { title: title.trim(), body: body.trim(), athleteVisible, familyVisible };

  async function guardar(): Promise<string> {
    if (plan) {
      await apiPatch(`/api/nutricao/${plan.id}`, payload);
      return plan.id;
    }
    const created = await apiPost<{ id: string }>(`/api/athletes/${athlete.id}/nutricao`, payload);
    return created.id;
  }

  async function correr(fn: () => Promise<void>) {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível gravar.");
    } finally {
      setBusy(false);
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault();
    void correr(async () => {
      await guardar();
    });
  };

  /** Gravar e publicar de uma vez — como nos relatórios. */
  const publicar = () =>
    correr(async () => {
      const id = await guardar();
      await apiPost(`/api/nutricao/${id}/publicar`, {});
    });

  const apagar = () =>
    correr(async () => {
      if (!plan) return;
      if (!confirm("Apagar este plano? Não se desfaz.")) throw new Error("Ficou como estava.");
      await apiDelete(`/api/nutricao/${plan.id}`);
    });

  const quem = [athleteVisible && "o atleta", familyVisible && "a família"].filter(Boolean).join(" e ");

  return (
    <Dialog
      labelledBy="plano-nutricao"
      title={plan ? "Plano de nutrição" : "Novo plano de nutrição"}
      subtitle={athlete.name}
      icon={<Apple className="size-4" strokeWidth={1.75} />}
      onClose={onClose}
      width={600}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <div>
            {plan && (
              <button type="button" onClick={() => void apagar()} className="ctl-ghost text-risk" disabled={busy}>
                <Trash2 className="size-3.5" strokeWidth={1.75} />
                Apagar
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="ctl-ghost" disabled={busy}>
              Cancelar
            </button>
            <button type="submit" form="form-nutricao" className={published ? "ctl-primary" : "ctl-outline"} disabled={!valid || busy}>
              {busy ? "A gravar…" : "Guardar"}
            </button>
            {!published && (
              <button type="button" onClick={() => void publicar()} className="ctl-primary" disabled={!valid || busy}>
                <Send className="size-3.5" strokeWidth={1.75} />
                Publicar
              </button>
            )}
          </div>
        </div>
      }
    >
      <form id="form-nutricao" onSubmit={save} className="space-y-4 p-5">
        <DialogField label="Título">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Plano de Outubro — pré-competição"
            maxLength={160}
            className={dialogInputClass}
            autoFocus
          />
        </DialogField>

        <DialogField label="O plano" hint="parágrafos separados por linhas em branco">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={9}
            placeholder={"Pequeno-almoço: …\n\nAntes do treino: …\n\nDepois do treino: …"}
            className={cx(dialogInputClass, "h-auto resize-y py-2 leading-relaxed")}
          />
        </DialogField>

        <fieldset>
          <legend className="mb-1.5 text-meta font-medium text-ink">Quem o lê na app</legend>
          <div className="grid grid-cols-2 gap-2">
            <Toggle label="O atleta" detail="Na área de atleta, quando tiver conta." on={athleteVisible} onChange={setAthleteVisible} />
            <Toggle label="A família" detail="Na área de família, no ecrã do educando." on={familyVisible} onChange={setFamilyVisible} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
            {quem
              ? `Ao publicar, ${quem} ${athleteVisible && familyVisible ? "recebem" : "recebe"} um aviso.`
              : "Ninguém o vê na app — fica só no registo clínico."}
          </p>
        </fieldset>

        {published && plan?.publishedAt && (
          <p className="text-meta text-ink-3">Publicado a {longDate(new Date(plan.publishedAt))}. Mudar quem lê aplica-se de imediato.</p>
        )}

        {error && <p className="rounded-[var(--radius-control)] bg-risk-soft px-3 py-2 text-meta text-risk">{error}</p>}
      </form>
    </Dialog>
  );
}

function Toggle({ label, detail, on, onChange }: { label: string; detail: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cx(
        "flex flex-col items-start gap-1 rounded-[var(--radius-control)] border px-3 py-2.5 text-left transition-colors duration-[120ms]",
        on ? "border-signal-line bg-signal-soft/40" : "border-line hover:bg-sunken",
      )}
    >
      <span className="text-body font-medium text-ink">{label}</span>
      <span className="text-[11px] leading-snug text-ink-3">{detail}</span>
    </button>
  );
}
