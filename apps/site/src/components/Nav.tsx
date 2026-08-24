import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { NAV_LINKS } from "@/lib/content";
import { cx, Wordmark } from "./primitives";

/**
 * A navegação.
 *
 * ## Porque é que não flutua
 *
 * Nada de barra a pairar com vidro fosco e sombra: encosta ao topo, com um filete
 * de 1px por baixo que só aparece depois de a página descer. Antes disso não há
 * separação nenhuma — o cabeçalho e o herói são a mesma superfície, e é isso que
 * dá a sensação de página inteira em vez de site com moldura.
 *
 * ## Uma acção, e só uma
 *
 * "Experimentar". Nada de "Entrar" ao lado: quem já é cliente entra pelo endereço do
 * próprio clube, não por aqui — e um segundo destino no cabeçalho só divide a
 * atenção de quem chega pela primeira vez, que é toda a gente que vê esta página.
 *
 * ## O menu ao centro
 *
 * A marca à esquerda, o menu no meio do cabeçalho e a acção à direita. Encostado à
 * marca, o menu lia-se como parte do nome; ao centro, tem o ar de barra de navegação
 * e deixa o logótipo respirar.
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

  return (
    <header
      className={cx(
        "sticky top-0 z-50 bg-paper/85 backdrop-blur-[2px] transition-[border-color] duration-300",
        scrolled ? "border-b border-line" : "border-b border-transparent",
      )}
    >
      {/* Três colunas iguais nas pontas: é o que põe o menu no meio do cabeçalho e
          não a seguir ao logótipo. */}
      <div className="wrap grid h-[72px] grid-cols-[1fr_auto_1fr] items-center gap-6">
        <Link to="/" aria-label="Academias — início" className="justify-self-start">
          <Wordmark />
        </Link>

        <nav className="hidden items-center gap-9 md:flex" aria-label="Principal">
          {NAV_LINKS.map((l) => (
            <Link key={l.to} to={l.to} className="text-[14.5px] font-medium text-ink-2 transition-colors hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="col-start-3 flex items-center justify-end gap-4">
          <Link to="/contactos" className="btn btn-ink btn-sm hidden sm:inline-flex">
            Experimentar
          </Link>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? "Fechar menu" : "Abrir menu"}
            className="-mr-2 flex size-10 items-center justify-center md:hidden"
          >
            <span className="relative block h-[9px] w-[18px]">
              <span
                className={cx(
                  "absolute left-0 block h-px w-full bg-ink transition-transform duration-300",
                  open ? "top-1 rotate-45" : "top-0",
                )}
              />
              <span
                className={cx(
                  "absolute left-0 block h-px w-full bg-ink transition-transform duration-300",
                  open ? "top-1 -rotate-45" : "top-2",
                )}
              />
            </span>
          </button>
        </div>
      </div>

      {/* Menu de telemóvel: a página inteira, não um painel a deslizar de lado. */}
      {open && (
        <div className="border-t border-line bg-paper md:hidden">
          <div className="wrap flex flex-col py-3">
            {NAV_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="border-b border-line py-3.5 text-[17px] font-medium last:border-0">
                {l.label}
              </Link>
            ))}
            <div className="mt-4">
              <Link to="/contactos" className="btn btn-ink w-full">
                Experimentar 30 dias
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
