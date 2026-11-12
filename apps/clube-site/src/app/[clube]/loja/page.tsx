import type { Metadata } from "next";
import Link from "next/link";
import { Check, ChevronDown, SlidersHorizontal } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { ORDENS, enderecoDaMontra, lerFiltros, montra, type Filtros } from "@/lib/montra";
import { CartaoProduto } from "@/componentes/CartaoProduto";
import { servicosDaLoja } from "@/componentes/loja/servicos";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { clube } = await params;
  const f = lerFiltros(await searchParams);
  if (!f.categoria) return { title: "Loja" };
  const c = (await fonte.categoriasDaLoja(clube)).find((x) => x.slug === f.categoria);
  return c ? { title: `${c.name} · Loja`, description: c.description } : { title: "Loja" };
}

/**
 * A loja, ao jeito das lojas de roupa desportiva: os filtros numa coluna à
 * esquerda (categoria, destaques, tamanho, preço), cada um com quantos
 * artigos dá, e a grelha de fotografias grandes à direita. No telemóvel os
 * filtros abrem num botão por cima da grelha. Tudo vive no endereço
 * (`lib/montra.ts`): partilha-se e funciona sem JavaScript.
 */
export default async function Loja({ params, searchParams }: Props) {
  const clube = await clubeOu404(params);
  const f = lerFiltros(await searchParams);
  const [todos, categorias] = await Promise.all([fonte.produtos(clube.slug), fonte.categoriasDaLoja(clube.slug)]);
  const m = montra(todos, categorias, f);
  const categoriaAtual = categorias.find((c) => c.slug === f.categoria);
  const { entrega, pagamento } = servicosDaLoja(clube.loja);
  const servicos = [...entrega, pagamento ?? { titulo: "Encomendas pelos contactos", texto: "A compra online ainda não está aberta neste clube. Escreve ao clube ou passa pela sede." }];
  const titulo = categoriaAtual?.name ?? (f.promocoes && !f.novidades ? "Promoções" : f.novidades && !f.promocoes ? "Novidades" : "Loja");

  const filtros = <PainelDeFiltros f={f} m={m} />;

  return (
    <>
      {clube.loja?.aviso && <p className="bg-sunken px-4 py-3 text-center text-sm font-medium text-ink">{clube.loja.aviso}</p>}

      <div className="container-site pt-8 sm:pt-10">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-line pb-5">
          <div className="min-w-0">
            <h1 className="titulo-loja text-[clamp(2.25rem,5vw,3.5rem)]">{titulo}</h1>
            <p className="mt-2 text-[0.9375rem] text-ink-3">
              {categoriaAtual?.description ? `${categoriaAtual.description} · ` : ""}
              {m.lista.length === 1 ? "1 artigo" : `${m.lista.length} artigos`}
            </p>
          </div>
          {todos.length > 1 && <Ordenar f={f} />}
        </div>

        {/* No telemóvel: os filtros num botão que abre por cima da grelha. */}
        <details className="group/filtros mt-4 border-b border-line lg:hidden">
          <summary className="flex min-h-12 list-none items-center gap-2 text-[0.9375rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal size={18} aria-hidden />
            Filtrar
            {m.filtrosAtivos > 0 && <span className="tabular text-ink-3">({m.filtrosAtivos})</span>}
            <ChevronDown size={18} className="ml-auto transition-transform group-open/filtros:rotate-180" aria-hidden />
          </summary>
          <div className="pb-6">{filtros}</div>
        </details>

        <div className="mt-6 grid gap-10 lg:mt-8 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:gap-14">
          <aside aria-label="Filtros" className="hidden self-start lg:sticky lg:top-[calc(var(--topo)+1.5rem)] lg:block lg:max-h-[calc(100dvh-var(--topo)-3rem)] lg:overflow-y-auto lg:pr-3 lg:[scrollbar-width:thin]">
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-ink">Filtrar</p>
            {filtros}
          </aside>

          <div className="min-w-0">
            {m.lista.length === 0 ? (
              <div className="py-16">
                <p className="text-lg font-semibold text-ink">{todos.length === 0 ? "A loja ainda não tem artigos." : "Nenhum artigo com estes filtros."}</p>
                {m.filtrosAtivos > 0 && (
                  <Link href="/loja" className="mt-3 inline-flex h-11 items-center font-semibold text-ink underline decoration-2 underline-offset-[6px] hover:decoration-signal">
                    Limpar os filtros
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-x-3 gap-y-10 sm:gap-x-4 xl:grid-cols-3 xl:gap-y-12">
                {m.lista.map((p, i) => (
                  <CartaoProduto key={p.id} produto={p} prioridade={i < 3} sizes="(min-width: 1280px) 340px, (min-width: 1024px) 40vw, 50vw" />
                ))}
              </div>
            )}
          </div>
        </div>
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

/* -------------------------------------------------------------------------- */
/* Os filtros                                                                   */
/* -------------------------------------------------------------------------- */

function PainelDeFiltros({ f, m }: { f: Filtros; m: ReturnType<typeof montra> }) {
  const com = (mudar: Partial<Filtros>) => enderecoDaMontra({ ...f, ...mudar });
  const alternarTamanho = (t: string) => com({ tamanhos: f.tamanhos.includes(t) ? f.tamanhos.filter((x) => x !== t) : [...f.tamanhos, t] });

  return (
    <div className="divide-y divide-line">
      {m.categorias.length > 0 && (
        <Grupo titulo="Categoria">
          <ul>
            <Opcao href={com({ categoria: "" })} ativo={!f.categoria} n={m.todasN} tipo="radio">
              Todas
            </Opcao>
            {m.categorias.map((c) => (
              <Opcao key={c.slug} href={com({ categoria: f.categoria === c.slug ? "" : c.slug })} ativo={f.categoria === c.slug} n={c.n} tipo="radio">
                {c.name}
              </Opcao>
            ))}
          </ul>
        </Grupo>
      )}

      {(m.novidadesN > 0 || m.promocoesN > 0 || f.novidades || f.promocoes) && (
        <Grupo titulo="Destaques">
          <ul>
            {(m.novidadesN > 0 || f.novidades) && (
              <Opcao href={com({ novidades: !f.novidades })} ativo={f.novidades} n={m.novidadesN} tipo="caixa">
                Novidades
              </Opcao>
            )}
            {(m.promocoesN > 0 || f.promocoes) && (
              <Opcao href={com({ promocoes: !f.promocoes })} ativo={f.promocoes} n={m.promocoesN} tipo="caixa">
                Promoções
              </Opcao>
            )}
          </ul>
        </Grupo>
      )}

      {m.tamanhos.length > 0 && (
        <Grupo titulo="Tamanho">
          <ul className="flex flex-wrap gap-2">
            {m.tamanhos.map((t) => {
              const ativo = f.tamanhos.includes(t);
              return (
                <li key={t}>
                  <Link
                    href={alternarTamanho(t)}
                    scroll={false}
                    aria-pressed={ativo}
                    className={`inline-flex h-11 min-w-[3.25rem] items-center justify-center rounded-full border px-3.5 text-sm font-semibold transition ${
                      ativo ? "border-ink bg-ink text-surface" : "border-line-strong text-ink hover:border-ink"
                    }`}
                  >
                    {t}
                  </Link>
                </li>
              );
            })}
          </ul>
        </Grupo>
      )}

      <Grupo titulo="Preço">
        {/* Um formulário GET: os outros filtros seguem escondidos, e funciona sem JavaScript. */}
        <form action="/loja" method="get" className="flex items-end gap-2">
          {f.categoria && <input type="hidden" name="categoria" value={f.categoria} />}
          {f.novidades && <input type="hidden" name="novidades" value="1" />}
          {f.promocoes && <input type="hidden" name="promocoes" value="1" />}
          {f.tamanhos.length > 0 && <input type="hidden" name="tamanho" value={f.tamanhos.join(",")} />}
          {f.ordem && <input type="hidden" name="ordem" value={f.ordem} />}
          <label className="min-w-0 flex-1 text-xs font-medium text-ink-3">
            Mín. (€)
            <input name="min" inputMode="decimal" placeholder="0" defaultValue={f.min ?? ""} className="mt-1.5 block h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-[0.9375rem] tabular text-ink placeholder:text-ink-4 focus:border-ink" />
          </label>
          <label className="min-w-0 flex-1 text-xs font-medium text-ink-3">
            Máx. (€)
            <input name="max" inputMode="decimal" placeholder={String(m.precoMaximo || "")} defaultValue={f.max ?? ""} className="mt-1.5 block h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-[0.9375rem] tabular text-ink placeholder:text-ink-4 focus:border-ink" />
          </label>
          <button type="submit" className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong text-sm font-semibold text-ink transition hover:border-ink">
            Ok
          </button>
        </form>
      </Grupo>

      {m.filtrosAtivos > 0 && (
        <div className="py-5">
          <Link href={enderecoDaMontra({ categoria: "", novidades: false, promocoes: false, tamanhos: [], min: null, max: null, ordem: f.ordem })} className="inline-flex h-11 items-center text-sm font-semibold text-ink underline decoration-2 underline-offset-[6px] hover:decoration-signal">
            Limpar os filtros
          </Link>
        </div>
      )}
    </div>
  );
}

/** Um grupo de filtros que abre e fecha, aberto por omissão. */
function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <details open className="group/grupo py-1">
      <summary className="flex min-h-12 list-none items-center justify-between gap-3 text-[0.9375rem] font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {titulo}
        <ChevronDown size={18} className="shrink-0 text-ink-3 transition-transform group-open/grupo:rotate-180" aria-hidden />
      </summary>
      <div className="pb-4">{children}</div>
    </details>
  );
}

/** Uma opção de filtro como link, com o botão de rádio ou a caixa desenhados e quantos artigos dá. */
function Opcao({ href, ativo, n, tipo, children }: { href: string; ativo: boolean; n: number; tipo: "radio" | "caixa"; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        aria-current={ativo ? "true" : undefined}
        className={`flex min-h-10 items-center gap-3 text-[0.9375rem] transition ${ativo ? "font-semibold text-ink" : "text-ink-2 hover:text-ink"} ${n === 0 && !ativo ? "opacity-50" : ""}`}
      >
        {tipo === "radio" ? (
          <span className={`grid size-[1.125rem] shrink-0 place-items-center rounded-full border-[1.5px] ${ativo ? "border-ink" : "border-line-strong"}`} aria-hidden>
            {ativo && <span className="size-2.5 rounded-full bg-ink" />}
          </span>
        ) : (
          <span className={`grid size-[1.125rem] shrink-0 place-items-center rounded-[4px] border-[1.5px] ${ativo ? "border-ink bg-ink text-surface" : "border-line-strong"}`} aria-hidden>
            {ativo && <Check size={12} strokeWidth={3} />}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate">{children}</span>
        <span className="shrink-0 text-xs tabular text-ink-3">{n}</span>
      </Link>
    </li>
  );
}

function Ordenar({ f }: { f: Filtros }) {
  return (
    <details key={enderecoDaMontra(f)} className="group/ordem relative shrink-0">
      <summary className="flex h-11 list-none items-center gap-1.5 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink transition hover:border-ink [&::-webkit-details-marker]:hidden">
        <span>
          Ordenar<span className="hidden font-normal text-ink-3 sm:inline">: {ORDENS.find((o) => o.v === f.ordem)?.l}</span>
        </span>
        <ChevronDown size={16} className="transition-transform group-open/ordem:rotate-180" aria-hidden />
      </summary>
      <ul className="absolute right-0 top-full z-20 mt-2 w-56 rounded-card border border-line bg-surface py-2 shadow-card">
        {ORDENS.map((o) => (
          <li key={o.v}>
            <Link
              href={enderecoDaMontra({ ...f, ordem: o.v })}
              scroll={false}
              aria-current={o.v === f.ordem ? "true" : undefined}
              className={`flex h-11 items-center justify-between px-4 text-[0.9375rem] transition hover:bg-sunken ${o.v === f.ordem ? "font-semibold text-ink" : "text-ink-2"}`}
            >
              {o.l}
              {o.v === f.ordem && <Check size={16} aria-hidden />}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
