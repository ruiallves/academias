import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, QrCode, Smartphone, Ticket } from "lucide-react";
import { jogosComBilhetes } from "@/dados/fonte";
import { clubeOu404 } from "@/lib/clube";
import { BilheteDoJogo } from "@/componentes/bilheteira/BilheteDoJogo";
import { FundoDaBilheteira } from "@/componentes/bilheteira/Fundo";

export const revalidate = 60;

export const metadata: Metadata = { title: "Bilheteira" };

/**
 * Os jogos com bilhetes à venda, em casa e fora, um bilhete por jogo (ver
 * `BilheteDoJogo`), pela ordem do calendário. Por cima, o cabeçalho escuro
 * com a cor do clube; por baixo, os três passos da compra.
 */
export default async function Bilheteira({ params }: { params: Promise<{ clube: string }> }) {
  const clube = await clubeOu404(params);
  const jogos = await jogosComBilhetes(clube.slug);
  const n = jogos.length;

  return (
    <>
      <section className="relative overflow-hidden bg-night text-night-ink">
        <FundoDaBilheteira />
        <div className="container-site relative py-12 sm:py-20">
          <p className="eyebrow text-night-ink-2">Bilheteira · {clube.shortName}</p>
          <h1 className="display mt-3 text-5xl text-night-ink sm:text-7xl">Bilhetes</h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-night-ink-2">
            Compra aqui os bilhetes para os jogos do {clube.shortName}, em casa e fora. Pagas por MB WAY ou Multibanco e o bilhete chega ao telemóvel.
          </p>
          <ul className="mt-8 flex flex-wrap gap-2 text-sm font-semibold">
            <li className="inline-flex items-center gap-2 rounded-full bg-signal-strong px-3.5 py-1.5 text-signal-on">
              <Ticket size={15} aria-hidden />
              {n === 0 ? "Sem jogos à venda" : n === 1 ? "1 jogo à venda" : `${n} jogos à venda`}
            </li>
            <li className="inline-flex items-center gap-2 rounded-full border border-night-line bg-night-2 px-3.5 py-1.5 text-night-ink">
              <Smartphone size={15} aria-hidden />
              MB WAY e Multibanco
            </li>
            <li className="inline-flex items-center gap-2 rounded-full border border-night-line bg-night-2 px-3.5 py-1.5 text-night-ink">
              <QrCode size={15} aria-hidden />
              Bilhete com código QR
            </li>
          </ul>
        </div>
      </section>

      <div className="container-site mt-8 sm:mt-12">
        {n === 0 ? (
          <div className="relative rounded-card bg-surface px-6 py-14 text-center shadow-card">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-signal-soft text-signal-ink">
              <Ticket size={26} aria-hidden />
            </span>
            <p className="display mt-5 text-2xl text-ink">Ainda não há bilhetes à venda</p>
            <p className="mx-auto mt-2 max-w-md text-ink-2">Os jogos aparecem aqui assim que o clube abre a venda. Entretanto, vê quando joga o {clube.shortName}.</p>
            <Link href="/calendario" className="mt-6 inline-flex h-11 items-center gap-1.5 font-semibold text-signal-ink hover:underline">
              Ver o calendário
              <ArrowRight size={17} aria-hidden />
            </Link>
          </div>
        ) : (
          <ul className="relative grid grid-cols-[minmax(0,1fr)] gap-5">
            {jogos.map((j) => (
              <li key={j.id} data-reveal>
                <BilheteDoJogo jogo={j} clube={clube} />
              </li>
            ))}
          </ul>
        )}

        <section aria-labelledby="como-comprar" className="mt-20 sm:mt-24" data-reveal>
          <p className="eyebrow text-signal-ink">Como funciona</p>
          <h2 id="como-comprar" className="display mt-2 text-3xl sm:text-4xl">
            Do clique à bancada
          </h2>
          <span className="traco mt-3" aria-hidden />
          <ol className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-6">
            {[
              { t: "Escolhe o lugar", d: "Toca na bancada no mapa do estádio e diz quantos bilhetes queres. Se és sócio, o teu número dá-te o preço de sócio." },
              { t: "Paga em dois minutos", d: "MB WAY ou referência Multibanco, sem criar conta. Os lugares ficam guardados enquanto pagas." },
              { t: "Entra com o telemóvel", d: "Cada pessoa tem o seu código QR, no telemóvel e no email. À porta, é só mostrar." },
            ].map((p, i) => (
              <li key={p.t} className="relative border-t-2 border-line pt-6">
                <span className="absolute -top-0.5 left-0 h-0.5 w-12 bg-signal" aria-hidden />
                <span className="display block text-5xl text-signal tabular">{String(i + 1).padStart(2, "0")}</span>
                <p className="mt-3 text-lg font-bold text-ink">{p.t}</p>
                <p className="mt-1.5 text-ink-2">{p.d}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
