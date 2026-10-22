import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info, MapPin } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { dataLonga, hora } from "@/lib/formatar";
import { emDemonstracao } from "@/lib/modo";
import { fasesDoJogo, vendaDeDemonstracao, type Venda } from "@/lib/bilheteira";
import { Cartaz, LinhaDoJogo } from "@/componentes/Jogo";
import { Compra } from "./Compra";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string; jogo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clube: slug, jogo: id } = await params;
  const j = await fonte.jogo(slug, id);
  return j ? { title: `Bilhetes · vs ${j.opponent}` } : {};
}

/**
 * A compra de bilhetes de um jogo. O cartaz e as fases vêm da lista de jogos
 * (com o minuto de cache do site); a venda em si (preços, lugares que
 * restam, o que já abriu) pede-a o browser à API ao abrir, sem cache, porque
 * é aí que se vê se ainda há lugar.
 */
export default async function BilhetesDoJogo({ params }: Props) {
  const clube = await clubeOu404(params);
  const { jogo: id } = await params;
  const jogo = await fonte.jogo(clube.slug, id);
  if (!jogo || !jogo.tickets) notFound();

  const fases = fasesDoJogo(jogo.tickets);
  const demonstracao = emDemonstracao();

  // Em demonstração o clube não existe na API: a venda monta-se aqui, com os dados de exemplo.
  let demo: { venda: Venda; vendaDeSocio: Venda } | null = null;
  if (demonstracao) {
    const recinto = clube.recintos.find((r) => r.id === jogo.tickets!.recintoId) ?? null;
    const adesao = await fonte.socios(clube.slug);
    const categorias = Object.fromEntries(adesao.tiers.map((t) => [t.id, t.name]));
    // O sócio de exemplo é "Sócio jovem", para se ver um preço só de uma categoria.
    demo = {
      venda: vendaDeDemonstracao(jogo, recinto, categorias),
      vendaDeSocio: vendaDeDemonstracao(jogo, recinto, categorias, { tierId: "demo-jovem" }),
    };
  }

  return (
    <>
      <div className="bg-night text-night-ink">
        <div className="container-site py-8 sm:py-12">
          <Link href="/bilheteira" className="inline-flex h-11 items-center gap-1.5 text-sm font-semibold text-night-ink-2 hover:text-night-ink">
            <ArrowLeft size={16} aria-hidden />
            Bilheteira
          </Link>
          <div className="mt-6 flex items-center justify-between gap-3">
            <LinhaDoJogo jogo={jogo} escuro />
          </div>
          <div className="mt-6 max-w-2xl">
            <Cartaz jogo={jogo} clube={clube} escuro />
          </div>
          <p className="mt-6 flex items-center gap-2 text-sm text-night-ink-2">
            <MapPin size={16} aria-hidden />
            {jogo.venue} · {dataLonga(jogo.startsAt)}, {hora(jogo.startsAt)}
          </p>
          {fases.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {fases.map((f) => (
                <li key={f} className="rounded-sm bg-signal-strong px-2.5 py-1 text-sm font-semibold text-signal-on">
                  {f}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="container-site mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0">
          <h1 className="display text-3xl">Bilhetes</h1>
          <span className="traco mt-3" aria-hidden />
          {jogo.tickets.open ? (
            <Compra slug={clube.slug} matchId={jogo.id} api={process.env.SITE_API_URL ?? ""} demonstracao={demonstracao} demo={demo} />
          ) : (
            <p className="mt-6 text-ink-3">A venda para este jogo ainda não abriu.</p>
          )}
        </section>
        <aside className="space-y-4">
          {jogo.tickets.note && (
            <div className="flex gap-3 rounded-card bg-signal-soft p-4 text-sm text-signal-ink">
              <Info size={18} className="mt-0.5 shrink-0" aria-hidden />
              <p>{jogo.tickets.note}</p>
            </div>
          )}
          <div className="rounded-card border border-line bg-surface p-4 text-sm text-ink-2">
            <p className="font-semibold text-ink">Como funciona</p>
            <ol className="mt-2 list-decimal space-y-1 pl-5">
              <li>Escolhes os bilhetes. Se és sócio, identifica-te para veres o preço de sócio.</li>
              <li>Pagas por MB WAY, com 5 minutos para aceitar o pedido, ou por Multibanco, com 10 minutos para pagar a referência.</li>
              <li>Os bilhetes aparecem logo a seguir e chegam por email, com um código QR por pessoa.</li>
              <li>À entrada, mostras o código no telemóvel ou impresso.</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
