import Image from "next/image";
import Link from "next/link";
import type { Noticia } from "@/dados/tipos";
import { dataCompleta, isoDia } from "@/lib/formatar";

/**
 * O herói da página de início: a notícia grande à esquerda e duas mais
 * pequenas à direita, todas com a foto por trás e o título por cima. É o
 * desenho do FC Porto e de quase todos os clubes: o site abre no que
 * aconteceu, não numa frase sobre o clube.
 *
 * O título lê-se sobre qualquer foto porque o degradê é fixo e escuro; a cor
 * do clube só entra na etiqueta da categoria.
 */
export function Hero({ destaques }: { destaques: Noticia[] }) {
  const [grande, ...resto] = destaques;
  if (!grande) return null;
  const laterais = resto.slice(0, 2);

  return (
    <section aria-label="Em destaque" className="container-site pt-4 sm:pt-6">
      <div className="grid gap-3 lg:grid-cols-3 lg:grid-rows-2">
        <Destaque noticia={grande} grande className="lg:col-span-2 lg:row-span-2" />
        {laterais.map((n) => (
          <Destaque key={n.id} noticia={n} />
        ))}
      </div>
    </section>
  );
}

function Destaque({ noticia, grande = false, className = "" }: { noticia: Noticia; grande?: boolean; className?: string }) {
  return (
    <article className={`group relative overflow-hidden rounded-card bg-night ${grande ? "aspect-[16/10] lg:aspect-auto" : "aspect-[16/9] lg:aspect-auto lg:min-h-[13rem]"} ${className}`}>
      <Link href={`/noticias/${noticia.slug}`} className="absolute inset-0">
        <Image
          src={noticia.image}
          alt={noticia.imageAlt ?? ""}
          fill
          priority={grande}
          sizes={grande ? "(min-width: 1024px) 66vw, 100vw" : "(min-width: 1024px) 33vw, 100vw"}
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/55 to-night/5" aria-hidden />
        <div className={`absolute inset-x-0 bottom-0 ${grande ? "p-5 sm:p-8" : "p-4 sm:p-5"}`}>
          <p className="flex items-center gap-2 text-xs">
            <span className="rounded-sm bg-signal-strong px-2 py-1 font-bold uppercase tracking-wider text-signal-on">
              {noticia.category}
            </span>
            <time dateTime={isoDia(noticia.publishedAt)} className="text-night-ink-2">
              {dataCompleta(noticia.publishedAt)}
            </time>
          </p>
          <h2
            className={`mt-3 text-night-ink ${grande ? "display text-3xl sm:text-4xl lg:text-5xl" : "text-lg font-bold leading-snug sm:text-xl"}`}
          >
            {noticia.title}
          </h2>
          {grande && <p className="mt-3 hidden max-w-2xl text-night-ink-2 sm:block">{noticia.summary}</p>}
        </div>
      </Link>
    </article>
  );
}
