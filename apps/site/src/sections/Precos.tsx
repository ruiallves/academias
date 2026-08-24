import { useState } from "react";
import { Link } from "react-router-dom";
import { Reveal, SectionMark, cx } from "@/components/primitives";
import { ANNUAL_DISCOUNT, annualTotal, euro, PLANS } from "@/lib/content";

/**
 * Preços.
 *
 * ## O que não é
 *
 * Não é a tabela de três colunas com uma lista de vinte checks iguais. Duas
 * colunas, texto a sério, e o que **muda** entre elas dito por palavras — porque a
 * diferença entre os dois planos não é uma quantidade de funcionalidades, é uma
 * decisão: o clube quer ligar as famílias e cobrar por aqui, ou ainda não.
 *
 * ## O interruptor
 *
 * Mensal e anual num interruptor de dois estados, com a poupança escrita ao lado.
 * Quando está em anual, mostra-se o **equivalente mensal** em grande e o total do
 * ano por baixo: é assim que uma pessoa compara com o que já paga, e é honesto —
 * o valor cobrado à cabeça está lá, não escondido.
 */
export function Precos({ compact = false }: { compact?: boolean }) {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="precos" className={cx("border-t border-line", compact ? "band-tight" : "band")}>
      <div className="wrap">
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
          <Reveal>
            <SectionMark n="1">Planos</SectionMark>
            <h2 className="display d2 mt-7 max-w-[14ch]">Dois planos. A diferença é uma só.</h2>
            <p className="lede mt-5">
              A diferença entre quem quer apenas uma plataforma de gestão e quem quer ligar as famílias ao clube e cobrar por aqui.
            </p>
          </Reveal>

          {/* O interruptor */}
          <Reveal i={1}>
            <div className="flex items-center gap-4">
              <div className="inline-flex rounded-[3px] border border-line-2 p-1">
                {[
                  { v: false, label: "Mensal" },
                  { v: true, label: "Anual" },
                ].map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() => setAnnual(o.v)}
                    aria-pressed={annual === o.v}
                    className={cx(
                      "rounded-[2px] px-4 py-2 text-[14px] font-semibold transition-colors duration-200",
                      annual === o.v ? "bg-ink text-white" : "text-ink-3 hover:text-ink",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <span
                className={cx(
                  "font-mono text-[12px] tracking-[0.06em] uppercase transition-colors duration-200",
                  annual ? "text-field" : "text-ink-4",
                )}
              >
                Poupa {ANNUAL_DISCOUNT * 100}%
              </span>
            </div>
          </Reveal>
        </div>

        <div className="mt-12 grid gap-4 lg:grid-cols-2">
          {PLANS.map((p, i) => {
            const perMonth = annual ? annualTotal(p.monthly) / 12 : p.monthly;

            return (
              <Reveal key={p.id} i={i + 2}>
                <article
                  className={cx(
                    "flex h-full flex-col rounded-[3px] border p-7 sm:p-9",
                    p.featured ? "border-ink bg-ink text-white" : "border-line bg-chalk",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3
                        className="text-[22px] font-bold tracking-[-0.03em]"
                        style={{ fontFamily: "var(--font-display)", fontVariationSettings: '"wdth" 92' }}
                      >
                        {p.name}
                      </h3>
                      <p className={cx("mt-1 max-w-[34ch] text-[14.5px]", p.featured ? "text-ink-3" : "text-ink-2")}>
                        {p.tagline}
                      </p>
                    </div>
                    {p.featured && (
                      <span className="tag shrink-0 border-mint/40 text-mint">Recomendado</span>
                    )}
                  </div>

                  <div className="mt-8 flex items-end gap-2.5">
                    <span className="text-[44px] leading-none font-semibold tracking-[-0.04em] tabular">
                      {euro(perMonth)}
                    </span>
                    <span className={cx("mb-1.5 text-[14px]", p.featured ? "text-ink-3" : "text-ink-3")}>/ mês</span>
                  </div>
                  <p className={cx("mt-2 text-[13.5px] tabular", p.featured ? "text-ink-3" : "text-ink-3")}>
                    {annual
                      ? `${euro(annualTotal(p.monthly))} por ano, facturado à cabeça`
                      : "Facturado mensalmente. IVA não incluído."}
                  </p>

                  <ul className="mt-8 space-y-2.5">
                    {p.includes.map((f) => (
                      <li key={f} className="flex gap-3 text-[14.5px] leading-relaxed">
                        <span
                          aria-hidden
                          className={cx("mt-[9px] size-1.5 shrink-0", p.featured ? "bg-mint" : "bg-field")}
                          style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
                        />
                        <span className={p.featured ? "text-white" : "text-ink"}>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {p.excludes && (
                    <div className="mt-7 border-t border-line pt-5">
                      <p className="eyebrow">Não inclui</p>
                      <ul className="mt-3 space-y-2">
                        {p.excludes.map((f) => (
                          <li key={f} className="flex gap-3 text-[14.5px] text-ink-3">
                            <span aria-hidden className="mt-[11px] h-px w-2.5 shrink-0 bg-ink-4" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-auto pt-9">
                    <Link
                      to="/contactos"
                      className={cx("btn w-full", p.featured ? "btn-primary" : "btn-outline")}
                    >
                      Experimentar 30 dias
                    </Link>
                  </div>
                </article>
              </Reveal>
            );
          })}
        </div>

        <Reveal i={4}>
          <p className="mt-8 text-[14px] text-ink-3">
            Trinta dias com tudo, sem cartão. Depois disso, muda-se de plano ou cancela-se sem período mínimo — e os
            dados do clube saem contigo.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
