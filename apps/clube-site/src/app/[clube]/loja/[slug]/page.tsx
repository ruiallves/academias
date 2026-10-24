import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Package, ShieldCheck, Truck } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { euro } from "@/lib/formatar";
import { CartaoProduto } from "@/componentes/CartaoProduto";
import { TituloSeccao } from "@/componentes/Seccao";
import { Galeria } from "./Galeria";
import { Comprar } from "./Comprar";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clube: slug, slug: id } = await params;
  const p = await fonte.produto(slug, id);
  return p ? { title: p.name, description: p.description, openGraph: { images: p.image ? [{ url: p.image }] : undefined } } : {};
}

/** Um produto: fotografias, preço, tamanho, juntar ao carrinho, e como se entrega. */
export default async function Produto({ params }: Props) {
  const clube = await clubeOu404(params);
  const { slug: id } = await params;
  const produto = await fonte.produto(clube.slug, id);
  if (!produto) notFound();
  const outros = (await fonte.produtos(clube.slug)).filter((p) => p.id !== produto.id && p.category === produto.category).slice(0, 4);
  const loja = clube.loja;
  const compraOnline = loja?.compraOnline ?? false;

  return (
    <>
      <div className="container-site pt-8">
        <Link href="/loja" className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
          <ArrowLeft size={16} aria-hidden />
          Loja
        </Link>
      </div>
      <div className="container-site mt-4 grid gap-8 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
        <Galeria imagens={produto.images?.length ? produto.images : produto.image ? [produto.image] : []} nome={produto.name} />
        <div className="lg:py-6">
          <p className="eyebrow text-signal-ink">{produto.category}</p>
          <h1 className="mt-2 text-3xl sm:text-4xl">{produto.name}</h1>
          <p className="display mt-4 text-4xl tabular">{euro(produto.price)}</p>
          <p className="mt-6 text-ink-2">{produto.description}</p>

          <Comprar slug={clube.slug} produto={produto} compraOnline={compraOnline} />

          <ul className="mt-8 space-y-2 border-t border-line pt-6 text-sm text-ink-2">
            {loja?.levantamento && (
              <li className="flex gap-2">
                <Package size={18} className="shrink-0 text-ink-3" aria-hidden />
                <span>
                  Levantamento{loja.levantamento.local ? ` em ${loja.levantamento.local}` : " no clube"}, sem custos
                  {loja.levantamento.nota ? `. ${loja.levantamento.nota}` : ""}
                </span>
              </li>
            )}
            {loja?.envio && (
              <li className="flex gap-2">
                <Truck size={18} className="shrink-0 text-ink-3" aria-hidden />
                <span>
                  Envio pelo correio: {loja.envio.preco === 0 ? "grátis" : euro(loja.envio.preco)}
                  {loja.envio.gratisAPartirDe !== null && loja.envio.preco > 0 ? `, grátis a partir de ${euro(loja.envio.gratisAPartirDe)}` : ""}
                  {loja.envio.nota ? `. ${loja.envio.nota}` : ""}
                </span>
              </li>
            )}
            {!loja?.levantamento && !loja?.envio && (
              <li className="flex gap-2">
                <Package size={18} className="shrink-0 text-ink-3" aria-hidden />
                Levantamento na sede do clube
              </li>
            )}
            {compraOnline && (
              <li className="flex gap-2">
                <ShieldCheck size={18} className="shrink-0 text-ink-3" aria-hidden />
                Pagamento por MB WAY ou Multibanco, direto para o clube
              </li>
            )}
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
