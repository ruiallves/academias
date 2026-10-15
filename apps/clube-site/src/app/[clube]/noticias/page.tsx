import type { Metadata } from "next";
import Link from "next/link";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { CartaoNoticia, LinhaNoticia } from "@/componentes/CartaoNoticia";

export const revalidate = 60;

export const metadata: Metadata = { title: "Notícias" };

type Props = { params: Promise<{ clube: string }>; searchParams: Promise<{ categoria?: string }> };

/**
 * A lista de notícias com filtro por categoria no URL (`?categoria=Seniores`),
 * para cada filtro ter um endereço que se partilha. As três primeiras em
 * cartão, as restantes em linha: a página fica legível a partir da décima.
 */
export default async function Noticias({ params, searchParams }: Props) {
  const clube = await clubeOu404(params);
  const { categoria } = await searchParams;
  const [todas, filtradas] = await Promise.all([
    fonte.noticias(clube.slug),
    categoria ? fonte.noticias(clube.slug, { category: categoria }) : null,
  ]);
  const lista = filtradas ?? todas;
  const categorias = [...new Set(todas.map((n) => n.category))];

  return (
    <>
      <CabecalhoPagina eyebrow="Notícias" titulo="O que se passa no clube" />
      <div className="container-site mt-8">
        <nav aria-label="Categorias" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <ul className="flex gap-2">
            <li>
              <Filtro href="/noticias" ativo={!categoria}>
                Todas
              </Filtro>
            </li>
            {categorias.map((c) => (
              <li key={c}>
                <Filtro href={`/noticias?categoria=${encodeURIComponent(c)}`} ativo={categoria === c}>
                  {c}
                </Filtro>
              </li>
            ))}
          </ul>
        </nav>

        {lista.length === 0 ? (
          <p className="mt-12 text-ink-3">Ainda não há notícias nesta categoria.</p>
        ) : (
          <>
            <div className="mt-8 grid gap-x-5 gap-y-8 sm:grid-cols-2 md:grid-cols-3">
              {lista.slice(0, 3).map((n, i) => (
                <CartaoNoticia key={n.id} noticia={n} prioridade={i === 0} />
              ))}
            </div>
            {lista.length > 3 && (
              <div className="mt-12 grid gap-8 border-t border-line pt-10">
                {lista.slice(3).map((n) => (
                  <LinhaNoticia key={n.id} noticia={n} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Filtro({ href, ativo, children }: { href: string; ativo: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={`inline-flex h-10 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition ${
        ativo ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink-2 hover:border-ink hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}
