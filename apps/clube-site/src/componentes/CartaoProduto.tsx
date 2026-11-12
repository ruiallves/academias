import Link from "next/link";
import { Foto } from "@/componentes/Foto";
import type { Produto } from "@/dados/tipos";
import { euro } from "@/lib/formatar";
import { esgotado, fotosDoProduto, percentagemDePromocao, poucasUnidades } from "@/lib/loja";

/**
 * Um produto na montra, ao jeito das lojas de roupa desportiva: a fotografia
 * manda, sem moldura, e o texto vem por baixo, curto. Com uma segunda
 * fotografia, o rato troca para ela. No canto da foto, uma etiqueta só
 * quando diz alguma coisa (esgotado, a promoção, novidade), uma de cada vez.
 * Em promoção, o preço de antes fica riscado ao lado.
 */
export function CartaoProduto({ produto: p, prioridade = false, sizes }: { produto: Produto; prioridade?: boolean; sizes?: string }) {
  const fora = esgotado(p);
  const [principal, segunda] = fotosDoProduto(p);
  const promocao = percentagemDePromocao(p);
  const etiqueta = fora ? "Esgotado" : promocao ? `−${promocao} %` : p.isNew ? "Novidade" : null;
  const nota = !fora && poucasUnidades(p) ? "Últimas unidades" : null;
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
            className={`transition duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100 ${segunda ? "group-hover:opacity-0" : ""} ${fora ? "opacity-60 grayscale" : ""}`}
          />
          {segunda && <Foto src={segunda} alt="" sizes={tam} className="opacity-0 transition-opacity duration-500 group-hover:opacity-100" />}
          {etiqueta && (
            <span
              className={`absolute left-2.5 top-2.5 px-2 py-1 text-[0.6875rem] font-bold uppercase leading-none tracking-[0.06em] sm:left-3 sm:top-3 ${
                promocao && !fora ? "bg-signal-strong text-signal-on" : "bg-surface text-ink ring-1 ring-ink/15"
              }`}
            >
              {etiqueta}
            </span>
          )}
        </div>
        <div className="mt-3 pr-2">
          <h3 className="text-[0.9375rem] font-semibold leading-snug text-ink sm:text-base">{p.name}</h3>
          <p className="mt-0.5 text-sm text-ink-3">
            {p.category}
            {tamanhos > 1 && <span className="hidden sm:inline">{p.category ? " · " : ""}{tamanhos} tamanhos</span>}
          </p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-2 tabular">
            <span className={`font-semibold ${promocao ? "text-signal-ink" : "text-ink"}`}>{euro(p.price)}</span>
            {promocao && p.compareAtPrice && (
              <s className="text-sm text-ink-3">
                <span className="sr-only">Antes </span>
                {euro(p.compareAtPrice)}
              </s>
            )}
          </p>
          {nota && <p className="mt-1 text-sm font-semibold text-signal-ink">{nota}</p>}
        </div>
      </Link>
    </article>
  );
}
