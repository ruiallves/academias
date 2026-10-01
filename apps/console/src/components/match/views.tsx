import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cx } from "@/components/primitives";
import { ArrowRight, ChevronRight, Clock, MapPin } from "@/lib/icons";
import { Anel, Cartao, Emblema, EstadoChip, type Tom } from "./ui";

/**
 * As vistas grandes do Match Center, só de desenho: o cabeçalho de um jogo, o
 * destaque do próximo jogo na lista, e a linha de cada jogo.
 */

export type EstadoDoJogo = { chave: string; texto: string; tom: Tom };

/**
 * O cabeçalho de um jogo.
 *
 * Os dois emblemas, os dois nomes, e ao centro o que interessa agora: a hora
 * antes do jogo, o resultado depois. `centro` é da página, porque depois do
 * apito é ali que se escreve o resultado.
 */
export function CabecalhoDoJogo({
  equipa,
  adversario,
  emCasa,
  logo,
  contexto,
  estado,
  centro,
  rodape,
}: {
  equipa: string;
  adversario: string;
  emCasa: boolean;
  logo?: string | null;
  /** A prova e a jornada, por cima. */
  contexto: string;
  estado: EstadoDoJogo;
  centro: ReactNode;
  /** A linha de baixo: data, local e o que mais houver. */
  rodape?: ReactNode;
}) {
  const nos = <Lado nome={equipa} sub={emCasa ? "Casa" : "Fora"} logo={logo} nosso />;
  const eles = <Lado nome={adversario} sub={emCasa ? "Fora" : "Casa"} />;
  return (
    <Cartao className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4 sm:px-7">
        <span className="min-w-0 truncate text-meta font-medium text-ink-3">{contexto}</span>
        <EstadoChip texto={estado.texto} tom={estado.tom} grande />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 px-4 pt-5 pb-6 sm:items-center sm:gap-8 sm:px-7">
        {emCasa ? nos : eles}
        <div className="flex min-w-[104px] flex-col items-center gap-1.5 text-center max-sm:pt-2 sm:min-w-[120px] [&_.placar]:max-sm:text-[38px]">{centro}</div>
        {emCasa ? eles : nos}
      </div>

      {rodape && <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 border-t border-line bg-sunken/40 px-5 py-3 text-meta text-ink-2">{rodape}</div>}
    </Cartao>
  );
}

function Lado({ nome, sub, logo, nosso }: { nome: string; sub: string; logo?: string | null; nosso?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2.5 text-center">
      <span className="sm:hidden">
        <Emblema nome={nome} logo={logo} nosso={nosso} tamanho={48} />
      </span>
      <span className="max-sm:hidden">
        <Emblema nome={nome} logo={logo} nosso={nosso} tamanho={64} />
      </span>
      <div className="min-w-0 max-w-full">
        {/* No telemóvel o nome parte em duas linhas em vez de ser cortado. */}
        <div className={cx("line-clamp-2 text-[14px] leading-tight tracking-[-0.01em] [overflow-wrap:anywhere] sm:text-[19px]", nosso ? "font-semibold text-ink" : "font-medium text-ink")}>{nome}</div>
        <div className="mt-0.5 text-meta text-ink-3">{sub}</div>
      </div>
    </div>
  );
}

/** O que a lista mostra de um jogo. */
export type JogoNaLista = {
  id: string;
  equipa: string;
  adversario: string;
  emCasa: boolean;
  prova: string | null;
  inicio: Date;
  local: string;
  estado: EstadoDoJogo;
  /** Nulo antes de haver resultado. */
  resultado: { nos: number; eles: number; desfecho: "win" | "draw" | "loss" } | null;
  /** Os passos da preparação, feitos ou não, pela ordem. */
  preparacao: boolean[];
  cancelado: boolean;
  passado: boolean;
  funcao?: string | null;
};

const hora = (d: Date) => d.toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" });
const diaLongo = (d: Date) => {
  const t = d.toLocaleDateString("pt-PT", { weekday: "long", day: "numeric", month: "long" });
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/** "daqui a 2 dias", "amanhã", "hoje às 15:30". */
export function quandoE(d: Date, agora = new Date()): string {
  const dias = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime()) / 86_400_000);
  if (dias === 0) return `hoje às ${hora(d)}`;
  if (dias === 1) return `amanhã às ${hora(d)}`;
  if (dias > 1) return `daqui a ${dias} dias`;
  if (dias === -1) return "ontem";
  return `há ${-dias} dias`;
}

const PASSOS = ["Convocatória", "Equipa inicial", "Suplentes", "Adversário"];

/**
 * O próximo jogo, em destaque no topo da lista.
 *
 * É a resposta à primeira pergunta de quem abre os Jogos: o que vem a seguir, e
 * o que falta preparar. O resto da lista são linhas.
 */
export function ProximoJogo({ jogo, logo }: { jogo: JogoNaLista; logo?: string | null }) {
  const feitos = jogo.preparacao.filter(Boolean).length;
  return (
    <Cartao className="overflow-hidden">
      <div className="grid gap-x-8 gap-y-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-meta font-semibold text-ink">Próximo jogo</span>
            <span className="text-meta text-ink-3">{quandoE(jogo.inicio)}</span>
            <EstadoChip texto={jogo.estado.texto} tom={jogo.estado.tom} />
          </div>

          <div className="mt-4 flex items-center gap-4">
            <span className="flex items-center">
              <Emblema nome={jogo.equipa} logo={logo} nosso tamanho={52} />
              <span className="-ml-2 rounded-[16px] ring-4 ring-surface">
                <Emblema nome={jogo.adversario} tamanho={52} />
              </span>
            </span>
            <div className="min-w-0">
              <div className="truncate text-[22px] leading-tight font-semibold tracking-[-0.02em] text-ink sm:text-[26px]">
                {jogo.emCasa ? "vs" : "em"} {jogo.adversario}
              </div>
              <div className="mt-0.5 truncate text-body text-ink-3">{[jogo.equipa, jogo.prova].filter(Boolean).join(" · ")}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-meta text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 text-ink-4" strokeWidth={1.75} />
              {diaLongo(jogo.inicio)}, {hora(jogo.inicio)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="size-3.5 text-ink-4" strokeWidth={1.75} />
              {jogo.local} · {jogo.emCasa ? "em casa" : "fora"}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 lg:flex-col lg:items-stretch lg:border-l lg:border-line lg:pl-8">
          <div className="flex items-center gap-3.5">
            <Anel valor={feitos} total={jogo.preparacao.length} tamanho={52} />
            <ul className="space-y-1">
              {PASSOS.map((p, i) => (
                <li key={p} className={cx("flex items-center gap-1.5 text-meta", jogo.preparacao[i] ? "text-ink-3" : "font-medium text-ink")}>
                  <span className={cx("size-1.5 rounded-full", jogo.preparacao[i] ? "bg-ok" : "bg-line-strong")} />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <Link to={`/jogos/${jogo.id}`} className="ctl-primary h-10 justify-center px-4">
            {feitos < jogo.preparacao.length ? "Preparar o jogo" : "Abrir o jogo"}
            <ArrowRight className="size-3.5" strokeWidth={2} />
          </Link>
        </div>
      </div>
    </Cartao>
  );
}

/**
 * Uma linha da lista de jogos.
 *
 * A data à esquerda, numa pastilha; o adversário com o emblema e, por baixo, a
 * equipa e a prova; a hora e o campo; e à direita o que interessa agora: a
 * preparação antes do jogo, o resultado depois.
 */
export function LinhaDeJogo({ jogo }: { jogo: JogoNaLista }) {
  const feitos = jogo.preparacao.filter(Boolean).length;
  const r = jogo.resultado;
  return (
    <li className="border-b border-line last:border-b-0">
      <Link to={`/jogos/${jogo.id}`} className="group flex items-center gap-3 px-3.5 py-3 transition-colors duration-150 hover:bg-sunken/50 sm:gap-4 sm:px-5">
        {/* A data. */}
        <span className={cx("flex size-12 shrink-0 flex-col items-center justify-center rounded-[14px]", jogo.cancelado ? "bg-sunken/60 text-ink-4" : "bg-sunken text-ink")}>
          <span className="text-[17px] leading-none font-semibold tabular">{jogo.inicio.getDate()}</span>
          <span className="mt-0.5 text-[10px] leading-none font-medium text-ink-3 uppercase">{jogo.inicio.toLocaleDateString("pt-PT", { weekday: "short" }).replace(".", "").slice(0, 3)}</span>
        </span>

        {/* O adversário. No telemóvel o emblema sai, para o nome caber. */}
        <span className="max-sm:hidden">
          <Emblema nome={jogo.adversario} tamanho={40} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-[15px] leading-tight font-semibold tracking-[-0.01em]", jogo.cancelado ? "text-ink-4 line-through" : "text-ink")}>
            <span className="font-normal text-ink-3">{jogo.emCasa ? "vs " : "em "}</span>
            {jogo.adversario}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-meta text-ink-3">
            <span className="truncate">{[jogo.equipa, jogo.prova].filter(Boolean).join(" · ")}</span>
            {jogo.funcao && <span className="shrink-0 rounded-full bg-signal-soft px-2 py-px text-[11px] font-medium text-signal-ink">{jogo.funcao}</span>}
          </span>
        </span>

        {/* A hora e o campo. */}
        <span className="hidden w-[190px] shrink-0 lg:block">
          <span className="block text-body font-medium text-ink tabular">{hora(jogo.inicio)}</span>
          <span className="block truncate text-meta text-ink-3">{jogo.local}</span>
        </span>

        <span className="hidden w-[150px] shrink-0 justify-end sm:flex">
          <EstadoChip texto={jogo.estado.texto} tom={jogo.estado.tom} />
        </span>

        {/* À direita: o resultado depois do jogo, a preparação antes. */}
        <span className="flex w-[52px] shrink-0 items-center justify-end sm:w-[74px]">
          {jogo.cancelado ? null : r ? (
            <span
              className={cx(
                "rounded-[10px] px-2.5 py-1.5 text-[15px] leading-none font-semibold tabular",
                r.desfecho === "win" ? "bg-ok-soft text-ok" : r.desfecho === "loss" ? "bg-risk-soft text-risk" : "bg-sunken text-ink-2",
              )}
            >
              {r.nos}–{r.eles}
            </span>
          ) : jogo.passado ? (
            <span className="text-meta text-ink-4">–</span>
          ) : (
            <span title={PASSOS.map((p, i) => `${p}: ${jogo.preparacao[i] ? "feito" : "por fazer"}`).join("\n")}>
              <Anel valor={feitos} total={jogo.preparacao.length} tamanho={38} />
            </span>
          )}
        </span>

        <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-ink-2 max-sm:hidden" strokeWidth={1.75} />
      </Link>
    </li>
  );
}
