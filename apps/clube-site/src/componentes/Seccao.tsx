import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * O cabeçalho de uma secção da página: etiqueta pequena, título grande e, à
 * direita, o link para a lista inteira. Sempre o mesmo em todas as secções,
 * para a página de início se ler de alto a baixo sem reaprender nada.
 */
export function TituloSeccao({
  eyebrow,
  titulo,
  href,
  hrefLabel = "Ver tudo",
  className = "",
}: {
  eyebrow?: string;
  titulo: string;
  href?: string;
  hrefLabel?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-end justify-between gap-4 ${className}`}>
      <div>
        {eyebrow && <p className="eyebrow text-signal-ink">{eyebrow}</p>}
        <h2 className="display mt-2 text-3xl sm:text-4xl">{titulo}</h2>
        <span className="traco mt-3" aria-hidden />
      </div>
      {href && (
        <Link
          href={href}
          className="hidden h-11 shrink-0 items-center gap-1.5 font-semibold text-ink transition hover:text-signal-ink sm:inline-flex"
        >
          {hrefLabel}
          <ArrowRight size={18} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** A mesma ligação do título, para o fim da secção em telemóvel. */
export function LinkFim({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="mt-6 inline-flex h-11 items-center gap-1.5 font-semibold text-ink transition hover:text-signal-ink sm:hidden"
    >
      {children}
      <ArrowRight size={18} aria-hidden />
    </Link>
  );
}

/** O cabeçalho de uma página interior: etiqueta, título e uma linha. */
export function CabecalhoPagina({ eyebrow, titulo, linha }: { eyebrow?: string; titulo: string; linha?: string }) {
  return (
    <div className="border-b border-line bg-surface">
      <div className="container-site py-10 sm:py-14">
        {eyebrow && <p className="eyebrow text-signal-ink">{eyebrow}</p>}
        <h1 className="display mt-2 text-4xl sm:text-5xl lg:text-6xl">{titulo}</h1>
        {linha && <p className="mt-4 max-w-2xl text-lg text-ink-2">{linha}</p>}
      </div>
    </div>
  );
}
