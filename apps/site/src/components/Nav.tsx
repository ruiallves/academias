import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CONTACT_EMAIL, NAV_LINKS } from "@/lib/content";
import { cx, Wordmark } from "./marca";

/**
 * A navegação.
 *
 * Uma cápsula branca a flutuar no topo, com a marca, três ligações e uma ação.
 * Fica sempre por cima da página, seja o fundo claro ou escuro.
 *
 * No telemóvel, o menu abre a ecrã inteiro.
 */
export function Nav() {
  const [aberto, setAberto] = useState(false);
  const { pathname, hash } = useLocation();

  // Mudar de página fecha o menu, senão fica aberto por cima do destino.
  useEffect(() => setAberto(false), [pathname, hash]);

  // Com o menu aberto, a página de trás não anda.
  useEffect(() => {
    document.documentElement.style.overflow = aberto ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [aberto]);

  return (
    <>
      <header className="cabecalho palco-cal flex items-center justify-between gap-6" style={{ background: "rgb(255 255 255 / 0.96)" }}>
        <Link to="/" aria-label="Academias, início">
          <Wordmark />
        </Link>

        <div className="flex items-center gap-2">
          <nav className="mr-4 hidden items-center gap-7 md:flex" aria-label="Principal">
            {NAV_LINKS.map((l) => {
              const ativa = pathname === l.to;
              return (
                <Link
                  key={l.to}
                  to={l.to}
                  aria-current={ativa ? "page" : undefined}
                  className={cx("text-[0.98rem] font-semibold transition-colors", ativa ? "text-texto" : "text-texto-2 hover:text-texto")}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>

          <Link to="/contactos" className="btn btn-cheio btn-p hidden md:inline-flex">
            Experimentar
          </Link>

          <button
            type="button"
            onClick={() => setAberto((v) => !v)}
            aria-expanded={aberto}
            aria-label={aberto ? "Fechar menu" : "Abrir menu"}
            className="flex size-11 items-center justify-center rounded-full md:hidden"
          >
            <span className="relative block h-[9px] w-[22px]">
              <span
                className={cx(
                  "absolute left-0 block h-[2px] w-full rounded bg-current transition-transform duration-300",
                  aberto ? "top-1 rotate-45" : "top-0",
                )}
              />
              <span
                className={cx(
                  "absolute left-0 block h-[2px] w-full rounded bg-current transition-transform duration-300",
                  aberto ? "top-1 -rotate-45" : "top-2",
                )}
              />
            </span>
          </button>
        </div>
      </header>

      {aberto && (
        <div className="menu-cheio palco-cal flex flex-col md:hidden">
          <nav className="flex flex-1 flex-col justify-center px-(--margem) pb-10" aria-label="Principal">
            {NAV_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="titulo border-b border-fio py-5 text-[2.6rem]">
                {l.label}
              </Link>
            ))}
            <Link to="/contactos" className="btn btn-cheio mt-10 w-full">
              Experimentar 30 dias
            </Link>
          </nav>
          <p className="px-(--margem) pb-8 text-texto-3">{CONTACT_EMAIL}</p>
        </div>
      )}
    </>
  );
}
