import type { Metadata } from "next";
import Link from "next/link";
import { Check, ChevronDown } from "lucide-react";
import { fonte } from "@/dados/fonte";
import type { Produto } from "@/dados/tipos";
import { clubeOu404 } from "@/lib/clube";
import { esgotado } from "@/lib/loja";
import { CartaoProduto } from "@/componentes/CartaoProduto";
import { servicosDaLoja } from "@/componentes/loja/servicos";

export const revalidate = 60;

export const metadata: Metadata = { title: "Loja" };

type Props = { params: Promise<{ clube: string }>; searchParams: Promise<{ categoria?: string; ordem?: string }> };

const ORDENS = [
  { v: "", l: "Destaques" },
  { v: "preco-asc", l: "Preço mais baixo" },
  { v: "preco-desc", l: "Preço mais alto" },
] as const;

/** Pela ordem pedida, e os esgotados sempre no fim: primeiro o que se pode comprar. */
function ordenar(lista: Produto[], ordem: string): Produto[] {
  const comPosicao = lista.map((p, i) => ({ p, i, fora: esgotado(p) }));
  comPosicao.sort((a, b) => {
    if (a.fora !== b.fora) return a.fora ? 1 : -1;
    if (ordem === "preco-asc") return a.p.price - b.p.price || a.i - b.i;
    if (ordem === "preco-desc") return b.p.price - a.p.price || a.i - b.i;
    return a.i - b.i;
  });
  return comPosicao.map((x) => x.p);
}

/** O endereço da montra com um filtro e uma ordem. */
function endereco(categoria: string, ordem: string): string {
  const q = new URLSearchParams();
  if (categoria) q.set("categoria", categoria);
  if (ordem) q.set("ordem", ordem);
  return `/loja${q.size ? `?${q}` : ""}`;
}

/**
 * A loja, ao jeito das lojas de equipamento desportivo: o título, as
 * categorias em texto com a ordem num menu ao lado, e logo a grelha. No fim,
 * como se recebe e como se paga. O filtro e a ordem vivem no endereço, para
 * se poderem partilhar.
 */
export default async function Loja({ params, searchParams }: Props) {
  const clube = await clubeOu404(params);
  const { categoria = "", ordem: ordemPedida = "" } = await searchParams;
  const ordem = ORDENS.some((o) => o.v === ordemPedida) ? ordemPedida : "";
  const todos = await fonte.produtos(clube.slug);
  const categorias = [...new Set(todos.map((p) => p.category))];
  const lista = ordenar(categoria ? todos.filter((p) => p.category === categoria) : todos, ordem);
  const compraOnline = clube.loja?.compraOnline ?? false;
  const { entrega, pagamento } = servicosDaLoja(clube.loja);
  const servicos = [...entrega, pagamento ?? { titulo: "Encomendas pelos contactos", texto: "A compra online ainda não está aberta neste clube. Escreve ao clube ou passa pela sede." }];

  return (
    <>
      {clube.loja?.aviso && <p className="bg-sunken px-4 py-3 text-center text-sm font-medium text-ink">{clube.loja.aviso}</p>}

      <div className="container-site pt-10 sm:pt-14">
        <h1 className="titulo-loja text-[clamp(3rem,7vw,5.5rem)]">Veste o clube</h1>
        <p className="mt-4 max-w-xl text-[1.0625rem] text-ink-2">
          {compraOnline
            ? "Equipamento de jogo, roupa e artigos de adepto. O dinheiro de cada compra fica no clube."
            : "Equipamento de jogo, roupa e artigos de adepto. Por agora, encomenda pelos contactos do clube."}
        </p>

        <div className="mt-8 flex items-end justify-between gap-4 border-b border-line sm:mt-10">
          {categorias.length > 1 ? (
            <nav aria-label="Categorias" className="-mb-px min-w-0 overflow-x-auto [scrollbar-width:none]">
              <ul className="flex gap-7">
                {[{ c: "", l: "Tudo" }, ...categorias.map((c) => ({ c, l: c }))].map(({ c, l }) => {
                  const ativo = categoria === c;
                  return (
                    <li key={c}>
                      <Link
                        href={endereco(c, ordem)}
                        aria-current={ativo ? "page" : undefined}
                        className={`relative inline-flex h-12 items-center whitespace-nowrap text-[0.9375rem] font-semibold transition after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-signal after:transition-transform after:duration-200 ${
                          ativo ? "text-ink after:scale-x-100" : "text-ink-3 after:scale-x-0 hover:text-ink"
                        }`}
                      >
                        {l}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : (
            <p className="flex h-12 items-center text-[0.9375rem] font-semibold text-ink">
              {lista.length === 1 ? "1 artigo" : `${lista.length} artigos`}
            </p>
          )}
          {lista.length > 1 && (
            <details key={`${categoria}|${ordem}`} className="group/ordem relative shrink-0">
              <summary className="flex h-12 list-none items-center gap-1.5 text-[0.9375rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
                Ordenar
                <span className="hidden font-normal text-ink-3 sm:inline">: {ORDENS.find((o) => o.v === ordem)?.l}</span>
                <ChevronDown size={18} className="transition-transform group-open/ordem:rotate-180" aria-hidden />
              </summary>
              <ul className="absolute right-0 top-full z-20 mt-1 w-56 border border-line bg-surface py-2 shadow-card">
                {ORDENS.map((o) => (
                  <li key={o.v}>
                    <Link
                      href={endereco(categoria, o.v)}
                      aria-current={o.v === ordem ? "true" : undefined}
                      className={`flex h-11 items-center justify-between px-4 text-[0.9375rem] transition hover:bg-sunken ${o.v === ordem ? "font-semibold text-ink" : "text-ink-2"}`}
                    >
                      {o.l}
                      {o.v === ordem && <Check size={16} aria-hidden />}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {lista.length === 0 ? (
          <p className="mt-12 text-ink-3">{todos.length === 0 ? "A loja ainda não tem artigos." : "Sem artigos nesta categoria."}</p>
        ) : (
          <div className="mt-8 grid grid-cols-2 gap-x-2 gap-y-10 sm:gap-x-4 lg:grid-cols-3 lg:gap-y-14">
            {lista.map((p, i) => (
              <CartaoProduto key={p.id} produto={p} prioridade={i < 3} sizes="(min-width: 1024px) 400px, 50vw" />
            ))}
          </div>
        )}
      </div>

      <section aria-label="Entrega e pagamento" className="container-site mt-24">
        <ul className="grid gap-8 sm:grid-cols-3 sm:gap-6">
          {servicos.map((s) => (
            <li key={s.titulo} className="border-t-2 border-ink pt-4">
              <p className="font-bold text-ink">{s.titulo}</p>
              <p className="mt-1 text-sm text-ink-2">{s.texto}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
