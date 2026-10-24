import Link from "next/link";
import { ArrowRight, MapPin } from "lucide-react";
import type { Clube, Jogo } from "@/dados/tipos";
import { euro, hora, isoDia, peçasDeData } from "@/lib/formatar";
import { fasesDoJogo } from "@/lib/bilheteira";
import { Emblema, EmblemaAdversario } from "@/componentes/Emblema";
import { Picotado } from "./Picotado";

/**
 * Um jogo da bilheteira, desenhado como um bilhete: a data num bloco da cor
 * do clube, o jogo ao meio, o picotado e, no canhoto, o preço e o "Comprar".
 * O cartão inteiro é a ligação para a compra (o `Link` estica-se por cima de
 * tudo), e o botão do canhoto é só o sinal de onde carregar.
 *
 * Em casa e fora: quem recebe aparece primeiro, e o jogo fora leva a etiqueta.
 */
export function BilheteDoJogo({ jogo, clube }: { jogo: Jogo; clube: Clube }) {
  const t = jogo.tickets!;
  const { dia, mes, semana } = peçasDeData(jogo.startsAt);
  const fases = fasesDoJogo(t);
  const publico = t.types.filter((x) => !x.forMembers).map((x) => x.price);
  const socios = t.types.filter((x) => x.forMembers).map((x) => x.price);
  const desde = publico.length ? Math.min(...publico) : socios.length ? Math.min(...socios) : null;
  const soDeSocio = publico.length === 0 && socios.length > 0;

  const nos = { nome: clube.shortName, emblema: <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={40} /> };
  const eles = { nome: jogo.opponent, emblema: <EmblemaAdversario name={jogo.opponent} logoUrl={jogo.opponentLogoUrl} size={40} /> };
  const [casa, fora] = jogo.isHome ? [nos, eles] : [eles, nos];
  const titulo = `${casa.nome} vs ${fora.nome}`;

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card bg-surface shadow-card transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgb(26_25_23/0.06),0_22px_44px_-18px_rgb(26_25_23/0.32)] sm:flex-row">
      {/* A data: o bloco da cor do clube, como a cabeça de um bilhete. */}
      <time
        dateTime={isoDia(jogo.startsAt)}
        className="flex items-center gap-4 bg-signal-strong px-5 py-4 text-signal-on sm:w-32 sm:shrink-0 sm:flex-col sm:justify-center sm:gap-0 sm:px-3 sm:py-6"
      >
        <span className="eyebrow opacity-80 sm:mb-1.5">{semana}</span>
        <span className="display text-4xl tabular sm:text-5xl">{dia}</span>
        <span className="eyebrow sm:mt-1">{mes}</span>
        <span className="ml-auto rounded-sm bg-black/15 px-2 py-1 text-sm font-bold tabular sm:ml-0 sm:mt-3">{hora(jogo.startsAt)}</span>
      </time>

      {/* O jogo. */}
      <div className="min-w-0 flex-1 px-5 py-5 sm:px-7 sm:py-6">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="eyebrow min-w-0 truncate text-ink-3">{[jogo.teamName, jogo.competition, jogo.roundLabel].filter(Boolean).join(" · ")}</p>
          {!jogo.isHome && <span className="rounded-sm bg-ink px-1.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider text-canvas">Fora</span>}
        </div>

        <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
          <span className="grid size-10 place-items-center text-ink">{casa.emblema}</span>
          <p className="display truncate text-xl text-ink sm:text-2xl">{casa.nome}</p>
          <span className="grid size-10 place-items-center text-ink">{fora.emblema}</span>
          <p className="display truncate text-xl text-ink sm:text-2xl">{fora.nome}</p>
        </div>

        <p className="mt-4 flex min-w-0 items-center gap-1.5 text-sm text-ink-3">
          <MapPin size={15} className="shrink-0" aria-hidden />
          <span className="truncate">{jogo.venue}</span>
        </p>

        {fases.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {fases.map((f) => (
              <li key={f} className="inline-flex items-center gap-1.5 rounded-full bg-signal-soft px-3 py-1 text-[0.8125rem] font-semibold text-signal-ink">
                <span className="size-1.5 rounded-full bg-signal" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Picotado />

      {/* O canhoto: o preço e o botão. */}
      <div className="flex items-center justify-between gap-4 px-5 py-5 sm:w-52 sm:shrink-0 sm:flex-col sm:items-start sm:justify-center sm:px-6">
        <div>
          <p className="text-[0.8125rem] font-semibold text-ink-3">{soDeSocio ? "Sócios desde" : "Desde"}</p>
          <p className="display text-3xl tabular text-ink">{desde === null ? "—" : desde === 0 ? "Grátis" : euro(desde)}</p>
        </div>
        <span className="inline-flex h-11 items-center gap-2 rounded-control bg-signal-strong px-4 font-semibold text-signal-on transition group-hover:brightness-110 sm:w-full sm:justify-center">
          Comprar
          <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>

      <Link href={`/bilheteira/${jogo.id}`} className="absolute inset-0 rounded-card" aria-label={`Comprar bilhetes para ${titulo}`} />
    </article>
  );
}
