import { useState, type CSSProperties, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Onboarding } from "./Onboarding";
import { BusyProvider, BusyScreen } from "./Busy";
import { usePresence } from "@/lib/presence";
import { MobileTabBar, MobileTopBar } from "./MobileNav";

export function Shell() {
  const [collapsed, setCollapsed] = useState(false);

  // A consola só chega aqui com sessão e academia resolvidas (ver `AcademyBoot`),
  // por isso é o sítio certo para dizer ao servidor que este separador está vivo.
  usePresence(true);

  return (
    /*
     * `--nav-w` é a largura do menu, publicada para quem precise de a medir.
     *
     * Quem precisa é a camada de carregamento: o disco tem de ficar no meio do
     * **conteúdo**, e não no meio da janela — com o menu a ocupar 236px à
     * esquerda, um disco centrado na janela aparece visivelmente descaído para a
     * direita do sítio onde o olho o procura. Como a largura muda quando o menu
     * encolhe, uma constante em CSS não servia.
     */
    /*
     * Telemóvel (abaixo de 768px): a barra lateral esconde-se e entram uma barra
     * de cima e uma de baixo — ver `MobileNav`. Tudo o que é telemóvel vive em
     * `max-md:`/`md:hidden`; acima disso nada disto existe e o desktop é o que
     * era, classe por classe.
     */
    <div
      className="flex h-dvh overflow-hidden bg-canvas max-md:flex-col"
      style={{ "--nav-w": collapsed ? "60px" : "236px" } as CSSProperties}
    >
      <MobileTopBar />
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />
      {/* `relative`: é contra este `<main>` que o disco de carregamento se
          centra. Ver `BusyScreen`. */}
      <main className="relative flex-1 overflow-y-auto max-md:pb-[calc(64px+env(safe-area-inset-bottom))]">
        {/* Largura total. A sidebar já dá o enquadramento à esquerda; uma segunda
            moldura de margem no meio do ecrã só afastava as colunas de dados umas
            das outras. O ar vem do padding, não de um limite de largura.

            E o padding vem de `--pg-pad`, que encolhe com a altura do ecrã — ver
            "Densidade da página" em `styles.css`. Num portátil de 1366×768 é a
            diferença entre a Visão geral caber e rolar.

            O `page-pad` mudou-se para dentro do `BusyScreen`: é o mesmo elemento
            que leva o desfoque, e uma camada a mais só para o padding era uma
            caixa a mais entre o `<main>` e a página. */}
        <BusyProvider>
          <BusyScreen>
            <Outlet />
          </BusyScreen>
        </BusyProvider>
      </main>

      {/* Ao canto e em todas as páginas: acompanha quem está a montar a academia
          sem lhe tomar o ecrã. Desaparece sozinho quando não houver passos a dar. */}
      <Onboarding />
      <MobileTabBar />
    </div>
  );
}

/**
 * Cabeçalho de página. Título à esquerda, uma acção primária à direita — o padrão
 * das referências. `eyebrow` dá contexto sem gastar uma linha de título.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-group text-ink-4 uppercase">{eyebrow}</div>}
        <h1 className="text-page text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-body text-ink-3">{subtitle}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </header>
  );
}
