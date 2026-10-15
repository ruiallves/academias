import type { Metadata } from "next";
import Link from "next/link";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { CartaoProduto } from "@/componentes/CartaoProduto";

export const revalidate = 60;

export const metadata: Metadata = { title: "Loja" };

type Props = { params: Promise<{ clube: string }>; searchParams: Promise<{ categoria?: string }> };

/** A loja: filtro por categoria no URL e a grelha de produtos. */
export default async function Loja({ params, searchParams }: Props) {
  const clube = await clubeOu404(params);
  const { categoria } = await searchParams;
  const todos = await fonte.produtos(clube.slug);
  const categorias = [...new Set(todos.map((p) => p.category))];
  const lista = categoria ? todos.filter((p) => p.category === categoria) : todos;

  return (
    <>
      <CabecalhoPagina eyebrow="Loja oficial" titulo="Veste o clube" linha="Equipamento de jogo, roupa e artigos de adepto. Levantamento na sede ou envio por correio." />
      <div className="container-site mt-8">
        <nav aria-label="Categorias" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          <ul className="flex gap-2">
            {[{ c: "", l: "Tudo" }, ...categorias.map((c) => ({ c, l: c }))].map(({ c, l }) => {
              const ativo = (categoria ?? "") === c;
              return (
                <li key={c}>
                  <Link
                    href={c ? `/loja?categoria=${encodeURIComponent(c)}` : "/loja"}
                    aria-current={ativo ? "page" : undefined}
                    className={`inline-flex h-10 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold transition ${
                      ativo ? "border-ink bg-ink text-canvas" : "border-line-strong bg-surface text-ink-2 hover:border-ink hover:text-ink"
                    }`}
                  >
                    {l}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        {lista.length === 0 ? (
          <p className="mt-12 text-ink-3">Sem produtos nesta categoria.</p>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {lista.map((p, i) => (
              <CartaoProduto key={p.id} produto={p} prioridade={i < 4} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
