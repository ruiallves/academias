import type { Metadata } from "next";
import { CalendarDays, MapPin } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { dataLonga, hora, isoDia } from "@/lib/formatar";
import { CabecalhoPagina } from "@/componentes/Seccao";
import { LinhaCalendario } from "@/componentes/Jogo";

export const revalidate = 60;

export const metadata: Metadata = { title: "Calendário" };

/**
 * Jogos e eventos do clube. Só o que é público: os jogos de todas as
 * equipas e os eventos (assembleias, jantares, torneios). Os treinos ficam
 * na app das famílias e não aparecem aqui.
 */
export default async function Calendario({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const [jogos, eventos] = await Promise.all([fonte.jogos(clube.slug), fonte.eventos(clube.slug)]);
  const agora = Date.now();
  const proximos = jogos.filter((j) => j.status !== "PLAYED" && new Date(j.startsAt).getTime() >= agora);
  const passados = jogos.filter((j) => j.status === "PLAYED").reverse();
  const eventosFuturos = eventos.filter((e) => new Date(e.startsAt).getTime() >= agora);

  return (
    <>
      <CabecalhoPagina eyebrow="Calendário" titulo="Jogos e eventos" linha="Todos os jogos de todas as equipas, e o que o clube organiza fora do campo." />
      <div className="container-site mt-10 grid gap-12 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-14">
          <section data-reveal>
            <h2 className="display text-2xl">Próximos jogos</h2>
            <span className="traco mt-3" aria-hidden />
            {proximos.length ? (
              <ul className="mt-4 divide-y divide-line">
                {proximos.map((j) => (
                  <LinhaCalendario key={j.id} jogo={j} clube={clube} />
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-ink-3">Sem jogos marcados.</p>
            )}
          </section>
          <section data-reveal>
            <h2 className="display text-2xl">Resultados</h2>
            <span className="traco mt-3" aria-hidden />
            {passados.length ? (
              <ul className="mt-4 divide-y divide-line">
                {passados.map((j) => (
                  <LinhaCalendario key={j.id} jogo={j} clube={clube} />
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-ink-3">Ainda não há resultados esta época.</p>
            )}
          </section>
        </div>

        <aside data-reveal>
          <h2 className="display text-2xl">Eventos</h2>
          <span className="traco mt-3" aria-hidden />
          {eventosFuturos.length ? (
            <ul className="mt-4 space-y-3">
              {eventosFuturos.map((e) => (
                <li key={e.id} className="rounded-card border border-line bg-surface p-4">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-signal-ink">
                    <CalendarDays size={14} aria-hidden />
                    <time dateTime={isoDia(e.startsAt)}>
                      {dataLonga(e.startsAt)} · {hora(e.startsAt)}
                    </time>
                  </p>
                  <p className="mt-2 font-semibold text-ink">{e.title}</p>
                  {e.venue && (
                    <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-3">
                      <MapPin size={14} aria-hidden />
                      {e.venue}
                    </p>
                  )}
                  {e.description && <p className="mt-2 text-sm text-ink-2">{e.description}</p>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-ink-3">Sem eventos marcados.</p>
          )}
        </aside>
      </div>
    </>
  );
}
