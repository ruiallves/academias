import Image from "next/image";
import Link from "next/link";
import type { Produto } from "@/dados/tipos";
import { euro } from "@/lib/formatar";

/** Um produto na montra: foto ao alto, nome, preço. Esgotado diz-se na foto. */
export function CartaoProduto({ produto, prioridade = false }: { produto: Produto; prioridade?: boolean }) {
  return (
    <article className="group">
      <Link href={`/loja/${produto.slug}`} className="block">
        <div className="relative aspect-[9/11] overflow-hidden rounded-card bg-sunken">
          <Image
            src={produto.image}
            alt={produto.name}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            priority={prioridade}
            className={`object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] ${produto.soldOut ? "opacity-60" : ""}`}
          />
          {produto.soldOut && (
            <span className="absolute left-3 top-3 rounded-sm bg-night px-2 py-1 text-xs font-bold uppercase tracking-wider text-night-ink">
              Esgotado
            </span>
          )}
        </div>
        <p className="eyebrow mt-3 text-ink-3">{produto.category}</p>
        <h3 className="mt-1 text-base leading-snug text-ink transition group-hover:text-signal-ink">{produto.name}</h3>
        <p className="mt-1 font-semibold tabular text-ink">{euro(produto.price)}</p>
      </Link>
    </article>
  );
}
