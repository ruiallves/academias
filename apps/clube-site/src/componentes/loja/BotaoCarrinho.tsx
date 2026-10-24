"use client";

import Link from "next/link";
import { ShoppingBag } from "lucide-react";
import { quantidadeNoCarrinho } from "@/lib/loja";
import { useCarrinho } from "@/lib/carrinho";

/**
 * O carrinho no cabeçalho: o ícone da loja com o número de artigos por cima.
 * Com o carrinho vazio é só o atalho para a loja de sempre. O número só
 * aparece depois de hidratar (o servidor não conhece o carrinho).
 */
export function BotaoCarrinho({ slug, className, rotulo = true, tamanho = 15 }: { slug: string; className: string; rotulo?: boolean; tamanho?: number }) {
  const n = quantidadeNoCarrinho(useCarrinho(slug));
  return (
    <Link href={n > 0 ? "/loja/carrinho" : "/loja"} aria-label={n > 0 ? `Carrinho, ${n} ${n === 1 ? "artigo" : "artigos"}` : "Loja"} className={`relative ${className}`}>
      <span className="relative inline-flex" aria-hidden>
        <ShoppingBag size={tamanho} />
        {n > 0 && (
          <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-signal-strong px-1 text-[0.625rem] font-bold leading-4 text-signal-on tabular">
            {n > 9 ? "9+" : n}
          </span>
        )}
      </span>
      {rotulo && <span className="hidden sm:inline">{n > 0 ? "Carrinho" : "Loja"}</span>}
    </Link>
  );
}
