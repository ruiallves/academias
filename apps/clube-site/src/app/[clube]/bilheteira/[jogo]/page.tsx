import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Info, MapPin } from "lucide-react";
import { fonte } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { dataLonga, hora } from "@/lib/formatar";
import { Cartaz, LinhaDoJogo } from "@/componentes/Jogo";
import { EscolherBilhetes } from "./EscolherBilhetes";

export const revalidate = 60;

type Props = { params: Promise<{ clube: string; jogo: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clube: slug, jogo: id } = await params;
  const j = await fonte.jogo(slug, id);
  return j ? { title: `Bilhetes · vs ${j.opponent}` } : {};
}

/** A compra de bilhetes de um jogo: o cartaz, os tipos, a quantidade, o total. */
export default async function BilhetesDoJogo({ params }: Props) {
  const clube = await clubeOu404(params);
  const { jogo: id } = await params;
  const jogo = await fonte.jogo(clube.slug, id);
  if (!jogo || !jogo.tickets) notFound();

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
        </div>
      </div>

      <div className="container-site mt-10 grid gap-10 lg:grid-cols-[1fr_22rem]">
        <section>
          <h1 className="display text-3xl">Bilhetes</h1>
          <span className="traco mt-3" aria-hidden />
          {jogo.tickets.open ? (
            <EscolherBilhetes tipos={jogo.tickets.types} recinto={clube.recintos.find((r) => r.id === jogo.tickets!.recintoId) ?? null} />
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
              <li>Escolhes os bilhetes e pagas por MB WAY, Multibanco ou cartão.</li>
              <li>O bilhete chega por email com um código QR por pessoa.</li>
              <li>À entrada, o código é lido no telemóvel ou impresso.</li>
            </ol>
            {jogo.tickets.capacity && <p className="mt-3 text-ink-3">Lotação: {jogo.tickets.capacity.toLocaleString("pt-PT")} lugares.</p>}
          </div>
        </aside>
      </div>
    </>
  );
}
