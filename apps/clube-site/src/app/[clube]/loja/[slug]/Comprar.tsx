"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Check, Mail, Minus, Plus, ShoppingBag } from "lucide-react";
import type { Produto } from "@/dados/tipos";
import { Botao, BotaoLink } from "@/componentes/Botao";
import { MAXIMO_POR_LINHA, esgotado, fraseDoStock, juntarAoCarrinho } from "@/lib/loja";

/**
 * Tamanho, quantidade e juntar ao carrinho.
 *
 * O tamanho é um grupo de botões e não um `<select>`: num telemóvel vê-se
 * tudo de uma vez e escolhe-se com um toque. Um tamanho esgotado fica na
 * lista, riscado, em vez de desaparecer: quem procura o L quer saber que
 * não há, não que nunca existiu.
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
  const [juntou, setJuntou] = useState<number | null>(null);

  const tudoEsgotado = esgotado(produto);
  const disponivel = (t: string) => produto.stock?.[t];
  const semStock = (t: string) => {
    const d = disponivel(t);
    return typeof d === "number" && d <= 0;
  };
  const maximo = tamanho === null ? MAXIMO_POR_LINHA : Math.min(MAXIMO_POR_LINHA, typeof disponivel(tamanho) === "number" ? (disponivel(tamanho) as number) : MAXIMO_POR_LINHA);

  const juntar = (eDepoisPagar: boolean) => {
    if (tamanho === null) {
      setAviso("Escolhe o tamanho.");
      return;
    }
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
    setJuntou(r.naLinha);
    window.setTimeout(() => setJuntou(null), 3000);
  };

  return (
    <div className="mt-8">
      {tamanhos.length > 0 && (
        <fieldset>
          <legend className="text-sm font-semibold text-ink">
            {produto.variants!.name}
            {tamanho && <span className="ml-2 font-normal text-ink-3">{tamanho}</span>}
          </legend>
          <div className="mt-3 flex flex-wrap gap-2">
            {tamanhos.map((o) => {
              const ativo = tamanho === o;
              const fora = semStock(o);
              return (
                <button
                  key={o}
                  type="button"
                  aria-pressed={ativo}
                  aria-label={fora ? `${o}, esgotado` : o}
                  disabled={fora && !compraOnline}
                  onClick={() => {
                    setTamanho(o);
                    setAviso(fora ? "Este tamanho esgotou." : null);
                    setQtd(1);
                  }}
                  className={`inline-flex h-11 min-w-11 items-center justify-center rounded-control border px-3 text-sm font-semibold transition ${
                    ativo ? "border-ink bg-ink text-canvas" : fora ? "border-line text-ink-4 line-through" : "border-line-strong bg-surface text-ink hover:border-ink"
                  }`}
                >
                  {o}
                </button>
              );
            })}
          </div>
          {tamanho && compraOnline && fraseDoStock(disponivel(tamanho)) && !semStock(tamanho) && (
            <p className="mt-2 text-sm font-semibold text-warn">{fraseDoStock(disponivel(tamanho))}</p>
          )}
        </fieldset>
      )}
      {tamanhos.length === 0 && compraOnline && fraseDoStock(disponivel("")) && !tudoEsgotado && <p className="text-sm font-semibold text-warn">{fraseDoStock(disponivel(""))}</p>}

      {!compraOnline ? (
        <div className="mt-6">
          {tudoEsgotado ? (
            <Botao disabled variante="contorno" className="w-full sm:w-auto">
              Esgotado
            </Botao>
          ) : (
            <BotaoLink href="/contactos?assunto=Loja%20e%20encomendas" className="w-full sm:w-auto">
              <Mail size={18} aria-hidden />
              Encomendar pelos contactos
            </BotaoLink>
          )}
          <p className="mt-4 text-sm text-ink-3">A compra online ainda não está aberta neste clube. Encomenda pelos contactos ou na sede.</p>
        </div>
      ) : tudoEsgotado ? (
        <div className="mt-6">
          <Botao disabled variante="contorno" className="w-full sm:w-auto">
            Esgotado
          </Botao>
          <p className="mt-4 text-sm text-ink-3">Volta a passar por aqui: o clube repõe o stock quando chega.</p>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-control border border-line-strong" role="group" aria-label="Quantidade">
              <button type="button" onClick={() => setQtd((q) => Math.max(1, q - 1))} disabled={qtd <= 1} aria-label="Menos um" className="grid size-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30">
                <Minus size={16} />
              </button>
              <output className="w-10 text-center font-semibold tabular text-ink" aria-live="polite">
                {qtd}
              </output>
              <button type="button" onClick={() => setQtd((q) => Math.min(maximo, q + 1))} disabled={qtd >= maximo} aria-label="Mais um" className="grid size-11 place-items-center text-ink transition hover:bg-sunken disabled:opacity-30">
                <Plus size={16} />
              </button>
            </div>
            <Botao onClick={() => juntar(false)} disabled={tamanho !== null && semStock(tamanho)} className="flex-1 sm:flex-none">
              {juntou !== null ? <Check size={18} aria-hidden /> : <ShoppingBag size={18} aria-hidden />}
              {juntou !== null ? "No carrinho" : "Juntar ao carrinho"}
            </Botao>
            <Botao variante="contorno" onClick={() => juntar(true)} disabled={tamanho !== null && semStock(tamanho)} className="w-full sm:w-auto">
              Comprar agora
            </Botao>
          </div>
          {aviso && (
            <p role="alert" className="text-sm font-semibold text-risk">
              {aviso}
            </p>
          )}
          {juntou !== null && (
            <p role="status" className="text-sm text-ink-2">
              {juntou === 1 ? "Uma unidade" : `${juntou} unidades`} no carrinho.{" "}
              <a href="/loja/carrinho" className="font-semibold text-signal-ink hover:underline">
                Ver o carrinho
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
