import { useState } from "react";
import { createPortal } from "react-dom";
import { Briefcase, ChevronDown, Check, IdCard, Users } from "lucide-react";
import { chooseContext, useContexts, type ContextType } from "@/lib/contexts";
import { resetSocio } from "@/lib/socio";
import { cx } from "@/ui";

/**
 * O switcher de área — Família ⇄ Sócio ⇄ Staff, sem logout.
 *
 * Staff é a excepção que confirma a regra: escolhê-lo veste o contexto como os
 * outros, e é o `App` que, ao vê-lo vestido, entrega a sessão à consola e sai
 * (ver `lib/handoff.ts`). Daqui é só mais uma opção.
 *
 * ## Duas formas, um componente
 *
 * No header é um chip pequeno com uma seta (`asList` desligado): diz onde se
 * está e abre uma folha para trocar. No perfil é a lista à vista (`asList`),
 * porque o perfil é onde se vai "mexer na conta" e a troca merece lá estar por
 * extenso. As duas formas partilham a mesma verdade — os contextos vêm do
 * mesmo store — para nunca dizerem coisas diferentes.
 *
 * Não aparece de todo com um contexto só: um menu com uma opção é mobília.
 *
 * ## O que trocar faz — e não faz
 *
 * Escreve a escolha, limpa o cache do contexto que se deixa, e deixa o `App`
 * redesenhar. Sem logout, sem pedir credenciais, sem recarregar a página — é
 * uma mudança de roupa, não de pessoa.
 *
 * ## Porque é que a folha sai por um portal
 *
 * Porque o chip vive dentro do `<header>`, e o header tem `backdrop-blur-xl`.
 * **Um `backdrop-filter` diferente de `none` cria um containing block para os
 * descendentes `fixed`** — a mesma regra do `transform` e do `filter`. O
 * `fixed inset-0` deixava de cobrir o ecrã e passava a cobrir o **header**, de
 * modo que o `items-end` encostava a folha ao fundo dele: uma folha que se
 * abria colada ao topo do ecrã, por baixo da barra, em vez de subir de baixo.
 *
 * Tirar o `backdrop-blur` resolveria e estragava o header. Pôr a folha no
 * `body` resolve sem lhe tocar, e é o que qualquer diálogo devia fazer. Os
 * outros overlays da app (pagamentos, ficha do atleta) não precisam disto
 * porque vivem no corpo da página, onde não há filtro nenhum por cima.
 */

const AREAS: { type: ContextType; label: string; hint: string; icon: typeof Users }[] = [
  { type: "STAFF", label: "Staff", hint: "A consola do clube, no telemóvel", icon: Briefcase },
  { type: "FAMILY", label: "Família", hint: "Acompanha os teus atletas, treinos e pagamentos", icon: Users },
  { type: "MEMBER", label: "Sócio", hint: "O teu cartão, quotas e novidades do clube", icon: IdCard },
];

export function AreaSwitch({ asList }: { asList?: boolean }) {
  const { contexts, active } = useContexts();
  const [aberto, setAberto] = useState(false);

  const disponiveis = AREAS.filter((a) => contexts?.some((c) => c.type === a.type));
  if (disponiveis.length < 2) return null;

  function trocar(type: ContextType) {
    if (type !== active) {
      resetSocio();
      chooseContext(type);
    }
    setAberto(false);
  }

  if (asList) {
    return (
      <div className="overflow-hidden rounded-[20px] bg-surface shadow-[var(--shadow-soft)]">
        {disponiveis.map(({ type, label, hint, icon: Icon }) => (
          <button
            key={type}
            type="button"
            onClick={() => trocar(type)}
            className="flex w-full items-center gap-3 border-b border-ink/5 px-4 py-3 text-left last:border-0"
          >
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-sunken text-ink-2">
              <Icon className="size-[18px]" strokeWidth={1.9} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold text-ink">{label}</span>
              <span className="block truncate text-[12px] text-ink-3">{hint}</span>
            </span>
            {type === active && <Check className="size-4 shrink-0 text-signal-ink" strokeWidth={2.4} />}
          </button>
        ))}
      </div>
    );
  }

  const actual = AREAS.find((a) => a.type === active);

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2.5 py-1.5 text-[12px] font-semibold text-ink-2 active:scale-95"
        aria-label="Mudar de área"
      >
        {actual?.label ?? "Área"}
        <ChevronDown className="size-3.5" strokeWidth={2.2} />
      </button>

      {aberto && createPortal(
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40" onClick={() => setAberto(false)}>
          <div
            className="w-full max-w-[480px] rounded-t-[24px] bg-canvas p-5 pb-[calc(20px+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-ink/15" aria-hidden />
            <p className="px-1 pb-3 text-[16px] font-semibold text-ink">Mudar de área</p>
            <div className="space-y-2">
              {disponiveis.map(({ type, label, hint, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => trocar(type)}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-[16px] bg-surface p-4 text-left shadow-[var(--shadow-soft)]",
                    type === active && "ring-2 ring-[var(--color-signal)]",
                  )}
                >
                  <span className="flex size-10 items-center justify-center rounded-[12px] bg-signal-soft text-signal-ink">
                    <Icon className="size-5" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-ink">{label}</span>
                    <span className="block truncate text-[12px] text-ink-3">{hint}</span>
                  </span>
                  {type === active && <Check className="size-5 shrink-0 text-signal-ink" strokeWidth={2.4} />}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
