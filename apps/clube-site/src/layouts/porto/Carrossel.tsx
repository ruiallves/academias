"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { Noticia } from "@/dados/tipos";

/**
 * O herói do layout "porto": uma notícia de cada vez, a toda a largura, com
 * o título gigante sublinhado na cor do clube e um botão "Ver mais". Avança
 * sozinho de 7 em 7 segundos, pára com o rato em cima e com
 * `prefers-reduced-motion`, e os pontos em baixo à direita trocam à mão.
 *
 * Todas as notícias ficam no HTML (só uma visível): o Google e o WhatsApp
 * leem o primeiro título, e o utilizador sem JavaScript vê o primeiro slide.
 */
export function Carrossel({ noticias }: { noticias: Noticia[] }) {
  const [i, setI] = useState(0);
  const [parado, setParado] = useState(false);
  const n = noticias.length;

  useEffect(() => {
    if (n < 2 || parado || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((v) => (v + 1) % n), 7000);
    return () => clearInterval(t);
  }, [n, parado]);

  if (!n) return null;

  return (
    <section
      aria-roledescription="carrossel"
      aria-label="Em destaque"
      // Sem `aspect` a partir de lg: com `min-height`, o rácio empurrava a
      // largura para lá do ecrã. Altura fixa, e a foto cobre.
      className="relative aspect-[4/3] overflow-hidden bg-night sm:aspect-[16/9] lg:aspect-auto lg:h-[32rem] xl:h-[36rem]"
      onMouseEnter={() => setParado(true)}
      onMouseLeave={() => setParado(false)}
    >
      {noticias.map((nt, k) => (
        <article
          key={nt.id}
          aria-hidden={k !== i}
          className={`absolute inset-0 transition-opacity duration-700 ease-out ${k === i ? "opacity-100" : "pointer-events-none opacity-0"}`}
        >
          <Image src={nt.image} alt={nt.imageAlt ?? ""} fill priority={k === 0} sizes="100vw" className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-night/85 via-night/40 to-transparent" aria-hidden />
          <div className="absolute inset-0 bg-gradient-to-t from-night/70 to-transparent" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8 lg:p-12">
            <p className="eyebrow text-night-ink">
              <span className="border-b-2 border-signal-line pb-1">{nt.category}</span>
            </p>
            <h2 className="display mt-5 max-w-4xl text-3xl text-night-ink underline decoration-signal-line decoration-[3px] underline-offset-[10px] sm:text-5xl lg:text-6xl lg:leading-[1.05]">
              {nt.title}
            </h2>
            <Link
              href={`/noticias/${nt.slug}`}
              tabIndex={k === i ? 0 : -1}
              className="mt-8 inline-flex h-12 items-center gap-2 bg-signal-strong px-6 text-sm font-bold uppercase tracking-wider text-signal-on transition hover:brightness-110"
            >
              Ver mais
              <ArrowRight size={18} aria-hidden />
            </Link>
          </div>
        </article>
      ))}

      {n > 1 && (
        <div className="absolute bottom-5 right-5 flex gap-2 sm:bottom-8 sm:right-8" role="tablist" aria-label="Destaques">
          {noticias.map((nt, k) => (
            <button
              key={nt.id}
              type="button"
              role="tab"
              aria-selected={k === i}
              aria-label={`Destaque ${k + 1}: ${nt.title}`}
              onClick={() => setI(k)}
              className="grid size-8 place-items-center"
            >
              <span className={`block size-2.5 rounded-full transition ${k === i ? "bg-signal" : "bg-white/40 hover:bg-white/70"}`} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
