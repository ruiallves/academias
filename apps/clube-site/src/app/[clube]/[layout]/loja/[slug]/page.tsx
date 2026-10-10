import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Package, Truck } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { euro } from "@/lib/formatar";
import { CartaoProduto } from "@/componentes/CartaoProduto";
import { TituloSeccao } from "@/componentes/Seccao";
import { Comprar } from "./Comprar";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clube: slug, slug: id } = await params;
  const p = await fonte.produto(slug, id);
  return p ? { title: p.name, description: p.description, openGraph: { images: [{ url: p.image }] } } : {};
}

/** Um produto: foto grande, preço, tamanho, comprar. */
export default async function Produto({ params }: Props) {
  const clube = await clubeOu404(params);
  const { slug: id } = await params;
  const produto = await fonte.produto(clube.slug, id);
  if (!produto) notFound();
  const outros = (await fonte.produtos(clube.slug)).filter((p) => p.id !== produto.id && p.category === produto.category).slice(0, 4);

  return (
    <>
      <div className="container-site pt-8">
        <Link href="/loja" className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
          <ArrowLeft size={16} aria-hidden />
          Loja
        </Link>
      </div>
      <div className="container-site mt-4 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <div className="relative aspect-[9/11] overflow-hidden rounded-card bg-sunken">
          <Image src={produto.image} alt={produto.name} fill priority sizes="(min-width: 1024px) 50vw, 100vw" className="object-cover" />
        </div>
        <div className="lg:py-6">
          <p className="eyebrow text-signal-ink">{produto.category}</p>
          <h1 className="mt-2 text-3xl sm:text-4xl">{produto.name}</h1>
          <p className="display mt-4 text-4xl tabular">{euro(produto.price)}</p>
          <p className="mt-6 text-ink-2">{produto.description}</p>

          <Comprar produto={produto} />

          <ul className="mt-8 space-y-2 border-t border-line pt-6 text-sm text-ink-2">
            <li className="flex gap-2">
              <Package size={18} className="shrink-0 text-ink-3" aria-hidden />
              Levantamento gratuito na sede do clube, em dias de treino e de jogo.
            </li>
            <li className="flex gap-2">
              <Truck size={18} className="shrink-0 text-ink-3" aria-hidden />
              Envio por correio para Portugal continental.
            </li>
          </ul>
        </div>
      </div>

      {outros.length > 0 && (
        <section className="container-site mt-20 border-t border-line pt-12">
          <TituloSeccao eyebrow={produto.category} titulo="Também na loja" href="/loja" hrefLabel="Ver a loja" />
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
            {outros.map((p) => (
              <CartaoProduto key={p.id} produto={p} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
