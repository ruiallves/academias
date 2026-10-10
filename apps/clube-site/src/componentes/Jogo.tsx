import Link from "next/link";
import { MapPin, Ticket } from "lucide-react";
import type { Clube, Jogo } from "@/dados/tipos";
import { dataLonga, hora, isoDia, peçasDeData } from "@/lib/formatar";
import { Emblema, EmblemaAdversario } from "./Emblema";
import { BotaoLink } from "./Botao";

/**
 * O cartaz de um jogo: os dois emblemas e, entre eles, a hora ou o resultado.
 * O clube fica sempre do lado em que joga: à esquerda em casa, à direita fora,
 * como nas tabelas de resultados.
 */
export function Cartaz({ jogo, clube, escuro = false }: { jogo: Jogo; clube: Clube; escuro?: boolean }) {
  const jogado = jogo.status === "PLAYED" && jogo.ourScore != null && jogo.theirScore != null;
  const nos = (
    <Lado nome={clube.shortName} escuro={escuro}>
      <Emblema logoUrl={clube.logoUrl} shortName={clube.shortName} size={64} />
    </Lado>
  );
  const eles = (
    <Lado nome={jogo.opponent} escuro={escuro}>
      <span className={escuro ? "text-night-ink" : "text-ink"}>
        <EmblemaAdversario name={jogo.opponent} logoUrl={jogo.opponentLogoUrl} size={64} />
      </span>
    </Lado>
  );
  const golosCasa = jogo.isHome ? jogo.ourScore : jogo.theirScore;
  const golosFora = jogo.isHome ? jogo.theirScore : jogo.ourScore;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-6">
      {jogo.isHome ? nos : eles}
      <div className="text-center">
        {jogado ? (
          <p className={`display text-5xl tabular sm:text-6xl ${escuro ? "text-night-ink" : "text-ink"}`}>
            {golosCasa}
            <span className={`mx-1 ${escuro ? "text-night-ink-2" : "text-ink-4"}`}>:</span>
            {golosFora}
          </p>
        ) : (
          <>
            <p className={`display text-4xl sm:text-5xl ${escuro ? "text-night-ink" : "text-ink"}`}>{hora(jogo.startsAt)}</p>
            <p className={`mt-1 text-sm ${escuro ? "text-night-ink-2" : "text-ink-3"}`}>{dataLonga(jogo.startsAt)}</p>
          </>
        )}
      </div>
      {jogo.isHome ? eles : nos}
    </div>
  );
}

function Lado({ nome, escuro, children }: { nome: string; escuro: boolean; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 text-center">
      {children}
      <p className={`line-clamp-2 w-full break-words text-sm font-semibold sm:text-base ${escuro ? "text-night-ink" : "text-ink"}`}>{nome}</p>
    </div>
  );
}

/** A linha por cima do cartaz: competição, jornada, equipa. */
export function LinhaDoJogo({ jogo, escuro = false }: { jogo: Jogo; escuro?: boolean }) {
  return (
    <p className={`eyebrow min-w-0 text-right leading-snug ${escuro ? "text-night-ink-2" : "text-ink-3"}`}>
      {[jogo.teamName, jogo.competition, jogo.roundLabel].filter(Boolean).join(" · ")}
    </p>
  );
}

/**
 * A banda do início: próximo jogo e último resultado, lado a lado, em fundo
 * escuro. É a primeira coisa a seguir às notícias, como na AD Fafe.
 */
export function BandaDoJogo({ proximo, ultimo, clube }: { proximo: Jogo | null; ultimo: Jogo | null; clube: Clube }) {
  if (!proximo && !ultimo) return null;
  return (
    <section aria-label="Jogos" className="container-site mt-12 sm:mt-16" data-reveal>
      <div className="grid gap-3 lg:grid-cols-2">
        {proximo && (
          <div className="rounded-card bg-night p-5 text-night-ink sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow shrink-0 whitespace-nowrap text-signal-on">
                <span className="rounded-sm bg-signal-strong px-2 py-1">Próximo jogo</span>
              </p>
              <LinhaDoJogo jogo={proximo} escuro />
            </div>
            <div className="mt-6">
              <Cartaz jogo={proximo} clube={clube} escuro />
            </div>
            <div className="mt-6 flex flex-col items-start gap-3 border-t border-night-line pt-5 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-center gap-2 text-sm text-night-ink-2">
                <MapPin size={16} aria-hidden />
                {proximo.venue}
              </p>
              {proximo.tickets?.open ? (
                <BotaoLink href={`/bilheteira/${proximo.id}`} variante="clube">
                  <Ticket size={18} aria-hidden />
                  Comprar bilhete
                </BotaoLink>
              ) : (
                <Link href="/calendario" className="text-sm font-semibold text-night-ink hover:underline">
                  Ver calendário
                </Link>
              )}
            </div>
          </div>
        )}
        {ultimo && (
          <div className="rounded-card border border-line bg-surface p-5 sm:p-7">
            <div className="flex items-center justify-between gap-3">
              <p className="eyebrow shrink-0 whitespace-nowrap text-ink-3">Último resultado</p>
              <LinhaDoJogo jogo={ultimo} />
            </div>
            <div className="mt-6">
              <Cartaz jogo={ultimo} clube={clube} />
            </div>
            <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-5 text-sm text-ink-3">
              <p className="flex items-center gap-2">
                <MapPin size={16} aria-hidden />
                {ultimo.venue}
              </p>
              <time dateTime={isoDia(ultimo.startsAt)}>{dataLonga(ultimo.startsAt)}</time>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Uma linha do calendário: a data em bloco à esquerda, o jogo no meio, o
 * resultado ou a hora à direita.
 */
export function LinhaCalendario({ jogo, clube }: { jogo: Jogo; clube: Clube }) {
  const { dia, mes, semana } = peçasDeData(jogo.startsAt);
  const jogado = jogo.status === "PLAYED" && jogo.ourScore != null && jogo.theirScore != null;
  const cancelado = jogo.status === "CANCELLED";
  const venceu = jogado && jogo.ourScore! > jogo.theirScore!;
  const perdeu = jogado && jogo.ourScore! < jogo.theirScore!;

  return (
    <li className={`grid grid-cols-[3.5rem_1fr_auto] items-center gap-4 py-4 sm:grid-cols-[4.5rem_1fr_auto] ${cancelado ? "opacity-60" : ""}`}>
      <time dateTime={isoDia(jogo.startsAt)} className="text-center">
        <span className="display block text-2xl text-ink sm:text-3xl">{dia}</span>
        <span className="block text-[0.6875rem] font-bold tracking-wider text-ink-3">
          {mes} · {semana}
        </span>
      </time>
      <div className="min-w-0">
        <p className="eyebrow text-ink-3">{[jogo.teamName, jogo.competition, jogo.roundLabel].filter(Boolean).join(" · ")}</p>
        <p className="mt-1 font-semibold leading-snug text-ink">
          {jogo.isHome ? (
            <>
              {clube.shortName} <span className="text-ink-4">vs</span> {jogo.opponent}
            </>
          ) : (
            <>
              {jogo.opponent} <span className="text-ink-4">vs</span> {clube.shortName}
            </>
          )}
        </p>
        <p className="mt-0.5 truncate text-sm text-ink-3">
          {jogo.venue}
          {jogo.isHome ? "" : " · fora"}
        </p>
      </div>
      <div className="text-right">
        {cancelado ? (
          <span className="text-sm font-semibold text-risk">Cancelado</span>
        ) : jogado ? (
          <span
            className={`display inline-block rounded-sm px-2 py-1 text-xl tabular ${venceu ? "bg-ok/10 text-ok" : perdeu ? "bg-risk/10 text-risk" : "bg-sunken text-ink"}`}
          >
            {jogo.isHome ? `${jogo.ourScore}:${jogo.theirScore}` : `${jogo.theirScore}:${jogo.ourScore}`}
          </span>
        ) : (
          <>
            <span className="display block text-xl text-ink">{hora(jogo.startsAt)}</span>
            {jogo.tickets?.open && (
              <Link href={`/bilheteira/${jogo.id}`} className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-signal-ink hover:underline">
                <Ticket size={13} aria-hidden />
                Bilhetes
              </Link>
            )}
          </>
        )}
      </div>
    </li>
  );
}
