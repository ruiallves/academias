import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "lucide-react";
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
  const compraOnline = clube.loja?.compraOnline ?? false;

  return (
    <>
      <CabecalhoPagina
        eyebrow="Loja oficial"
        titulo="Veste o clube"
        linha={
          compraOnline
            ? "Equipamento de jogo, roupa e artigos de adepto. Pagas por MB WAY ou Multibanco e o dinheiro vai direto para o clube."
            : "Equipamento de jogo, roupa e artigos de adepto. A compra online ainda não está aberta; até lá, encomenda pelos contactos do clube."
        }
      />
      <div className="container-site mt-8">
        {clube.loja?.aviso && (
          <p className="mb-6 flex gap-3 rounded-card bg-signal-soft p-4 text-sm text-signal-ink">
            <Info size={18} className="mt-0.5 shrink-0" aria-hidden />
            {clube.loja.aviso}
          </p>
        )}
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
