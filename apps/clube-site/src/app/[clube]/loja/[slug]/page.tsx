import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { euro } from "@/lib/formatar";
import { esgotado, fotosDoProduto } from "@/lib/loja";
import { CartaoProduto } from "@/componentes/CartaoProduto";
import { servicosDaLoja } from "@/componentes/loja/servicos";
import { Galeria } from "./Galeria";
import { Comprar } from "./Comprar";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clube: slug, slug: id } = await params;
  const p = await fonte.produto(slug, id);
  return p ? { title: p.name, description: p.description, openGraph: { images: p.image ? [{ url: p.image }] : undefined } } : {};
}

/**
 * Um artigo, ao jeito das lojas de equipamento: as fotografias em grande à
 * esquerda e, à direita, uma coluna que fica presa enquanto se vê a
 * galeria, com o nome, o preço, o tamanho e o botão. Como se recebe e como
 * se paga abre por baixo, para não empurrar o botão para fora do ecrã.
 */
export default async function Produto({ params }: Props) {
  const clube = await clubeOu404(params);
  const { slug: id } = await params;
  const produto = await fonte.produto(clube.slug, id);
  if (!produto) notFound();
  const todos = await fonte.produtos(clube.slug);
  // Primeiro os da mesma categoria, depois os outros; os esgotados no fim.
  const outros = todos
    .filter((p) => p.id !== produto.id)
    .map((p, i) => ({ p, chave: (esgotado(p) ? 2 : 0) + (p.category === produto.category ? 0 : 1), i }))
    .sort((a, b) => a.chave - b.chave || a.i - b.i)
    .slice(0, 8)
    .map((x) => x.p);
  const loja = clube.loja;
  const compraOnline = loja?.compraOnline ?? false;
  const { entrega, pagamento } = servicosDaLoja(loja);

  return (
    <>
      <nav aria-label="Caminho" className="container-site pt-5 sm:pt-6">
        <ol className="flex items-center gap-2 text-sm text-ink-3">
          <li>
            <Link href="/loja" className="inline-flex h-11 items-center font-medium hover:text-ink">
              Loja
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li>
            <Link href={`/loja?categoria=${encodeURIComponent(produto.category)}`} className="inline-flex h-11 items-center font-medium hover:text-ink">
              {produto.category}
            </Link>
          </li>
        </ol>
      </nav>

      <div className="container-site mt-1 grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:gap-12 xl:gap-16">
        <Galeria imagens={fotosDoProduto(produto)} nome={produto.name} />

        <div className="min-w-0 self-start lg:sticky lg:top-[calc(var(--topo)+1.5rem)]">
          <p className="text-sm font-semibold text-ink-3">{produto.category}</p>
          <h1 className="titulo-loja mt-2 text-[clamp(2.5rem,5vw,3.75rem)]">{produto.name}</h1>
          <p className="mt-5 text-2xl font-bold tabular text-ink">{euro(produto.price)}</p>

          <Comprar slug={clube.slug} produto={produto} compraOnline={compraOnline} />

          {produto.description && <p className="mt-10 text-[1.0625rem] leading-relaxed text-ink-2">{produto.description}</p>}

          <div className="mt-8 border-t border-line">
            <Abrir titulo={entrega.length > 1 ? "Entrega e levantamento" : entrega[0].titulo} aberto>
              <ul className="space-y-3">
                {entrega.map((s) => (
                  <li key={s.titulo}>
                    {entrega.length > 1 && <p className="font-semibold text-ink">{s.titulo}</p>}
                    <p>{s.texto}</p>
                  </li>
                ))}
              </ul>
            </Abrir>
            {pagamento && (
              <Abrir titulo="Pagamento">
                <p className="font-semibold text-ink">{pagamento.titulo}</p>
                <p>{pagamento.texto}</p>
              </Abrir>
            )}
          </div>
        </div>
      </div>

      {outros.length > 0 && (
        <section className="mt-24 sm:mt-32">
          <div className="container-site flex items-end justify-between gap-4">
            <h2 className="titulo-loja text-[clamp(2rem,4vw,3rem)]">Também na loja</h2>
            <Link href="/loja" className="inline-flex h-11 shrink-0 items-center font-semibold text-ink underline decoration-2 underline-offset-[6px] hover:decoration-signal">
              Ver tudo
            </Link>
          </div>
          {/* Uma fila que se arrasta: no telemóvel a seguinte espreita à direita; no computador cabem quatro certas. */}
          <div className="container-site mt-8">
            <ul className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 px-4 pb-4 [scrollbar-width:thin] sm:mx-0 sm:scroll-px-0 sm:gap-4 sm:px-0">
              {outros.map((p) => (
                <li key={p.id} className="w-[46%] shrink-0 snap-start sm:w-[calc((100%-2rem)/3)] lg:w-[calc((100%-3rem)/4)]">
                  <CartaoProduto produto={p} sizes="(min-width: 1024px) 290px, 46vw" />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </>
  );
}

/** Uma secção que abre e fecha, sem JavaScript. */
function Abrir({ titulo, aberto = false, children }: { titulo: string; aberto?: boolean; children: React.ReactNode }) {
  return (
    <details open={aberto} className="group/abrir border-b border-line">
      <summary className="flex min-h-14 list-none items-center justify-between gap-4 py-3 text-[1.0625rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {titulo}
        <ChevronDown size={20} className="shrink-0 transition-transform duration-200 group-open/abrir:rotate-180" aria-hidden />
      </summary>
      <div className="pb-5 text-[0.9375rem] text-ink-2">{children}</div>
    </details>
  );
}
