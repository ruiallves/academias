import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { LinhaCalendario } from "@/componentes/Jogo";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string; slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clube: slug, slug: id } = await params;
  const e = await fonte.equipa(slug, id);
  return e ? { title: `${e.name} · ${e.sport}` } : {};
}

/**
 * Uma equipa: foto, equipa técnica, os jogos dela e, se o clube o publicar,
 * o plantel. O plantel é opcional de propósito: nos escalões jovens são
 * menores, e só aparece com consentimento.
 */
export default async function Equipa({ params }: Props) {
  const clube = await clubeOu404(params);
  const { slug: id } = await params;
  const equipa = await fonte.equipa(clube.slug, id);
  if (!equipa) notFound();
  const jogos = (await fonte.jogos(clube.slug)).filter((j) => j.teamId === equipa.id);
  const agora = Date.now();
  const proximos = jogos.filter((j) => j.status !== "PLAYED" && new Date(j.startsAt).getTime() >= agora);
  const passados = jogos.filter((j) => j.status === "PLAYED").reverse();

  const genero = equipa.gender === "F" ? "Feminina" : equipa.gender === "MISTA" ? "Mista" : equipa.gender === "M" ? "Masculina" : null;

  return (
    <>
      <div className="relative bg-night text-night-ink">
        {equipa.image && (
          <Image src={equipa.image} alt="" fill priority sizes="100vw" className="object-cover opacity-40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-night via-night/60 to-night/20" aria-hidden />
        <div className="container-site relative py-10 sm:py-16">
          <Link href="/equipas" className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-night-ink-2 hover:text-night-ink">
            <ArrowLeft size={16} aria-hidden />
            Equipas
          </Link>
          <p className="eyebrow mt-6 text-night-ink-2">{[equipa.sport, genero].filter(Boolean).join(" · ")}</p>
          <h1 className="display mt-2 text-5xl text-night-ink sm:text-7xl">{equipa.name}</h1>
          {equipa.competition && <p className="mt-4 text-lg text-night-ink-2">{equipa.competition}</p>}
        </div>
      </div>

      <div className="container-site mt-10 grid gap-12 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-12">
          {proximos.length > 0 && (
            <section data-reveal>
              <h2 className="display text-2xl">Próximos jogos</h2>
              <span className="traco mt-3" aria-hidden />
              <ul className="mt-4 divide-y divide-line">
                {proximos.map((j) => (
                  <LinhaCalendario key={j.id} jogo={j} clube={clube} />
                ))}
              </ul>
            </section>
          )}
          {passados.length > 0 && (
            <section data-reveal>
              <h2 className="display text-2xl">Resultados</h2>
              <span className="traco mt-3" aria-hidden />
              <ul className="mt-4 divide-y divide-line">
                {passados.map((j) => (
                  <LinhaCalendario key={j.id} jogo={j} clube={clube} />
                ))}
              </ul>
            </section>
          )}
          {equipa.roster.length > 0 && (
            <section data-reveal>
              <h2 className="display text-2xl">Plantel</h2>
              <span className="traco mt-3" aria-hidden />
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {equipa.roster.map((a) => (
                  <li key={a.name} className="flex items-center gap-4 rounded-card border border-line bg-surface px-4 py-3">
                    <span className="display w-8 text-2xl tabular text-signal-ink">{a.number ?? "–"}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-ink">{a.name}</span>
                      {a.position && <span className="block text-sm text-ink-3">{a.position}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside data-reveal>
          <h2 className="display text-2xl">Equipa técnica</h2>
          <span className="traco mt-3" aria-hidden />
          <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
            {equipa.staff.map((s) => (
              <li key={s.name} className="px-4 py-3">
                <p className="font-semibold text-ink">{s.name}</p>
                <p className="text-sm text-ink-3">{s.role}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </>
  );
}
