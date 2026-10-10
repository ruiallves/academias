import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { DadosInicio } from "@/layouts/tipos";
import { Hero } from "@/componentes/Hero";
import { BandaDoJogo } from "@/componentes/Jogo";
import { CartaoNoticia } from "@/componentes/CartaoNoticia";
import { CartaoProduto } from "@/componentes/CartaoProduto";
import { Patrocinadores } from "@/componentes/Patrocinadores";
import { LinkFim, TituloSeccao } from "@/componentes/Seccao";
import { BotaoLink } from "@/componentes/Botao";

/**
 * O início do layout clássico, de alto a baixo: o que aconteceu (herói), o
 * que vem aí (jogo), mais notícias, as equipas, a loja, quem apoia. A ordem
 * é a da AD Fafe, e é a ordem por que um adepto pergunta.
 */
export function InicioClassico({ clube, noticias, proximo, ultimo, equipas, produtos }: DadosInicio) {
  const destaques = noticias.filter((n) => n.featured).slice(0, 3);
  const destaqueIds = new Set(destaques.map((n) => n.id));
  const restantes = noticias.filter((n) => !destaqueIds.has(n.id)).slice(0, 4);

  return (
    <>
      <Hero destaques={destaques.length ? destaques : noticias.slice(0, 3)} />

      <BandaDoJogo proximo={proximo} ultimo={ultimo} clube={clube} />

      {restantes.length > 0 && (
        <section className="container-site mt-16 sm:mt-20" data-reveal>
          <TituloSeccao eyebrow="Últimas" titulo="Notícias" href="/noticias" hrefLabel="Todas as notícias" />
          <div className="mt-8 grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {restantes.map((n) => (
              <CartaoNoticia key={n.id} noticia={n} />
            ))}
          </div>
          <LinkFim href="/noticias">Todas as notícias</LinkFim>
        </section>
      )}

      {equipas.length > 0 && (
        <section className="container-site mt-16 sm:mt-20" data-reveal>
          <TituloSeccao eyebrow="O clube em campo" titulo="Equipas" href="/equipas" hrefLabel="Todas as equipas" />
          <ul className="mt-8 flex snap-x gap-3 overflow-x-auto pb-2 [scrollbar-width:none] sm:grid sm:grid-cols-3 sm:overflow-visible lg:grid-cols-6">
            {equipas.slice(0, 6).map((e) => (
              <li key={e.id} className="w-[11rem] shrink-0 snap-start sm:w-auto">
                <Link href={`/equipas/${e.slug}`} className="group relative block aspect-[4/5] overflow-hidden rounded-card bg-night">
                  {e.image && (
                    <Image
                      src={e.image}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 16vw, (min-width: 640px) 33vw, 11rem"
                      className="object-cover opacity-80 transition-transform duration-500 ease-out group-hover:scale-[1.04]"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-night to-transparent" aria-hidden />
                  <div className="absolute inset-x-0 bottom-0 p-4">
                    <p className="eyebrow text-night-ink-2">{e.sport}</p>
                    <p className="display mt-1 text-2xl text-night-ink">{e.name}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <LinkFim href="/equipas">Todas as equipas</LinkFim>
        </section>
      )}

      <section className="container-site mt-16 sm:mt-20" data-reveal>
        <div className="grid overflow-hidden rounded-card bg-signal-strong text-signal-on lg:grid-cols-2">
          <div className="p-6 sm:p-10">
            <p className="eyebrow opacity-80">Sócios</p>
            <h2 className="display mt-3 text-4xl text-signal-on sm:text-5xl">Faz parte do clube.</h2>
            <p className="mt-4 max-w-md text-[color:rgb(var(--signal-on-rgb)/0.85)]">
              Cartão de sócio no telemóvel, quotas em dia com um toque, entrada nos jogos em casa e desconto na loja.
              Tudo na app do {clube.shortName}.
            </p>
            <BotaoLink href={clube.membershipUrl} variante="claro" className="mt-8 !bg-white !text-[#1a1917]">
              Ser sócio
              <ArrowRight size={18} aria-hidden />
            </BotaoLink>
          </div>
          <div className="relative hidden min-h-[16rem] lg:block">
            <Image src="https://picsum.photos/seed/socios/1200/800" alt="" fill sizes="50vw" className="object-cover" />
            <div className="absolute inset-0 bg-signal-strong/30 mix-blend-multiply" aria-hidden />
          </div>
        </div>
      </section>

      {produtos.length > 0 && (
        <section className="container-site mt-16 sm:mt-20" data-reveal>
          <TituloSeccao eyebrow="Loja oficial" titulo="Veste o clube" href="/loja" hrefLabel="Ver a loja" />
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
            {produtos.slice(0, 4).map((p) => (
              <CartaoProduto key={p.id} produto={p} />
            ))}
          </div>
          <LinkFim href="/loja">Ver a loja</LinkFim>
        </section>
      )}

      <Patrocinadores sponsors={clube.sponsors} />
    </>
  );
}
