import Image from "next/image";
import type { Clube } from "@/dados/tipos";

/**
 * Os patrocinadores, numa fila sóbria. Com logótipo mostra-o a cinzento e
 * acende ao passar; sem logótipo, o nome. Cada um é um link se o tiver.
 *
 * `quadrado` é o tema Holofote: a toda a largura, sem cantos redondos.
 */
export function Patrocinadores({ sponsors, quadrado = false }: { sponsors: Clube["sponsors"]; quadrado?: boolean }) {
  if (!sponsors.length) return null;
  return (
    <section aria-label="Patrocinadores" className={quadrado ? "px-4 pb-10 sm:px-6 lg:px-8" : "container-site mt-16 sm:mt-20"} data-reveal>
      <p className="eyebrow text-center text-ink-3">Patrocinadores e parceiros</p>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {sponsors.map((s) => {
          const conteudo = s.logoUrl ? (
            <Image
              src={s.logoUrl}
              alt={s.name}
              width={160}
              height={64}
              className="h-10 w-auto object-contain opacity-70 grayscale transition group-hover:opacity-100 group-hover:grayscale-0"
            />
          ) : (
            <span className="display text-center text-base text-ink-3 transition group-hover:text-ink">{s.name}</span>
          );
          const classe = `group flex h-20 items-center justify-center border border-line bg-surface px-4 ${quadrado ? "" : "rounded-card"}`;
          return (
            <li key={s.name}>
              {s.url ? (
                <a href={s.url} target="_blank" rel="noopener noreferrer sponsored" className={classe}>
                  {conteudo}
                </a>
              ) : (
                <div className={classe}>{conteudo}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
