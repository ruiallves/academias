import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MapPin, Ticket } from "lucide-react";
import type { DadosInicio } from "@/layouts/tipos";
import type { Clube, Jogo } from "@/dados/tipos";
import { Emblema, EmblemaAdversario } from "@/componentes/Emblema";
import { CartaoProduto } from "@/componentes/CartaoProduto";
import { dataLonga, haQuanto, hora, isoDia, peçasDeData } from "@/lib/formatar";
import { Carrossel } from "./Carrossel";

/**
 * O início do layout "porto": o carrossel a toda a largura, a faixa do jogo
 * (próximo, últimos resultados, sócio), as notícias em lista com o cartaz
 * do próximo jogo ao lado, as equipas em mosaico e a loja. A ordem do
 * fcporto.pt, com o que um clube de formação tem.
 */
export function InicioPorto({ clube, noticias, proximo, ultimo, equipas, produtos }: DadosInicio) {
  const destaques = noticias.filter((n) => n.featured).slice(0, 3);
  const carrossel = destaques.length ? destaques : noticias.slice(0, 3);
  const ids = new Set(carrossel.map((n) => n.id));
  const lista = noticias.filter((n) => !ids.has(n.id)).slice(0, 5);
  const [grande, ...pequenas] = equipas;

  return (
    <>
      <Carrossel noticias={carrossel} />

      <section aria-label="Jogos" className="grid border-b border-line lg:grid-cols-[1.1fr_1fr_0.9fr]" data-reveal>
        <div className="border-b border-line p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between">
            <h2 className="eyebrow text-signal-ink">Próximo jogo</h2>
            <Link href="/calendario" className="text-sm text-ink-2 hover:text-ink">
              Ver todos
            </Link>
          </div>
          {proximo ? <CartazPorto jogo={proximo} clube={clube} /> : <p className="mt-6 text-ink-3">Sem jogos marcados.</p>}
        </div>

        <div className="border-b border-line p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <h2 className="eyebrow text-signal-ink">Últimos resultados</h2>
          <Resultados clube={clube} ultimo={ultimo} />
        </div>

        <a href={clube.membershipUrl} className="group relative block min-h-[14rem] overflow-hidden bg-signal-strong text-signal-on">
          <Image src="https://picsum.photos/seed/bancada/900/700" alt="" fill sizes="(min-width: 1024px) 30vw, 100vw" className="object-cover opacity-20 mix-blend-luminosity transition-transform duration-700 group-hover:scale-105" />
          <div className="absolute inset-x-0 bottom-0 p-6 text-center">
            <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={40} className="mx-auto" />
            <p className="eyebrow mt-3 opacity-80">Cartão, quotas e jogos</p>
            <p className="display mt-1 text-3xl">Área do sócio</p>
          </div>
        </a>
      </section>

      <section className="grid gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_22rem] lg:px-8" data-reveal>
        <div>
          <h2 className="eyebrow text-signal-ink">Notícias</h2>
          <ul className="mt-4 divide-y divide-line border-t border-line">
            {lista.map((n) => (
              <li key={n.id}>
                <Link href={`/noticias/${n.slug}`} className="group grid gap-4 py-5 sm:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] sm:gap-6">
                  <div className="relative aspect-[16/10] overflow-hidden bg-sunken">
                    <Image src={n.image} alt={n.imageAlt ?? ""} fill sizes="(min-width: 1024px) 30vw, (min-width: 640px) 40vw, 100vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
                  </div>
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-xs font-bold text-signal-ink">
                        <span className="border-b-2 border-signal-line pb-1">{haQuanto(n.publishedAt)}</span>
                      </p>
                      <span className="shrink-0 border border-signal-line px-1.5 py-0.5 text-[0.625rem] font-bold uppercase tracking-wider text-signal-ink">
                        {n.category}
                      </span>
                    </div>
                    <h3 className="mt-4 text-xl font-bold leading-snug text-signal-ink transition group-hover:text-ink sm:text-2xl">{n.title}</h3>
                    <p className="mt-2 text-ink-2 sm:line-clamp-3">{n.summary}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <Link href="/noticias" className="mt-6 inline-flex h-12 items-center gap-2 bg-signal-strong px-6 text-sm font-bold uppercase tracking-wider text-signal-on transition hover:brightness-110">
            Mais notícias
            <ArrowRight size={18} aria-hidden />
          </Link>
        </div>

        <aside>
          <h2 className="eyebrow text-ink-3">Cartaz</h2>
          {proximo ? <CartazDoDia jogo={proximo} clube={clube} /> : null}
        </aside>
      </section>

      {equipas.length > 0 && (
        <section className="px-4 pb-10 sm:px-6 lg:px-8" data-reveal>
          <h2 className="eyebrow text-signal-ink">Equipas</h2>
          <div className="mt-4 grid gap-1 sm:grid-cols-3">
            {grande && <EquipaMosaico equipa={grande} grande />}
            {pequenas.slice(0, 3).map((e) => (
              <EquipaMosaico key={e.id} equipa={e} />
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/equipas" className="inline-flex h-12 items-center gap-2 bg-signal-strong px-6 text-sm font-bold uppercase tracking-wider text-signal-on transition hover:brightness-110">
              Todas as equipas
              <ArrowRight size={18} aria-hidden />
            </Link>
          </div>
        </section>
      )}

      {produtos.length > 0 && (
        <section className="px-4 pb-6 sm:px-6 lg:px-8" data-reveal>
          <h2 className="eyebrow text-signal-ink">Loja oficial</h2>
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
            {produtos.slice(0, 4).map((p) => (
              <CartaoProduto key={p.id} produto={p} />
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/loja" className="inline-flex h-12 items-center gap-2 bg-signal-strong px-6 text-sm font-bold uppercase tracking-wider text-signal-on transition hover:brightness-110">
              Mais na loja
              <ArrowRight size={18} aria-hidden />
            </Link>
          </div>
        </section>
      )}
    </>
  );
}

function CartazPorto({ jogo, clube }: { jogo: Jogo; clube: Clube }) {
  const { dia, mes, semana } = peçasDeData(jogo.startsAt);
  const nos = (
    <div className="flex flex-col items-center gap-2 text-center">
      <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={64} />
      <p className="text-xs font-bold uppercase tracking-wider text-ink">{clube.shortName}</p>
    </div>
  );
  const eles = (
    <div className="flex flex-col items-center gap-2 text-center text-ink">
      <EmblemaAdversario name={jogo.opponent} logoUrl={jogo.opponentLogoUrl} size={64} />
      <p className="text-xs font-bold uppercase tracking-wider text-ink">{jogo.opponent}</p>
    </div>
  );
  return (
    <div className="mt-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4">
        {jogo.isHome ? nos : eles}
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">
            {semana} {dia}/{mes}
          </p>
          <p className="display mt-1 text-5xl text-ink">{hora(jogo.startsAt)}</p>
          <p className="mt-1 text-[0.6875rem] font-bold uppercase tracking-wider text-ink-3">{jogo.competition ?? jogo.teamName}</p>
        </div>
        {jogo.isHome ? eles : nos}
      </div>
      <p className="mt-5 flex items-center justify-center gap-1.5 text-xs text-ink-3">
        <MapPin size={14} aria-hidden />
        {jogo.venue}
      </p>
      {jogo.tickets?.open && (
        <Link href={`/bilheteira/${jogo.id}`} className="mt-4 flex h-11 items-center justify-center gap-2 bg-signal-strong text-sm font-bold uppercase tracking-wider text-signal-on transition hover:brightness-110">
          <Ticket size={16} aria-hidden />
          Bilhetes
        </Link>
      )}
    </div>
  );
}

function Resultados({ clube, ultimo }: { clube: Clube; ultimo: Jogo | null }) {
  if (!ultimo) return <p className="mt-6 text-ink-3">Ainda não há resultados.</p>;
  const venceu = ultimo.ourScore! > ultimo.theirScore!;
  const perdeu = ultimo.ourScore! < ultimo.theirScore!;
  return (
    <div className="mt-6">
      <p className="text-[0.6875rem] font-bold uppercase tracking-wider text-ink-3">
        {[ultimo.teamName, ultimo.competition, ultimo.roundLabel].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <p className="text-right font-bold text-ink">{ultimo.isHome ? clube.shortName : ultimo.opponent}</p>
        <p className={`display px-3 text-4xl tabular ${venceu ? "text-ok" : perdeu ? "text-risk" : "text-ink"}`}>
          {ultimo.isHome ? `${ultimo.ourScore}:${ultimo.theirScore}` : `${ultimo.theirScore}:${ultimo.ourScore}`}
        </p>
        <p className="font-bold text-ink">{ultimo.isHome ? ultimo.opponent : clube.shortName}</p>
      </div>
      <p className="mt-3 text-center text-xs text-ink-3">
        <time dateTime={isoDia(ultimo.startsAt)}>{dataLonga(ultimo.startsAt)}</time> · {ultimo.venue}
      </p>
      <Link href="/calendario" className="mt-6 inline-flex h-11 items-center gap-2 border border-line-strong px-5 text-xs font-bold uppercase tracking-wider text-ink transition hover:border-ink">
        Ver resultados
        <ArrowRight size={16} aria-hidden />
      </Link>
    </div>
  );
}

/** O cartaz tipográfico do próximo jogo, como a publicidade do fcporto. */
function CartazDoDia({ jogo, clube }: { jogo: Jogo; clube: Clube }) {
  const { dia, mes, semana } = peçasDeData(jogo.startsAt);
  const casa = jogo.isHome ? clube.shortName : jogo.opponent;
  const fora = jogo.isHome ? jogo.opponent : clube.shortName;
  return (
    <Link
      href={jogo.tickets?.open ? `/bilheteira/${jogo.id}` : "/calendario"}
      className="group relative mt-4 block aspect-[3/4] overflow-hidden bg-signal-strong text-center text-signal-on"
    >
      <Image src="https://picsum.photos/seed/cartaz/900/1200" alt="" fill sizes="(min-width: 1024px) 22rem, 100vw" className="object-cover opacity-20 mix-blend-luminosity transition-transform duration-700 group-hover:scale-105" />
      <div className="absolute inset-0 flex flex-col items-center justify-between p-6">
        <p className="text-xs font-bold uppercase tracking-[0.3em]">
          {dia} {mes}
          <span className="block">{semana}</span>
          <span className="block">{hora(jogo.startsAt).replace(":", "h")}</span>
        </p>
        <div>
          <p className="display text-4xl">{casa}</p>
          <p className="display text-2xl opacity-70">vs</p>
          <p className="display text-4xl">{fora}</p>
        </div>
        <p className="inline-flex h-10 items-center gap-2 bg-white px-4 text-xs font-bold uppercase tracking-wider text-[#1a1917]">
          {jogo.tickets?.open ? "Bilhetes" : "Calendário"}
          <ArrowRight size={14} aria-hidden />
        </p>
      </div>
    </Link>
  );
}

function EquipaMosaico({ equipa, grande = false }: { equipa: DadosInicio["equipas"][number]; grande?: boolean }) {
  return (
    <Link href={`/equipas/${equipa.slug}`} className={`group relative block overflow-hidden bg-night ${grande ? "aspect-[16/10] sm:col-span-3 sm:aspect-[21/9]" : "aspect-[16/10]"}`}>
      {equipa.image && (
        <Image src={equipa.image} alt="" fill sizes={grande ? "100vw" : "(min-width: 640px) 33vw, 100vw"} className="object-cover opacity-80 transition-transform duration-700 group-hover:scale-105" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-night via-night/30 to-transparent" aria-hidden />
      <div className="absolute inset-x-0 bottom-0 p-5">
        <p className="text-xs font-bold text-signal-ink">
          <span className="border-b-2 border-signal-line pb-1">{equipa.sport}</span>
        </p>
        <p className={`display mt-3 text-night-ink ${grande ? "text-4xl sm:text-5xl" : "text-2xl"}`}>{equipa.name}</p>
        {equipa.competition && <p className="mt-1 text-sm text-night-ink-2">{equipa.competition}</p>}
      </div>
    </Link>
  );
}
