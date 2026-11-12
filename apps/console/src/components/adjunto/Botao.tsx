import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bot, Maximize2, X } from "@/lib/icons";
import { cx } from "@/components/primitives";
import { useMobile } from "@/lib/viewport";
import { abrirMini, carregarEstado, NOME_DO_ADJUNTO, pedirPagina, useAdjunto } from "@/lib/adjunto";
import { contextoDaRota, sugestoesPara } from "@/lib/sugestoes";
import { Conversa } from "./Conversa";
import { Compositor } from "./Compositor";

/**
 * O robô ao canto, e o minichat que abre por cima dele.
 *
 * ## Em todas as páginas
 *
 * Fica fixo em baixo à direita, na consola inteira, menos na página do próprio
 * Adjunto. É a entrada mais curta: escrever, falar ou largar um ficheiro sem
 * sair de onde se está. Os avisos de erro e o cartão dos primeiros passos
 * sobem para não lhe cair em cima (`--adjunto-h`, lido por `Avisos` e
 * `Onboarding`).
 *
 * ## O minichat e a página
 *
 * O minichat é a mesma conversa que a página inteira (`routes/adjunto`): o
 * estado vive em `lib/adjunto.ts`. A seta em cima leva para a página; um
 * pedido grande (uma importação) também, porque o ensaio não cabe num balão.
 *
 * No telemóvel o balão vira folha a meio do ecrã, e o robô fica por cima da
 * barra de navegação.
 */
export function AdjuntoFlutuante() {
  const { ligado, aberto, irParaAPagina } = useAdjunto();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const mobile = useMobile();
  const naPagina = pathname === "/assistente" || pathname.startsWith("/assistente/");
  const visivel = ligado === true && !naPagina;

  useEffect(() => {
    void carregarEstado();
  }, []);

  // O minichat pediu a página: vai lá, e a conversa segue.
  useEffect(() => {
    if (irParaAPagina > 0) navigate("/assistente");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [irParaAPagina]);

  // Ctrl+K abre e fecha, em qualquer página.
  useEffect(() => {
    if (!visivel) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        abrirMini(!aberto);
      }
      if (e.key === "Escape" && aberto) abrirMini(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visivel, aberto]);

  // Os avisos e os primeiros passos sobem enquanto o robô está no canto.
  useEffect(() => {
    const raiz = document.documentElement;
    if (visivel) raiz.style.setProperty("--adjunto-h", "72px");
    else raiz.style.removeProperty("--adjunto-h");
    return () => {
      raiz.style.removeProperty("--adjunto-h");
    };
  }, [visivel]);

  if (!visivel) return null;

  const contexto = contextoDaRota(pathname);
  const sugestoes = sugestoesPara(pathname);

  return (
    <>
      {aberto && mobile && <button type="button" aria-label="Fechar" onClick={() => abrirMini(false)} className="fixed inset-0 z-[44] bg-ink/30" />}

      {aberto && (
        <section
          aria-label={NOME_DO_ADJUNTO}
          className={cx(
            "fixed z-[45] flex flex-col overflow-hidden bg-surface shadow-[var(--shadow-pop)]",
            mobile
              ? "mobile-sheet inset-x-0 bottom-0 h-[72dvh] rounded-t-[16px] border-t border-line"
              : "adjunto-abre right-4 bottom-[88px] h-[min(560px,calc(100dvh-112px))] w-[380px] rounded-[12px] border border-line",
          )}
        >
          <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line pr-1.5 pl-3.5">
            <span className="inline-flex size-7 items-center justify-center rounded-[8px] bg-signal-strong text-signal-on">
              <Bot className="size-4" strokeWidth={2} />
            </span>
            <span className="flex-1 text-body font-semibold text-ink">{NOME_DO_ADJUNTO}</span>
            <button type="button" onClick={() => pedirPagina()} aria-label="Abrir em página inteira" title="Abrir em página inteira" className="ctl-ghost size-9 justify-center px-0">
              <Maximize2 className="size-[17px]" strokeWidth={1.75} />
            </button>
            <button type="button" onClick={() => abrirMini(false)} aria-label="Fechar" className="ctl-ghost size-9 justify-center px-0">
              <X className="size-[17px]" strokeWidth={1.75} />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
            <Conversa compacto contexto={contexto} />
          </div>
          <div className="shrink-0 border-t border-line">
            <Compositor compacto contexto={contexto} sugestoes={sugestoes} autoFocus={!mobile} />
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => abrirMini(!aberto)}
        aria-label={aberto ? `Fechar ${NOME_DO_ADJUNTO}` : `Abrir ${NOME_DO_ADJUNTO}`}
        aria-expanded={aberto}
        title={`${NOME_DO_ADJUNTO} (Ctrl+K)`}
        className={cx(
          "fixed right-4 z-[46] inline-flex size-14 items-center justify-center rounded-full shadow-[0_6px_18px_rgba(26,25,23,0.22)] transition-colors duration-[120ms]",
          "bottom-4 max-md:bottom-[calc(80px+env(safe-area-inset-bottom))]",
          aberto ? "bg-ink text-surface" : "bg-signal-strong text-signal-on hover:brightness-95",
        )}
      >
        {aberto ? <X className="size-6" strokeWidth={2} /> : <Bot className="size-7" strokeWidth={1.8} />}
      </button>
    </>
  );
}
