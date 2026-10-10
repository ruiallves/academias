import type { Metadata } from "next";
import Image from "next/image";
import { clubeOu404 } from "@/lib/clube";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { Patrocinadores } from "@/componentes/Patrocinadores";

export const revalidate = 60;

export const metadata: Metadata = { title: "O clube" };

/** Quem somos: história, direção, instalações, patrocinadores. */
export default async function OClube({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);

  return (
    <>
      <CabecalhoPagina eyebrow={clube.foundedYear ? `Desde ${clube.foundedYear}` : "O clube"} titulo={clube.name} linha={clube.about} />

      <div className="container-site mt-12 grid gap-12 lg:grid-cols-[2fr_1fr]">
        <section data-reveal>
          <h2 className="display text-2xl">História</h2>
          <span className="traco mt-3" aria-hidden />
          <div className="mt-5 max-w-2xl space-y-5 text-[1.0625rem] leading-relaxed text-ink-2">
            {clube.history.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>

        <aside data-reveal>
          <h2 className="display text-2xl">Direção</h2>
          <span className="traco mt-3" aria-hidden />
          <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
            {clube.board.map((m) => (
              <li key={m.name} className="px-4 py-3">
                <p className="font-semibold text-ink">{m.name}</p>
                <p className="text-sm text-ink-3">{m.role}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      {clube.facilities.length > 0 && (
        <section className="container-site mt-16" data-reveal>
          <h2 className="display text-2xl">Instalações</h2>
          <span className="traco mt-3" aria-hidden />
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clube.facilities.map((f) => (
              <li key={f.name} className="overflow-hidden rounded-card border border-line bg-surface">
                <div className="relative aspect-[16/10] bg-sunken">
                  <Image src={f.image} alt={f.name} fill sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="object-cover" />
                </div>
                <div className="p-4">
                  <p className="display text-xl text-ink">{f.name}</p>
                  <p className="mt-1 text-sm text-ink-2">{f.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Patrocinadores sponsors={clube.sponsors} />
    </>
  );
}
