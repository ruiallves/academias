import { Link } from "react-router-dom";
import { Reveal, SectionMark, cx } from "@/components/primitives";
import { Precos } from "@/sections/Precos";
import { FAQ, MODULES } from "@/lib/content";

/**
 * Planos.
 *
 * A landing tem os preços; esta tem a **decisão**. Uma tabela por módulo com duas
 * colunas — o que está em cada plano — porque a pergunta que sobra depois de ver os
 * preços é sempre a mesma: "e a app das famílias, está no primeiro?".
 */
export default function Planos() {
  return (
    <>

      <Precos compact />

      {/* A tabela de decisão */}
      <section className="band-tight border-t border-line bg-paper-2">
        <div className="wrap">
          <Reveal>
            <h2 className="display d3">O que muda entre os dois</h2>
          </Reveal>

          <Reveal i={1}>
            <div className="mt-8 overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line-2">
                    <th className="py-3 pr-4 text-[13px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                      Módulo
                    </th>
                    <th className="w-[120px] py-3 text-center text-[13px] font-semibold tracking-[0.06em] text-ink-3 uppercase">
                      Consola
                    </th>
                    <th className="w-[140px] py-3 text-center text-[13px] font-semibold tracking-[0.06em] uppercase">
                      Clube Ligado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {MODULES.map((m) => (
                    <tr key={m.key} className="border-b border-line">
                      <td className="py-3.5 pr-4">
                        <p className="text-[15.5px] font-medium">{m.name}</p>
                        <p className="text-[13.5px] text-ink-3">{m.line}</p>
                      </td>
                      <td className="py-3.5 text-center">
                        <Cell on={!m.paidTier} />
                      </td>
                      <td className="py-3.5 text-center">
                        <Cell on />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-line">
                    <td className="py-3.5 pr-4">
                      <p className="text-[15.5px] font-medium">Página pública de adesão a sócio</p>
                      <p className="text-[13.5px] text-ink-3">O clube recebe inscrições online.</p>
                    </td>
                    <td className="py-3.5 text-center">
                      <Cell on={false} />
                    </td>
                    <td className="py-3.5 text-center">
                      <Cell on />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Reveal>

          <Reveal i={2}>
            <p className="mt-6 max-w-[60ch] text-[14.5px] leading-relaxed text-ink-2">
              Na prática: a <span className="font-semibold text-ink">Consola</span> resolve o clube por dentro. O{" "}
              <span className="font-semibold text-ink">Clube Ligado</span> acrescenta as duas coisas que as famílias
              vêem — a app e as mensalidades. Quase todos os clubes acabam no segundo; começa no que fizer sentido e
              muda quando quiseres.
            </p>
          </Reveal>
        </div>
      </section>

      {/* Perguntas de compra */}
      <section className="band-tight border-t border-line">
        <div className="wrap grid gap-10 lg:grid-cols-2 lg:gap-16">
          {FAQ.filter((f) => /teste|cancelar|migrar|suporte/i.test(f.q)).map((f, i) => (
            <Reveal key={f.q} as="div" i={i}>
              <p className="text-[16.5px] font-semibold tracking-[-0.02em]">{f.q}</p>
              <p className="mt-2 max-w-[54ch] text-[15px] leading-relaxed text-ink-2">{f.a}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="dark">
        <div className="wrap band-tight flex flex-wrap items-center justify-between gap-6">
          <p className="display d3 max-w-[22ch]">Trinta dias com tudo, para veres com o teu clube lá dentro.</p>
          <Link to="/contactos" className="btn btn-primary">
            Começar gratuitamente
          </Link>
        </div>
      </section>
    </>
  );
}

/** Um sinal, não um emoji: seta cheia para incluído, traço para não incluído. */
function Cell({ on }: { on: boolean }) {
  return on ? (
    <span
      aria-label="Incluído"
      className={cx("inline-block size-2.5 bg-field")}
      style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
    />
  ) : (
    <span aria-label="Não incluído" className="inline-block h-px w-3 bg-line-2 align-middle" />
  );
}
