import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, ChevronRight, X } from "@/lib/icons";
import { dismissOnboarding, useOnboarding } from "@/lib/onboarding";
import { useStore } from "@/lib/store";
import { useSession } from "@/session";
import { cx } from "./primitives";

/**
 * Os primeiros passos, num painel ao canto.
 *
 * ## Porquê ao canto e não a ocupar o ecrã
 *
 * Um assistente que toma conta do ecrã obriga a decidir entre segui-lo ou fechá-lo,
 * e quem chega a uma ferramenta de gestão quer olhar para ela primeiro. Ao canto,
 * fica à mão sem interromper: dá para explorar a consola com a lista à vista e ir
 * riscando à medida que as coisas se fazem.
 *
 * ## O certo verde não é decoração
 *
 * É a única forma de alguém perceber que já não tem de fazer aquilo. Como cada
 * passo é derivado dos dados (ver `lib/onboarding.ts`), o certo aparece sozinho no
 * instante em que a equipa é criada — mesmo que tenha sido criada pelo caminho
 * normal e não por aqui.
 */
export function Onboarding() {
  const { session } = useSession();
  const store = useStore();
  const state = useOnboarding(session);
  const [open, setOpen] = useState(true);

  if (!state.visible) return null;

  const { steps, done, total, complete, academySlug } = state;
  const next = steps.find((s) => !s.done);

  return (
    <aside
      className="fixed right-4 bottom-4 z-40 w-[320px] overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface shadow-[var(--shadow-pop)] max-md:inset-x-3 max-md:bottom-[calc(72px+env(safe-area-inset-bottom))] max-md:w-auto"
      aria-label="Primeiros passos"
    >
      <header className="flex items-start gap-2.5 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-panel text-ink">
            {complete ? "Está tudo pronto" : `Bem-vindo à ${store.academy.shortName}`}
          </h2>
          <p className="mt-0.5 text-meta text-ink-3">
            {complete
              ? "A academia está montada. Podes fechar isto."
              : `${total} passos para pôr a academia a funcionar.`}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ctl-ghost size-7 shrink-0 justify-center px-0"
          aria-label={open ? "Recolher" : "Expandir"}
          aria-expanded={open}
        >
          <ChevronDown className={cx("size-4 transition-transform duration-[120ms]", open ? "" : "-rotate-90")} strokeWidth={1.75} />
        </button>

        <button
          type="button"
          onClick={() => dismissOnboarding(academySlug)}
          className="ctl-ghost size-7 shrink-0 justify-center px-0"
          aria-label="Fechar"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      </header>

      <div className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${total ? (done / total) * 100 : 0}%`, background: "var(--color-signal)" }}
          />
        </div>
        <span className="shrink-0 text-meta text-ink-3 tabular">
          {done}/{total}
        </span>
      </div>

      {open && (
        <ul className="max-h-[320px] overflow-y-auto">
          {steps.map((step) => (
            <li key={step.id}>
              <Link
                to={step.to}
                className={cx(
                  "flex items-start gap-2.5 border-b border-line px-4 py-2.5 transition-colors duration-[120ms] last:border-b-0",
                  step.done ? "hover:bg-sunken/50" : "hover:bg-sunken",
                )}
              >
                <Mark done={step.done} />

                <span className="min-w-0 flex-1">
                  <span className={cx("block text-body", step.done ? "text-ink-3 line-through" : "font-medium text-ink")}>
                    {step.label}
                  </span>
                  {/* A explicação só interessa a quem ainda tem o passo por dar. */}
                  {!step.done && <span className="mt-0.5 block text-meta leading-relaxed text-ink-3">{step.hint}</span>}
                </span>

                {!step.done && <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-ink-4" strokeWidth={1.75} />}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* Recolhido, o painel continua a dizer o que falta — senão era só uma barra. */}
      {!open && next && (
        <div className="px-4 py-2.5 text-meta text-ink-3">
          A seguir: <span className="font-medium text-ink-2">{next.label}</span>
        </div>
      )}

      {complete && open && (
        <div className="border-t border-line px-4 py-3">
          <button type="button" onClick={() => dismissOnboarding(academySlug)} className="ctl-primary w-full justify-center">
            Concluído
          </button>
        </div>
      )}
    </aside>
  );
}

/**
 * O certo verde, ou o número do passo.
 *
 * Um círculo vazio para o que falta seria mais bonito e diria menos: o número
 * ordena, e quem olha percebe onde está sem contar linhas.
 */
function Mark({ done }: { done: boolean }) {
  if (done) {
    return (
      <span
        className="mt-px flex size-4 shrink-0 items-center justify-center rounded-full bg-[#e6f2e9] text-[#1f7a45]"
        aria-label="Feito"
      >
        <Check className="size-3" strokeWidth={2.5} />
      </span>
    );
  }
  return <span className="mt-px size-4 shrink-0 rounded-full border border-line-strong" aria-hidden />;
}
