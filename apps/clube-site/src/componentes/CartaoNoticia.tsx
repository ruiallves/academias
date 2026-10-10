import Image from "next/image";
import Link from "next/link";
import type { Noticia } from "@/dados/tipos";
import { dataCompleta, isoDia } from "@/lib/formatar";

/**
 * Uma notícia na grelha: foto 16:10, categoria na cor do clube, título, data.
 * O cartão inteiro é o link; a foto aproxima-se ligeiramente ao passar.
 */
export function CartaoNoticia({ noticia, prioridade = false }: { noticia: Noticia; prioridade?: boolean }) {
  return (
    <article className="group">
      <Link href={`/noticias/${noticia.slug}`} className="block">
        <div className="relative aspect-[16/10] overflow-hidden rounded-card bg-sunken">
          <Image
            src={noticia.image}
            alt={noticia.imageAlt ?? ""}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
            priority={prioridade}
          />
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs">
          <span className="eyebrow text-signal-ink">{noticia.category}</span>
          <span className="text-ink-4" aria-hidden>
            ·
          </span>
          <time dateTime={isoDia(noticia.publishedAt)} className="text-ink-3">
            {dataCompleta(noticia.publishedAt)}
          </time>
        </p>
        <h3 className="mt-1.5 text-lg leading-snug text-ink transition group-hover:text-signal-ink">{noticia.title}</h3>
      </Link>
    </article>
  );
}

/** A versão em linha para listas longas: foto pequena à esquerda. */
export function LinhaNoticia({ noticia }: { noticia: Noticia }) {
  return (
    <article className="group">
      <Link href={`/noticias/${noticia.slug}`} className="grid grid-cols-[7rem_1fr] gap-4 sm:grid-cols-[11rem_1fr]">
        <div className="relative aspect-[16/10] overflow-hidden rounded-card bg-sunken">
          <Image
            src={noticia.image}
            alt={noticia.imageAlt ?? ""}
            fill
            sizes="11rem"
            className="object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03]"
          />
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-xs">
            <span className="eyebrow text-signal-ink">{noticia.category}</span>
            <span className="text-ink-4" aria-hidden>
              ·
            </span>
            <time dateTime={isoDia(noticia.publishedAt)} className="text-ink-3">
              {dataCompleta(noticia.publishedAt)}
            </time>
          </p>
          <h3 className="mt-1 text-base leading-snug text-ink transition group-hover:text-signal-ink sm:text-lg">
            {noticia.title}
          </h3>
          <p className="mt-1.5 hidden text-sm text-ink-2 sm:line-clamp-2">{noticia.summary}</p>
        </div>
      </Link>
    </article>
  );
}
