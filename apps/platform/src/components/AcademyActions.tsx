import { useEffect, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { apiDelete, apiGet, apiPatch, ApiError } from "@/lib/http";
import { cx } from "./primitives";
import { euros } from "@/lib/format";
import type { Academy, Me, Plan } from "@/lib/types";

/** Os estados de uma subscrição, ditos como quem os lê. */
const ESTADOS: { value: SubStatus; label: string; nota: string }[] = [
  { value: "TRIALING", label: "Em avaliação", nota: "não conta para o MRR" },
  { value: "ACTIVE", label: "A pagar", nota: "entra no MRR" },
  { value: "PAST_DUE", label: "Em atraso", nota: "aparece nos alertas" },
  { value: "CANCELLED", label: "Cancelada", nota: "conta como churn deste mês" },
];

type SubStatus = "TRIALING" | "ACTIVE" | "PAST_DUE" | "CANCELLED";

/**
 * Mudar o plano de um clube, fechá-lo ou apagá-lo.
 *
 * ## O plano vem primeiro
 *
 * É a única das três que se faz mais do que uma vez por clube — quando a
 * avaliação acaba e o clube começa a pagar, quando sobe de escalão a meio do
 * ano, quando falha um pagamento. As outras duas são de fim de vida.
 *
 * Escolher o plano **não** era possível depois de criar a academia: decidia-se
 * no formulário de criação e ficava assim para sempre. Um clube criado sem plano
 * nem sequer tinha linha de subscrição para actualizar.
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

  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState(academy.planId ?? "");
  const [subStatus, setSubStatus] = useState<SubStatus>((academy.subscriptionStatus as SubStatus) ?? "TRIALING");
  const [planoGravado, setPlanoGravado] = useState(false);

  useEffect(() => {
    apiGet<Plan[]>("/plans")
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cancelada = academy.status === "CANCELLED";
  const mayDelete = me.role === "OWNER";

  /*
   * O plano e o estado gravam juntos — é uma decisão só.
   *
   * O MRR conta subscrições `ACTIVE` e mais nada: escolher o plano e deixar a
   * subscrição em avaliação era mexer num número que não aparece em lado nenhum.
   */
  async function gravarPlano() {
    if (!planId) return;
    setBusy(true);
    setError(null);
    setPlanoGravado(false);
    try {
      await apiPatch(`/academies/${academy.id}/plano`, { planId, status: subStatus });
      setPlanoGravado(true);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Não foi possível gravar o plano.");
    } finally {
      setBusy(false);
    }
  }

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
          {/* --- Plano e subscrição --------------------------------------- */}
          <div className="rounded-[var(--radius-control)] border border-line p-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-body font-medium text-ink">Plano</p>
              <p className="text-meta text-ink-3">
                {academy.plan ? `Actual: ${academy.plan}` : "Sem plano atribuído"}
              </p>
            </div>

            {plans.length === 0 ? (
              <p className="mt-2 text-meta text-ink-3">A carregar os planos…</p>
            ) : (
              <>
                <div className="mt-2.5 space-y-1.5">
                  {plans.map((p) => (
                    <label
                      key={p.id}
                      className={cx(
                        "flex cursor-pointer items-baseline gap-2.5 rounded-[var(--radius-control)] border px-2.5 py-2 transition-colors duration-[120ms]",
                        planId === p.id ? "border-signal bg-signal-soft/40" : "border-line hover:bg-sunken",
                      )}
                    >
                      <input
                        type="radio"
                        name="plano-academia"
                        checked={planId === p.id}
                        onChange={() => setPlanId(p.id)}
                        className="size-3.5 shrink-0 accent-[var(--color-signal)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-body text-ink">{p.name}</span>
                      <span className="shrink-0 text-meta font-medium text-ink tabular">{euros(p.amountCents)}</span>
                      <span className="shrink-0 text-[11px] text-ink-4">/mês</span>
                    </label>
                  ))}
                </div>

                {/*
                  O plano deste clube já não está à venda.

                  `GET /plans` só devolve os activos — é o que se quer no
                  formulário de criação. Aqui, um clube que ficou num preço antigo
                  não aparecia em lado nenhum e o ecrã parecia dizer que não tinha
                  plano. Diz-se o que se passa: continua no que tem, e só sai de
                  lá se alguém escolher outro de propósito.
                */}
                {academy.planId && !plans.some((p) => p.id === academy.planId) && (
                  <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                    Este clube está num plano que já não se vende
                    {academy.plan ? ` (${academy.plan})` : ""} — mantém-no enquanto não escolheres outro acima.
                  </p>
                )}

                <div className="mt-3">
                  <span className="mb-1.5 block text-meta font-medium text-ink">Estado da subscrição</span>
                  <div className="flex flex-wrap gap-1.5">
                    {ESTADOS.map((e) => (
                      <button
                        key={e.value}
                        type="button"
                        aria-pressed={subStatus === e.value}
                        onClick={() => setSubStatus(e.value)}
                        title={e.nota}
                        className={cx(
                          "rounded-full border px-2.5 py-1 text-meta font-medium transition-colors duration-[120ms]",
                          subStatus === e.value
                            ? "border-signal bg-signal-soft text-signal-ink"
                            : "border-line text-ink-2 hover:border-line-strong hover:bg-sunken",
                        )}
                      >
                        {e.label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-4">
                    {ESTADOS.find((e) => e.value === subStatus)?.nota}
                  </p>
                </div>

                <div className="mt-3 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void gravarPlano()}
                    disabled={busy || !planId || (planId === academy.planId && subStatus === academy.subscriptionStatus)}
                    className="ctl-primary"
                  >
                    {busy ? "A gravar…" : "Guardar plano"}
                  </button>
                  {planoGravado && <span className="text-meta text-[#1f7a45]">Gravado.</span>}
                </div>
              </>
            )}
          </div>

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
