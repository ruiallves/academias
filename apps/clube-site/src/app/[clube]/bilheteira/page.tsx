import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BadgeCheck, MapPin, QrCode, Ticket } from "lucide-react";
import { jogosComBilhetes } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { desdeDoJogo, fasesDoJogo } from "@/lib/bilheteira";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { Cartaz, LinhaDoJogo } from "@/componentes/Jogo";

export const revalidate = 60;

export const metadata: Metadata = { title: "Bilheteira" };

/**
 * Os jogos com bilhetes à venda, um cartaz por jogo, com o preço mais baixo
 * do público (ou o dos sócios, num jogo só com bilhetes de sócio) e as fases
 * da venda quando as há.
 */
export default async function Bilheteira({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const jogos = await jogosComBilhetes(clube.slug);

  return (
    <>
      <CabecalhoPagina eyebrow="Bilheteira" titulo="Bilhetes para os jogos em casa" linha="Os jogos em casa com bilhetes à venda. Compra aqui, paga por MB WAY ou Multibanco e recebe os bilhetes no telemóvel." />
      <div className="container-site mt-10">
        {jogos.length === 0 ? (
          <p className="text-ink-3">Não há bilhetes à venda neste momento. Os jogos em casa aparecem aqui quando a venda abre.</p>
        ) : (
          <ul className="grid gap-4 lg:grid-cols-2">
            {jogos.map((j) => {
              const desde = desdeDoJogo(j.tickets!);
              const fases = fasesDoJogo(j.tickets!);
              return (
                <li key={j.id} data-reveal>
                  <article className="rounded-card border border-line bg-surface p-5 sm:p-7">
                    <LinhaDoJogo jogo={j} />
                    <div className="mt-5">
                      <Cartaz jogo={j} clube={clube} />
                    </div>
                    {fases.length > 0 && (
                      <ul className="mt-5 flex flex-wrap gap-2">
                        {fases.map((f) => (
                          <li key={f} className="rounded-sm bg-signal-soft px-2.5 py-1 text-sm font-semibold text-signal-ink">
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="mt-6 flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                      <p className="flex items-center gap-2 text-sm text-ink-3">
                        <MapPin size={16} aria-hidden />
                        {j.venue}
                      </p>
                      <Link
                        href={`/bilheteira/${j.id}`}
                        className="inline-flex h-11 items-center justify-center gap-2 rounded-control bg-signal-strong px-5 font-semibold text-signal-on transition hover:brightness-110"
                      >
                        <Ticket size={18} aria-hidden />
                        {desde ?? "Ver bilhetes"}
                        <ArrowRight size={18} aria-hidden />
                      </Link>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}

        <section className="mt-16 grid gap-4 sm:grid-cols-3" data-reveal>
          {[
            { Icone: Ticket, t: "Compra em dois minutos", d: "MB WAY ou Multibanco. Sem registo." },
            { Icone: QrCode, t: "Bilhete com código QR", d: "Fica no telemóvel e chega por email. Um código por pessoa." },
            { Icone: BadgeCheck, t: "Preço de sócio", d: "Com as quotas em dia, o número de sócio dá o preço de sócio." },
          ].map(({ Icone, t, d }) => (
            <div key={t} className="rounded-card bg-sunken p-5">
              <Icone size={22} className="text-signal-ink" aria-hidden />
              <p className="mt-3 font-semibold text-ink">{t}</p>
              <p className="mt-1 text-sm text-ink-2">{d}</p>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
