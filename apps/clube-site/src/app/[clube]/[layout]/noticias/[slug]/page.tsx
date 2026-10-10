import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { dataCompleta, isoDia } from "@/lib/formatar";
import { CartaoNoticia } from "@/componentes/CartaoNoticia";
import { TituloSeccao } from "@/componentes/Seccao";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clube: slug, slug: id } = await params;
  const n = await fonte.noticia(slug, id);
  if (!n) return {};
  return {
    title: n.title,
    description: n.summary,
    openGraph: { title: n.title, description: n.summary, images: [{ url: n.image }], type: "article", publishedTime: n.publishedAt },
  };
}

/**
 * Uma notícia. É a página que mais se partilha no WhatsApp, por isso os OG
 * tags vêm do servidor e a foto é a primeira coisa a chegar.
 */
export default async function Noticia({ params }: Props) {
  const clube = await clubeOu404(params);
  const { slug: id } = await params;
  const noticia = await fonte.noticia(clube.slug, id);
  if (!noticia) notFound();
  const relacionadas = (await fonte.noticias(clube.slug, { category: noticia.category, limit: 4 })).filter((n) => n.id !== noticia.id).slice(0, 3);

  return (
    <article>
      <header className="container-site mt-8 max-w-3xl">
        <Link href="/noticias" className="mb-4 inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
          <ArrowLeft size={16} aria-hidden />
          Notícias
        </Link>
        <p className="flex items-center gap-2 text-sm">
          <span className="eyebrow text-signal-ink">{noticia.category}</span>
          <span className="text-ink-4" aria-hidden>
            ·
          </span>
          <time dateTime={isoDia(noticia.publishedAt)} className="text-ink-3">
            {dataCompleta(noticia.publishedAt)}
          </time>
        </p>
        <h1 className="mt-3 text-3xl sm:text-4xl lg:text-5xl">{noticia.title}</h1>
        <p className="mt-5 text-lg text-ink-2">{noticia.summary}</p>
      </header>

      <figure className="container-site mt-8 max-w-5xl">
        <div className="relative aspect-[16/9] overflow-hidden rounded-card bg-sunken">
          <Image src={noticia.image} alt={noticia.imageAlt ?? ""} fill priority sizes="(min-width: 1024px) 1024px, 100vw" className="object-cover" />
        </div>
      </figure>

      <div className="container-site mt-10 max-w-3xl space-y-5 text-[1.0625rem] leading-relaxed text-ink-2">
        {noticia.body.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
      </div>

      {relacionadas.length > 0 && (
        <section className="container-site mt-20 border-t border-line pt-12">
          <TituloSeccao eyebrow={noticia.category} titulo="Relacionadas" href="/noticias" hrefLabel="Todas as notícias" />
          <div className="mt-8 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {relacionadas.map((n) => (
              <CartaoNoticia key={n.id} noticia={n} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
