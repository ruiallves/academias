"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";
import type { Produto } from "@/dados/tipos";
import { Foto } from "@/componentes/Foto";
import { botaoLoja, botaoLojaContorno } from "@/componentes/loja/botoes";
import { euro } from "@/lib/formatar";
import { useCarrinho } from "@/lib/carrinho";
import { MAXIMO_POR_LINHA, esgotado, fraseDoStock, juntarAoCarrinho, quantidadeNoCarrinho } from "@/lib/loja";

/**
 * Tamanho, quantidade e juntar ao carrinho.
 *
 * O tamanho é uma grelha de botões e não um `<select>`: num telemóvel vê-se
 * tudo de uma vez e escolhe-se com um toque. Um tamanho esgotado fica na
 * grelha, riscado, em vez de desaparecer: quem procura o L quer saber que
 * não há, não que nunca existiu.
 *
 * Ao juntar, um aviso desce do topo com o artigo e o caminho para pagar,
 * como nas lojas de desporto: quem quer continuar a ver fecha-o, ou ele
 * sai sozinho. No telemóvel, enquanto o botão ainda está abaixo do ecrã (a
 * fotografia ocupa-o todo), uma barra no fundo leva o preço e o botão.
 *
 * Sem compra online (o clube não tem pagamentos ou entrega ligados), a
 * encomenda vai pelos contactos do clube, com o assunto já escolhido.
 */
export function Comprar({ slug, produto, compraOnline }: { slug: string; produto: Produto; compraOnline: boolean }) {
  const router = useRouter();
  const tamanhos = produto.variants?.options ?? [];
  const [tamanho, setTamanho] = useState<string | null>(tamanhos.length === 0 ? "" : tamanhos.length === 1 ? tamanhos[0] : null);
  const [qtd, setQtd] = useState(1);
  const [aviso, setAviso] = useState<string | null>(null);
  const [falta, setFalta] = useState(false);
  const [juntou, setJuntou] = useState<{ tamanho: string; qtd: number } | null>(null);
  const [barra, setBarra] = useState(false);
  const grelha = useRef<HTMLFieldSetElement>(null);
  const botoes = useRef<HTMLDivElement>(null);
  const noCarrinho = quantidadeNoCarrinho(useCarrinho(slug));

  const tudoEsgotado = esgotado(produto);
  const disponivel = (t: string) => produto.stock?.[t];
  const semStock = (t: string) => {
    const d = disponivel(t);
    return typeof d === "number" && d <= 0;
  };
  const maximo = tamanho === null ? MAXIMO_POR_LINHA : Math.min(MAXIMO_POR_LINHA, typeof disponivel(tamanho) === "number" ? (disponivel(tamanho) as number) : MAXIMO_POR_LINHA);
  const frase = tamanho !== null && compraOnline && !semStock(tamanho) ? fraseDoStock(disponivel(tamanho)) : null;
  const vende = compraOnline && !tudoEsgotado;

  // A barra do telemóvel: só enquanto os botões estão abaixo do ecrã. Conta-se
  // ao rolar, e não com um IntersectionObserver: esse não avisa num salto de
  // "acima do ecrã" para "abaixo do ecrã" (tocar no relógio do iPhone volta ao topo).
  useEffect(() => {
    const el = botoes.current;
    if (!el || !vende) return;
    let pedido = 0;
    const ver = () => {
      pedido = 0;
      setBarra(el.getBoundingClientRect().top > window.innerHeight);
    };
    const agendar = () => {
      if (!pedido) pedido = window.requestAnimationFrame(ver);
    };
    ver();
    window.addEventListener("scroll", agendar, { passive: true });
    window.addEventListener("resize", agendar);
    return () => {
      window.cancelAnimationFrame(pedido);
      window.removeEventListener("scroll", agendar);
      window.removeEventListener("resize", agendar);
    };
  }, [vende]);

  // O aviso de "no carrinho" sai sozinho, ou com Esc.
  useEffect(() => {
    if (!juntou) return;
    const t = window.setTimeout(() => setJuntou(null), 8000);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setJuntou(null);
    window.addEventListener("keydown", esc);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", esc);
    };
  }, [juntou]);

  const pedirTamanho = () => {
    setFalta(true);
    setAviso(`Escolhe o ${produto.variants?.name.toLowerCase() ?? "tamanho"}.`);
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    grelha.current?.scrollIntoView({ block: "center", behavior: suave ? "smooth" : "auto" });
  };

  const juntar = (eDepoisPagar: boolean) => {
    if (tamanho === null) return pedirTamanho();
    const r = juntarAoCarrinho(slug, produto, tamanho, qtd);
    if (!r.ok) {
      setAviso(r.erro);
      return;
    }
    setAviso(null);
    if (eDepoisPagar) {
      router.push("/loja/carrinho");
      return;
    }
    setJuntou({ tamanho, qtd });
  };

  return (
    <div className="mt-8">
      {tamanhos.length > 0 && (
        <fieldset ref={grelha} className="scroll-mt-[calc(var(--topo)+1rem)]">
          <legend className="text-[0.9375rem] font-semibold text-ink">
            {produto.variants!.name}
            {tamanho && <span className="font-normal text-ink-3">: {tamanho}</span>}
          </legend>
          <div className={`mt-3 grid grid-cols-4 gap-2 rounded-[4px] outline-offset-4 transition-[outline-color] sm:grid-cols-5 ${falta ? "outline outline-1 outline-risk" : ""}`}>
            {tamanhos.map((o) => {
              const ativo = tamanho === o;
              const fora = semStock(o);
              return (
                <button
                  key={o}
                  type="button"
                  aria-pressed={ativo}
                  aria-label={fora ? `${o}, esgotado` : o}
                  disabled={fora}
                  onClick={() => {
                    setTamanho(o);
                    setFalta(false);
                    setAviso(null);
                    setQtd(1);
                  }}
                  className={`h-12 rounded-[3px] border px-1 text-[0.9375rem] font-semibold tabular transition-[border-color,box-shadow,color] duration-150 ${
                    ativo
                      ? "border-ink bg-surface text-ink shadow-[inset_0_0_0_1px_var(--color-ink)]"
                      : fora
                        ? "tamanho-esgotado cursor-not-allowed border-line text-ink-4"
                        : "border-line-strong bg-surface text-ink hover:border-ink"
                  }`}
                >
                  {o}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {(frase || (tamanhos.length === 0 && compraOnline && !tudoEsgotado && fraseDoStock(disponivel("")))) && (
        <p className="mt-3 text-sm font-semibold text-warn">{frase ?? fraseDoStock(disponivel(""))}</p>
      )}
      {aviso && (
        <p role="alert" className="mt-3 text-sm font-semibold text-risk">
          {aviso}
        </p>
      )}

      {!compraOnline ? (
        <div className="mt-6">
          {tudoEsgotado ? (
            <button type="button" disabled className={`${botaoLojaContorno} w-full`}>
              Esgotado
            </button>
          ) : (
            <Link href="/contactos?assunto=Loja%20e%20encomendas" className={`${botaoLoja} w-full`}>
              Encomendar pelos contactos
            </Link>
          )}
          <p className="mt-4 text-sm text-ink-3">A compra online ainda não está aberta neste clube. Encomenda pelos contactos ou na sede.</p>
        </div>
      ) : tudoEsgotado ? (
        <div className="mt-6">
          <button type="button" disabled className={`${botaoLojaContorno} w-full`}>
            Esgotado
          </button>
          <p className="mt-4 text-sm text-ink-3">Volta a passar por aqui: o clube repõe o stock quando chega.</p>
        </div>
      ) : (
        <div ref={botoes} className="mt-6 space-y-3">
          <div className="flex gap-3">
            <div className="flex h-14 shrink-0 items-center rounded-[3px] border border-line-strong bg-surface" role="group" aria-label="Quantidade">
              <button type="button" onClick={() => setQtd((q) => Math.max(1, q - 1))} disabled={qtd <= 1} aria-label="Menos um" className="grid h-full w-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30">
                <Minus size={16} aria-hidden />
              </button>
              <output className="w-8 text-center font-semibold tabular text-ink" aria-live="polite">
                {qtd}
              </output>
              <button type="button" onClick={() => setQtd((q) => Math.min(maximo, q + 1))} disabled={qtd >= maximo} aria-label="Mais um" className="grid h-full w-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30">
                <Plus size={16} aria-hidden />
              </button>
            </div>
            <button type="button" onClick={() => juntar(false)} className={`${botaoLoja} min-w-0 flex-1 px-4`}>
              Juntar ao carrinho
            </button>
          </div>
          <button type="button" onClick={() => juntar(true)} className={`${botaoLojaContorno} w-full`}>
            Comprar agora
          </button>
        </div>
      )}

      {juntou && (
        <div
          role="status"
          className="fixed inset-x-2 top-[calc(var(--topo)+0.5rem)] z-[60] border border-line bg-surface p-5 shadow-card [animation:loja-descer_0.25s_var(--ease-out)] sm:left-auto sm:right-6 sm:w-[24rem]"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-semibold text-ink">
              <span className="grid size-6 place-items-center rounded-full bg-ok text-white">
                <Check size={14} strokeWidth={3} aria-hidden />
              </span>
              Juntaste ao carrinho
            </p>
            <button type="button" onClick={() => setJuntou(null)} aria-label="Fechar" className="-mr-2 grid size-11 place-items-center text-ink-3 transition hover:text-ink">
              <X size={20} aria-hidden />
            </button>
          </div>
          <div className="mt-3 flex gap-4">
            <div className="relative aspect-[4/5] w-20 shrink-0 overflow-hidden bg-sunken">
              <Foto src={produto.image} alt="" sizes="80px" />
            </div>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-ink">{produto.name}</p>
              <p className="mt-0.5 text-ink-3">
                {juntou.tamanho && `${produto.variants?.name ?? "Tamanho"} ${juntou.tamanho} · `}
                {juntou.qtd === 1 ? "1 unidade" : `${juntou.qtd} unidades`}
              </p>
              <p className="mt-1 font-semibold tabular text-ink">{euro(produto.price * juntou.qtd)}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-2">
            <Link href="/loja/carrinho" className={`${botaoLoja} w-full`}>
              Ver carrinho e pagar{noCarrinho > 0 ? ` (${noCarrinho})` : ""}
            </Link>
            <button type="button" onClick={() => setJuntou(null)} className="inline-flex h-11 items-center justify-center text-sm font-semibold text-ink underline decoration-1 underline-offset-4 hover:decoration-2">
              Continuar a ver a loja
            </button>
          </div>
        </div>
      )}

      {barra && vende && (
        <div className="fixed inset-x-0 bottom-0 z-[45] flex items-center gap-3 border-t border-line bg-canvas/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur [animation:loja-subir_0.25s_var(--ease-out)] lg:hidden">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{produto.name}</p>
            <p className="text-sm tabular text-ink-2">{euro(produto.price)}</p>
          </div>
          <button type="button" onClick={() => (tamanho === null ? pedirTamanho() : juntar(false))} className={`${botaoLoja} h-12 shrink-0 px-5`}>
            {tamanho === null ? `Escolher ${produto.variants?.name.toLowerCase() ?? "tamanho"}` : "Juntar ao carrinho"}
          </button>
        </div>
      )}
    </div>
  );
}
