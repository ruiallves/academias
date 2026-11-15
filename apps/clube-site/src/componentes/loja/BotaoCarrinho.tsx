"use client";

import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { quantidadeNoCarrinho } from "@/lib/loja";
import { useCarrinho } from "@/lib/carrinho";

/**
 * O carrinho no cabeçalho, ao lado da Loja: o ícone com o número de artigos.
 *
 * Só aparece com artigos lá dentro. Até 15/11 era o próprio atalho da Loja que
 * passava a "Carrinho", e com algo no carrinho a Loja deixava de estar no
 * cabeçalho. Agora a Loja fica sempre e o carrinho junta-se a ela. O servidor
 * não conhece o carrinho, por isso só aparece depois de hidratar.
 */
export function BotaoCarrinho({ slug, className, rotulo = true, tamanho = 15 }: { slug: string; className: string; rotulo?: boolean; tamanho?: number }) {
  const n = quantidadeNoCarrinho(useCarrinho(slug));
  if (n === 0) return null;
  return (
    <Link href="/loja/carrinho" aria-label={`Carrinho, ${n} ${n === 1 ? "artigo" : "artigos"}`} className={`relative ${className}`}>
      <span className="relative inline-flex" aria-hidden>
        <ShoppingCart size={tamanho} />
        <span className="absolute -right-2 -top-1.5 grid min-w-4 place-items-center rounded-full bg-signal-strong px-1 text-[0.625rem] font-bold leading-4 text-signal-on tabular">
          {n > 9 ? "9+" : n}
        </span>
      </span>
      {rotulo && <span className="hidden sm:inline">Carrinho</span>}
    </Link>
  );
}
