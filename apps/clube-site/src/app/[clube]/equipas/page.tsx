import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { CabecalhoPagina } from "@/componentes/Seccao";

export const revalidate = 60;

export const metadata: Metadata = { title: "Equipas" };

/** As equipas agrupadas por modalidade, na ordem em que o clube as lista. */
export default async function Equipas({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const equipas = await fonte.equipas(clube.slug);
  const modalidades = [...new Set(equipas.map((e) => e.sport))];

  return (
    <>
      <CabecalhoPagina eyebrow="Equipas" titulo="O clube em campo" linha={`${equipas.length} equipas em ${modalidades.length} ${modalidades.length === 1 ? "modalidade" : "modalidades"}.`} />
      <div className="container-site mt-10 space-y-14">
        {modalidades.map((m) => (
          <section key={m} aria-labelledby={`mod-${m}`} data-reveal>
            <h2 id={`mod-${m}`} className="display text-2xl">
              {m}
            </h2>
            <span className="traco mt-3" aria-hidden />
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {equipas
                .filter((e) => e.sport === m)
                .map((e) => (
                  <li key={e.id}>
                    <Link href={`/equipas/${e.slug}`} className="group flex gap-4 rounded-card border border-line bg-surface p-3 transition hover:border-ink">
                      <div className="relative size-24 shrink-0 overflow-hidden rounded-[8px] bg-sunken">
                        {e.image && <Image src={e.image} alt="" fill sizes="6rem" className="object-cover" />}
                      </div>
                      <div className="min-w-0 py-1">
                        <p className="display text-xl text-ink transition group-hover:text-signal-ink">{e.name}</p>
                        {e.competition && <p className="mt-1 text-sm text-ink-3">{e.competition}</p>}
                        {e.staff[0] && (
                          <p className="mt-2 text-sm text-ink-2">
                            {e.staff[0].role}: <span className="font-semibold text-ink">{e.staff[0].name}</span>
                          </p>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
