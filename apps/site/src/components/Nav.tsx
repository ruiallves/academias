import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { NAV_LINKS } from "@/lib/content";
import { cx, Wordmark } from "./primitives";

/**
 * A navegação.
 *
 * ## Quase nada
 *
 * A marca à esquerda; à direita, três palavras, um filete vertical e uma acção.
 * Sem menu ao centro, sem pastilhas, sem ícones: uma empresa de produto
 * reconhece-se por aquilo que a navegação **não** tem.
 *
 * A barra encosta ao topo sem flutuar nem desfocar nada. O filete de baixo só
 * aparece depois de a página descer — antes disso, o cabeçalho e o herói são a
 * mesma superfície.
 *
 * ## Uma acção, e só uma
 *
 * "Experimentar". Quem já é cliente entra pelo endereço do próprio clube, não
 * por aqui — e um segundo destino no cabeçalho só divide a atenção de quem
 * chega pela primeira vez, que é toda a gente que vê esta página.
 *
 * ## O menu de telemóvel
 *
 * Ecrã inteiro, verde-pinheiro, títulos em serifa. Não é um painel a deslizar
 * de lado: é a própria casa a abrir-se.
 */
export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const { pathname, hash } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Mudar de página fecha o menu — senão fica aberto por cima do destino.
  useEffect(() => setOpen(false), [pathname, hash]);

  // Com o menu aberto, a página de trás não anda.
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cx(
        "sticky top-0 z-50 transition-[border-color] duration-300",
        open ? "bg-transparent" : "bg-paper",
        scrolled && !open ? "border-b border-line" : "border-b border-transparent",
      )}
    >
      <div className="wrap flex h-[68px] items-center justify-between gap-6">
        <Link to="/" aria-label="Academias — início">
          <Wordmark className={open ? "text-white" : undefined} />
        </Link>

        <div className="flex items-center gap-7">
          <nav className="hidden items-center gap-7 md:flex" aria-label="Principal">
            {NAV_LINKS.map((l) => {
              const active = pathname === l.to;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "text-[14.5px] font-medium transition-colors",
                    active ? "text-ink" : "text-ink-3 hover:text-ink",
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
            <span aria-hidden className="h-4 w-px bg-line-2" />
          </nav>

          <Link to="/contactos" className="btn btn-primary btn-sm hidden md:inline-flex">
            Experimentar
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            className={cx("-mr-2 flex size-10 items-center justify-center md:hidden", open && "text-white")}
          >
            <span className="relative block h-[9px] w-[20px]">
              <span
                className={cx(
                  "absolute left-0 block h-px w-full bg-current transition-transform duration-300",
                  open ? "top-1 rotate-45" : "top-0",
                )}
              />
              <span
                className={cx(
                  "absolute left-0 block h-px w-full bg-current transition-transform duration-300",
                  open ? "top-1 -rotate-45" : "top-2",
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {/* O menu de telemóvel: a casa inteira, em serifa. */}
      {open && (
        <div className="dark fixed inset-0 top-0 z-[-1] flex flex-col md:hidden">
          <div className="h-[68px] shrink-0" />
          <nav className="wrap flex flex-1 flex-col justify-center gap-1 pb-10" aria-label="Principal">
            {NAV_LINKS.map((l, i) => (
              <Link
                key={l.to}
                to={l.to}
                className="display border-b border-line py-5 text-[2rem] leading-none"
                style={{ ["--i" as string]: i }}
              >
                {l.label}
              </Link>
            ))}
            <div className="mt-10">
              <Link to="/contactos" className="btn btn-primary w-full">
                Experimentar 30 dias
              </Link>
            </div>
          </nav>
          <p className="wrap pb-8 text-[13px] text-ink-3">geral@academias.pt · Portugal</p>
        </div>
      )}
    </header>
  );
}
