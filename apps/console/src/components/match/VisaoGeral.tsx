import type { ReactNode } from "react";
import { cx } from "@/components/primitives";
import { ArrowRight, Check, ChevronRight } from "@/lib/icons";
import { Anel, Cartao, CartaoTopo, Facto } from "./ui";

/**
 * A visão geral de um jogo: o que falta, quem joga, e os dados do jogo.
 *
 * É a página de entrada do jogo e responde a três perguntas, por esta ordem: o
 * que tenho de fazer a seguir, quem vai jogar, e contra quem. Cada bloco leva à
 * área onde se trabalha; aqui não se preenche nada.
 */

export type Passo<A extends string> = {
  feito: boolean;
  texto: string;
  area: A;
  areaNome: string;
  bloqueado?: boolean;
  /** Quando o passo se faz noutra página (a convocatória), o gesto é este e não abrir a área. */
  ir?: () => void;
};

export function VisaoGeral<A extends string>({
  passos,
  onIr,
  onze,
  onzeApoio,
  onzeArea,
  factos,
  adversario,
  extra,
}: {
  passos: Passo<A>[];
  onIr: (area: A) => void;
  /** O campo com o onze, ou nulo quando ainda não há plano. */
  onze: ReactNode | null;
  onzeApoio: string;
  onzeArea: A;
  factos: { rotulo: string; valor: ReactNode }[];
  /** O resumo do adversário (um cartão), já desenhado pela página. */
  adversario?: ReactNode;
  /** A equipa de trabalho e o que mais houver. */
  extra?: ReactNode;
}) {
  const feitos = passos.filter((p) => p.feito).length;
  const proximo = passos.find((p) => !p.feito && !p.bloqueado);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,1fr)]">
      {/* ------------------------------------------------------------ o que falta */}
      <Cartao className="lg:col-span-2 xl:col-span-1">
        <div className="flex items-center gap-4 px-5 pt-5 pb-4">
          <Anel valor={feitos} total={passos.length} tamanho={58} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] leading-tight font-semibold tracking-[-0.01em] text-ink">{proximo ? "A seguir" : "Está tudo feito"}</h3>
            <p className="mt-0.5 truncate text-body text-ink-2">{proximo ? proximo.texto : "Não há mais nada por fazer neste jogo."}</p>
          </div>
          {proximo && (
            <button type="button" className="ctl-primary h-9 shrink-0" onClick={() => (proximo.ir ? proximo.ir() : onIr(proximo.area))}>
              Fazer
              <ArrowRight className="size-3.5" strokeWidth={2} />
            </button>
          )}
        </div>
        <ol className="px-2 pb-2">
          {passos.map((p) => (
            <li key={p.texto}>
              <button type="button" onClick={() => (p.ir ? p.ir() : onIr(p.area))} className="group flex w-full items-center gap-3 rounded-[12px] px-3 py-2 text-left transition-colors hover:bg-sunken/60">
                <span className={cx("flex size-5 shrink-0 items-center justify-center rounded-full", p.feito ? "bg-ok text-white" : "border border-line-strong text-transparent")}>
                  <Check className="size-3" strokeWidth={3} />
                </span>
                <span className={cx("min-w-0 flex-1 truncate text-body", p.feito ? "text-ink-3" : p.bloqueado ? "text-ink-4" : "font-medium text-ink")}>{p.texto}</span>
                <span className="shrink-0 text-[11.5px] text-ink-4">{p.bloqueado ? "depois do jogo" : p.areaNome}</span>
                <ChevronRight className="size-3.5 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2" strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ol>
      </Cartao>

      {/* ------------------------------------------------------------ quem joga */}
      <Cartao>
        <CartaoTopo titulo="Quem joga" apoio={onzeApoio}>
          <button type="button" className="ctl-ghost h-8" onClick={() => onIr(onzeArea)}>
            {onze ? "Abrir" : "Montar"}
            <ChevronRight className="size-3.5" strokeWidth={1.75} />
          </button>
        </CartaoTopo>
        <div className="px-5 pb-5">
          {onze ?? (
            <button
              type="button"
              onClick={() => onIr(onzeArea)}
              className="flex aspect-[68/100] w-full flex-col items-center justify-center gap-1 rounded-[18px] border border-dashed border-line-strong text-center transition-colors hover:border-ink-3"
            >
              <span className="text-body font-medium text-ink">Ainda sem equipa inicial</span>
              <span className="max-w-[200px] text-meta text-ink-3">Monta a equipa no Pré-jogo, no campo.</span>
            </button>
          )}
        </div>
      </Cartao>

      {/* ------------------------------------------------------------ o jogo e o adversário */}
      <div className="space-y-4">
        <Cartao>
          <CartaoTopo titulo="O jogo" />
          <dl className="px-5 pb-3">
            {factos.map((f) => (
              <Facto key={f.rotulo} rotulo={f.rotulo}>
                {f.valor}
              </Facto>
            ))}
          </dl>
        </Cartao>
        {adversario}
        {extra}
      </div>
    </div>
  );
}
