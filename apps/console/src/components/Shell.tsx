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
      {/* Os estilhaços, por trás de tudo: primeiros e sem `z-index`. Ver `Estilhacos`. */}
      <Estilhacos />
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
      <main className="relative isolate min-w-0 flex-1 overflow-y-auto max-md:pb-[calc(64px+env(safe-area-inset-bottom))]">
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
 * Os estilhaços da cor do clube, por trás da página.
 *
 * A mesma linguagem da página de adesão a sócio (`membership.template.ts`): um
 * fundo todo cinzento parecia uma app qualquer, e isto diz de quem é a consola
 * sem uma imagem. Aqui ficam muito mais apagados do que lá, porque por cima há
 * tabelas para ler: veem-se nas margens e no espaço que a página deixa livre.
 *
 * Só os estilhaços. Halos de cor e linhas de campo por cima disto foram
 * experimentados e recusados: ficava pior.
 *
 * `fixed` a partir de `--nav-w`, para não rolarem com a página nem passarem por
 * baixo do menu.
 *
 * ## Fora do `<main>`, e sem `z-index` negativo
 *
 * Viviam dentro do `<main>` (que é a área que rola) com `-z-10`. No Safari essa
 * combinação, um `fixed` de prioridade negativa dentro de um contentor com
 * scroll, deixava páginas inteiras em branco: o conteúdo normal ia parar por
 * baixo do fundo e só se viam as peças que o Safari desenha à parte (os anéis,
 * a barra de pastilhas, os campos de texto, e os próprios estilhaços). Foi o
 * que o Coruchense viu nos Jogos, no Mac e no iPhone, a 03/10/2026.
 *
 * Agora são o primeiro filho da moldura, sem `z-index`: o `<main>` vem depois e
 * é posicionado, por isso desenha-se por cima deles sem truque nenhum. À vista
 * não muda nada.
 */
function Estilhacos() {
  const forma = (clip: string, cor: string, opacity: number): CSSProperties => ({
    clipPath: `polygon(${clip})`,
    background: `var(--color-${cor})`,
    opacity,
  });
  return (
    <div
      aria-hidden
      style={{ left: "var(--nav-w, 0px)" }}
      className="pointer-events-none fixed inset-y-0 right-0 overflow-hidden max-md:left-0!"
    >
      {/* Em baixo, à esquerda. */}
      <i className="absolute bottom-[10%] -left-12 block h-[130px] w-[190px] max-md:scale-50 max-md:origin-bottom-left" style={forma("0 0, 100% 42%, 30% 100%", "signal", 0.16)} />
      <i className="absolute bottom-[3%] left-10 block h-[190px] w-[150px] max-md:scale-50 max-md:origin-bottom-left" style={forma("0 22%, 100% 0, 62% 100%", "signal-strong", 0.12)} />
      <i className="absolute bottom-[24%] left-32 block h-[62px] w-[92px] max-md:hidden" style={forma("0 50%, 100% 0, 78% 100%", "signal", 0.1)} />
      {/* À direita, em cima e em baixo. */}
      <i className="absolute top-[14%] -right-16 block h-[150px] w-[210px] max-md:hidden" style={forma("0 0, 100% 50%, 26% 100%", "signal", 0.12)} />
      <i className="absolute top-[30%] right-6 block h-[210px] w-[160px] max-md:hidden" style={forma("30% 0, 100% 30%, 0 100%", "signal-strong", 0.09)} />
      <i className="absolute -right-5 bottom-[8%] block h-[84px] w-[120px] max-md:scale-50 max-md:origin-bottom-right" style={forma("0 30%, 100% 0, 60% 100%", "signal", 0.14)} />
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
