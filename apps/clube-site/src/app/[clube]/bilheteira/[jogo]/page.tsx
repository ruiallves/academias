import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock, MapPin } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { dataLonga, hora, primeiraMaiuscula } from "@/lib/formatar";
import { emDemonstracao } from "@/lib/modo";
import { confronto, fasesDoJogo, vendaDeDemonstracao, type Venda } from "@/lib/bilheteira";
import { Cartaz, LinhaDoJogo } from "@/componentes/Jogo";
import { FundoDaBilheteira } from "@/componentes/bilheteira/Fundo";
import { Compra } from "./Compra";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string; jogo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clube: slug, jogo: id } = await params;
  const j = await fonte.jogo(slug, id);
  return j ? { title: `Bilhetes · ${j.isHome ? `vs ${j.opponent}` : `${j.opponent} (fora)`}` } : {};
}

/**
 * A compra de bilhetes de um jogo, em casa ou fora. O cartaz e as fases vêm
 * da lista de jogos (com o minuto de cache do site); a venda em si (preços,
 * lugares que restam, o que já abriu) pede-a o browser à API ao abrir, sem
 * cache, porque é aí que se vê se ainda há lugar.
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
      <section className="relative overflow-hidden bg-night text-night-ink">
        <FundoDaBilheteira />
        <div className="container-site relative pb-10 pt-6 sm:pb-14 sm:pt-8">
          <Link href="/bilheteira" className="-ml-1 inline-flex h-11 items-center gap-1.5 px-1 text-sm font-semibold text-night-ink-2 transition hover:text-night-ink">
            <ArrowLeft size={16} aria-hidden />
            Bilheteira
          </Link>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {!jogo.isHome && <span className="rounded-sm bg-night-ink px-1.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-wider text-night">Fora</span>}
            <LinhaDoJogo jogo={jogo} escuro />
          </div>
          <div className="mt-8 max-w-2xl">
            <Cartaz jogo={jogo} clube={clube} escuro />
          </div>
          <ul className="mt-8 flex flex-wrap gap-2 text-sm">
            <li className="inline-flex items-center gap-2 rounded-full border border-night-line bg-night-2/80 px-3.5 py-1.5 text-night-ink">
              <CalendarDays size={15} className="text-night-ink-2" aria-hidden />
              {primeiraMaiuscula(dataLonga(jogo.startsAt))}
            </li>
            <li className="inline-flex items-center gap-2 rounded-full border border-night-line bg-night-2/80 px-3.5 py-1.5 tabular text-night-ink">
              <Clock size={15} className="text-night-ink-2" aria-hidden />
              {hora(jogo.startsAt)}
            </li>
            <li className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-night-line bg-night-2/80 px-3.5 py-1.5 text-night-ink">
              <MapPin size={15} className="shrink-0 text-night-ink-2" aria-hidden />
              <span className="truncate">{jogo.venue}</span>
            </li>
            {fases.map((f) => (
              <li key={f} className="inline-flex items-center gap-2 rounded-full bg-signal-strong px-3.5 py-1.5 font-semibold text-signal-on">
                {f}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <div className="container-site mt-8 sm:mt-12">
        {jogo.tickets.open ? (
          <Compra
            slug={clube.slug}
            matchId={jogo.id}
            api={process.env.SITE_API_URL ?? ""}
            demonstracao={demonstracao}
            demo={demo}
            nota={jogo.tickets.note ?? null}
            resumo={{
              titulo: confronto(clube.shortName, jogo.opponent, jogo.isHome),
              quando: `${primeiraMaiuscula(dataLonga(jogo.startsAt))}, ${hora(jogo.startsAt)}`,
              local: jogo.venue,
              emCasa: jogo.isHome,
            }}
          />
        ) : (
          <div className="rounded-card bg-surface p-8 text-center shadow-card">
            <p className="display text-2xl text-ink">A venda ainda não abriu</p>
            <p className="mt-2 text-ink-2">Volta mais perto do jogo. Os bilhetes aparecem aqui quando o clube abrir a venda.</p>
          </div>
        )}
      </div>
    </>
  );
}
