import Link from "next/link";
import { Foto } from "@/componentes/Foto";
import type { Produto } from "@/dados/tipos";
import { euro } from "@/lib/formatar";
import { esgotado, fotosDoProduto, poucasUnidades } from "@/lib/loja";

/**
 * Um produto na montra, ao jeito das lojas de desporto: a fotografia manda,
 * sem moldura, e o texto vem por baixo, curto. Com uma segunda fotografia,
 * o rato troca para ela. Por cima do nome, uma nota só quando diz alguma
 * coisa (esgotado, últimas unidades); sem cápsulas nem etiquetas pintadas.
 */
export function CartaoProduto({ produto: p, prioridade = false, sizes }: { produto: Produto; prioridade?: boolean; sizes?: string }) {
  const fora = esgotado(p);
  const [principal, segunda] = fotosDoProduto(p);
  const nota = fora ? "Esgotado" : poucasUnidades(p) ? "Últimas unidades" : null;
  const tamanhos = p.variants?.options.length ?? 0;
  const tam = sizes ?? "(min-width: 1024px) 33vw, 50vw";

  return (
    <article className="group">
      <Link href={`/loja/${p.slug}`} className="block focus-visible:outline-offset-4">
        <div className="relative aspect-[4/5] overflow-hidden bg-sunken">
          <Foto
            src={principal}
            alt={p.name}
            sizes={tam}
            priority={prioridade}
            className={`transition duration-700 ease-out group-hover:scale-[1.04] ${segunda ? "group-hover:opacity-0" : ""} ${fora ? "opacity-55 grayscale" : ""}`}
          />
          {segunda && <Foto src={segunda} alt="" sizes={tam} className="opacity-0 transition-opacity duration-500 group-hover:opacity-100" />}
        </div>
        <div className="mt-3 pr-2">
          {nota && <p className={`text-sm font-semibold ${fora ? "text-ink-3" : "text-signal-ink"}`}>{nota}</p>}
          <h3 className="text-[0.9375rem] font-semibold leading-snug text-ink sm:text-base">{p.name}</h3>
          <p className="mt-0.5 text-sm text-ink-3">
            {p.category}
            {tamanhos > 1 && <span className="hidden sm:inline"> · {tamanhos} tamanhos</span>}
          </p>
          <p className="mt-2 font-semibold tabular text-ink">{euro(p.price)}</p>
        </div>
      </Link>
    </article>
  );
}
