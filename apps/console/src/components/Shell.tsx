import { useState, type CSSProperties, type ReactNode } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Onboarding } from "./Onboarding";
import { BusyProvider, BusyScreen } from "./Busy";
import { usePresence } from "@/lib/presence";
import { useStore } from "@/lib/store";
import { MobileTabBar, MobileTopBar } from "./MobileNav";

export function Shell() {
  const [collapsed, setCollapsed] = useState(false);

  /*
   * A página inteira ouve o arranque. É por isso que não é preciso F5.
   *
   * ## O que estava a acontecer
   *
   * `listAthletes`, `listTeams`, `listFees` e companhia lêem **variáveis de
   * módulo** de `lib/store.ts` — não são estado do React. Quem escreve chama
   * `reloadAcademy()`, que as substitui e avisa os subscritores; mas uma página
   * que só as *chama* não é subscritora nenhuma, e o React não tem como saber
   * que o que ela desenhou ficou velho.
   *
   * Importar cinquenta atletas fazia exactamente isto: o servidor gravava, o
   * store recarregava, e a lista à frente da pessoa continuava a mostrar o que
   * mostrava antes. Só um F5 — que remonta tudo e volta a ler as variáveis —
   * é que revelava o trabalho. Vinte e quatro páginas estavam nesta situação.
   *
   * ## Porque é que a subscrição vive aqui
   *
   * Porque a alternativa é lembrar-se de `useStore()` em cada página que lê o
   * store, e esquecer-se numa é reabrir o mesmo bug em silêncio — não há aviso,
   * nem erro, nem teste que o apanhe: só uma lista que teima em estar
   * desactualizada. Já aconteceu vinte e quatro vezes.
   *
   * O `Shell` é o pai de todas as rotas: subscrito aqui, qualquer página
   * presente ou futura reage ao store sem ter de saber que ele existe. O custo
   * é redesenhar a árvore quando o arranque muda — o que acontece depois de uma
   * escrita, não continuamente.
   */
  useStore();

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
      {/*
        `relative`: é contra este `<main>` que o disco de carregamento se
        centra. Ver `BusyScreen`.

        `min-w-0` é o que impede a página de fugir para a direita, e não é
        detalhe: um item de flex nasce com `min-width: auto`, o que quer dizer
        *nunca encolhas abaixo do teu conteúdo*. Bastava uma tabela larga lá
        dentro para o `<main>` crescer, empurrar a página para fora da janela e
        ser cortado pelo `overflow-hidden` da moldura — conteúdo escondido à
        direita, sem barra de scroll para lá chegar.

        Com `min-w-0` o `<main>` volta a caber, e os `overflow-x-auto` que já
        existem por dentro (o da `DataTable`, por exemplo) passam a fazer o que
        prometem: o scroll acontece **dentro** do painel, e a página fica
        quieta. É por isso que isto está aqui em cima e não em cada tabela.
      */}
      <main className="relative min-w-0 flex-1 overflow-y-auto max-md:pb-[calc(64px+env(safe-area-inset-bottom))]">
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
      {/* Telemóvel: as acções descem para uma linha própria e embrulham, em vez de
          empurrar o título para fora do ecrã. */}
      {children && (
        <div className="flex shrink-0 items-center gap-2 max-md:w-full max-md:flex-wrap max-md:[&>*]:min-w-0">{children}</div>
      )}
    </header>
  );
}
