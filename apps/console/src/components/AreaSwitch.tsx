import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Briefcase, Check, ChevronDown, IdCard, Users } from "@/lib/icons";
import { AREA_LABEL, irParaApp, useAppAreas } from "@/lib/app-contexts";
import { useMobile } from "@/lib/viewport";
import { cx } from "./primitives";

/**
 * O switcher de área, do lado da consola — Staff ⇄ Família ⇄ Sócio.
 *
 * ## Porque é que existe aqui
 *
 * É o par do `AreaSwitch` da app do clube (`apps/family/src/screens/socio/`).
 * Quem é treinador **e** pai vê o mesmo gesto nas três áreas: na Família e no
 * Sócio o chip está no cabeçalho, e no Staff estava só enterrado na folha do
 * menu. A mesma pessoa, a mesma troca, dois sítios diferentes conforme a área
 * onde calhava estar — e o do Staff era o único que obrigava a abrir um menu
 * para descobrir que a troca sequer existia.
 *
 * ## Duas formas, um componente
 *
 * Chip no cabeçalho (por omissão): diz onde se está e abre uma folha para
 * trocar. Lista à vista (`asList`), dentro da folha do menu, onde já vivia —
 * aí o cabeçalho "Mudar de área" enquadra, e os destinos chegam.
 *
 * As duas lêem os contextos do mesmo sítio (`lib/app-contexts.ts`), para nunca
 * dizerem coisas diferentes. Nenhuma aparece a quem só é staff: um menu com uma
 * opção é mobília.
 *
 * ## Só no telemóvel
 *
 * A barra de cima e a folha do menu são as duas peças que só existem abaixo dos
 * 768px (ver `MobileNav`). No computador a consola tem a barra lateral e a app
 * do clube não está instalada — não há para onde trocar, e por isso também não
 * se pergunta ao servidor. Ver `useAppAreas`.
 *
 * ## Porque é que a folha sai por um portal
 *
 * A lição é da app do clube, e custou uma tarde lá: um `backdrop-filter` num
 * antecessor cria um containing block para os descendentes `fixed`, e a folha
 * deixa de cobrir o ecrã para passar a cobrir o cabeçalho. A barra de cima da
 * consola ainda não tem filtro nenhum — a de baixo já tem —, e a folha no
 * `body` é o que faz isso deixar de poder acontecer.
 */

/** Para onde se pode ir. O Staff é onde já se está; entra na folha como o item aceso. */
const DESTINOS = [
  { type: "FAMILY", icon: Users },
  { type: "MEMBER", icon: IdCard },
] as const;

export function AreaSwitch({ asList }: { asList?: boolean }) {
  const mobile = useMobile();
  /*
   * A lista só é desenhada dentro da folha do menu, que já é `md:hidden` e só
   * abre por um toque; o chip vive na barra de cima, que existe no DOM em
   * qualquer largura e está escondida por CSS. Sem esta condição, cada consola
   * aberta num computador pagava um pedido para não desenhar nada.
   */
  const areas = useAppAreas(asList || mobile);
  const [aberto, setAberto] = useState(false);

  useEffect(() => {
    if (!aberto) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aberto]);

  const disponiveis = DESTINOS.filter((d) => areas?.includes(d.type));
  if (disponiveis.length === 0) return null;

  if (asList) {
    return (
      <section className="mt-4">
        <h3 className="px-2 pb-1.5 text-group font-semibold text-ink uppercase">Mudar de área</h3>
        <ul className="overflow-hidden rounded-[14px] border border-line">
          {disponiveis.map(({ type, icon: Icon }) => (
            <li key={type} className="border-b border-line last:border-0">
              <button
                type="button"
                onClick={() => irParaApp(type)}
                className="flex min-h-12 w-full items-center gap-3 px-3 text-left text-body font-medium text-ink"
              >
                <Icon className="nav-icon size-[18px] shrink-0" strokeWidth={1.75} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{AREA_LABEL[type].label}</span>
                  <span className="block truncate text-[11px] font-normal text-ink-3">{AREA_LABEL[type].hint}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Mudar de área"
        aria-haspopup="dialog"
        aria-expanded={aberto}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-sunken px-2.5 text-meta font-medium text-ink-2 transition-colors duration-[120ms] active:bg-line"
      >
        Staff
        <ChevronDown className="size-3.5" strokeWidth={2} />
      </button>

      {aberto &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-end bg-ink/30 md:hidden"
            onMouseDown={(e) => e.target === e.currentTarget && setAberto(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Mudar de área"
              className="mobile-sheet w-full rounded-t-[20px] bg-surface p-3 shadow-[var(--shadow-pop)]"
              style={{ paddingBottom: "calc(12px + env(safe-area-inset-bottom))" }}
            >
              <span className="mx-auto mb-2.5 block h-1 w-10 rounded-full bg-line-strong" aria-hidden />
              <p className="px-2 pb-2 text-panel text-ink">Mudar de área</p>

              <ul className="overflow-hidden rounded-[14px] border border-line">
                {/* Onde se está. Não faz nada — é a resposta a "e eu estou em quê?". */}
                <li className="flex min-h-12 items-center gap-3 border-b border-line bg-signal-soft px-3 text-body font-medium text-signal-ink">
                  <Briefcase className="size-[18px] shrink-0" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">Staff</span>
                    <span className="block truncate text-[11px] font-normal opacity-80">
                      A consola do clube, no telemóvel
                    </span>
                  </span>
                  <Check className="size-4 shrink-0" strokeWidth={2.25} />
                </li>

                {disponiveis.map(({ type, icon: Icon }) => (
                  <li key={type} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => irParaApp(type)}
                      className={cx(
                        "flex min-h-12 w-full items-center gap-3 px-3 text-left text-body font-medium text-ink",
                        "transition-colors duration-[120ms] active:bg-sunken",
                      )}
                    >
                      <Icon className="nav-icon size-[18px] shrink-0" strokeWidth={1.75} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{AREA_LABEL[type].label}</span>
                        <span className="block truncate text-[11px] font-normal text-ink-3">
                          {AREA_LABEL[type].hint}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
