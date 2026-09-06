import { useState } from "react";
import { Link } from "react-router-dom";
import { Reveal, cx } from "@/components/primitives";
import { ANNUAL_DISCOUNT, annualTotal, euro, PLANS } from "@/lib/content";

/**
 * Preços.
 *
 * ## Uma mesa, três lugares
 *
 * Não são três cartões a flutuar: é uma superfície só, com o canto da marca,
 * dividida por filetes. O recomendado é o do meio, e é o lado escuro — a casa —
 * com a diferença a ler-se ao atravessar a linha.
 *
 * ## A caixa é mais larga do que a do resto da página, e é de propósito
 *
 * A `.wrap` da página tem 1180px porque é a medida de **leitura**: uma coluna
 * de prosa mais larga do que isso cansa. Só que os planos não se leem em
 * coluna — comparam-se lado a lado — e três lugares dentro de 1180 deixavam
 * 280px de texto em cada um: as frases partiam-se a meio e a comparação, que é
 * o trabalho desta secção, passou a dar trabalho.
 *
 * Por isso esta secção — e só esta — corre em `.wrap-wide` (1440px). Não é uma
 * excepção por gosto: é a régua certa para uma tabela, como 1180 é a régua
 * certa para um parágrafo. Abaixo dos 1380px as duas caixas coincidem, e a
 * diferença desaparece sem ninguém dar por ela.
 *
 * ## O plano que ainda não se vende está na mesa na mesma
 *
 * O **Vision** ocupa o terceiro lugar com o preço à vista e **sem** botão de
 * experimentar. Um clube escolhe plataforma uma vez e quer saber para onde é
 * que ela vai; esconder o plano até estar pronto era deixá-lo decidir sem essa
 * informação, e "sob consulta" mandava-o comparar noutro lado. Prometer-lhe
 * trinta dias de graça de uma coisa que não abre era pior — por isso a acção é
 * "avisa-me quando sair", a única verdadeira que hoje se pode pôr ali.
 *
 * ## O interruptor
 *
 * Mensal e anual em dois botões de texto, com a poupança dita ao lado. Em anual
 * mostra-se o equivalente mensal em grande e o total do ano por baixo: é assim
 * que uma pessoa compara com o que já paga, e o valor cobrado à cabeça está lá,
 * não escondido.
 */
export function Precos({ compact = false }: { compact?: boolean }) {
  const [annual, setAnnual] = useState(false);

  return (
    <section id="precos" className={cx(compact ? "band-tight" : "band")}>
      {/* A única secção em caixa larga — ver a nota do cabeçalho. */}
      <div className="wrap-wide">
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
          <Reveal>
            <h2 className="display d2 max-w-[16ch]">
              Os nossos planos
            </h2>
            <p className="lede mt-5">
              Entre quem quer uma plataforma de gestão, quem quer o clube inteiro ligado — famílias, sócios e dinheiro
              — e quem quer, a seguir, o vídeo dos jogos transformado em dados sobre os atletas e a equipa.
            </p>
          </Reveal>

          <Reveal i={1}>
            <div className="flex items-center gap-5">
              <div className="flex gap-6 border-b border-line">
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
                      "-mb-px border-b-2 pb-2.5 text-[15px] font-semibold transition-colors",
                      annual === o.v ? "border-field text-ink" : "border-transparent text-ink-3 hover:text-ink",
                    )}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <span
                className={cx(
                  "text-[12px] font-[650] tracking-[0.1em] uppercase transition-colors duration-200",
                  annual ? "text-field" : "text-ink-4",
                )}
              >
                Poupa {ANNUAL_DISCOUNT * 100}%
              </span>
            </div>
          </Reveal>
        </div>

        <Reveal i={2}>
          <div className="canto mt-12 grid overflow-hidden border border-line-2 lg:grid-cols-3">
            {PLANS.map((p) => {
              // Um plano que ainda não se vende não tem preço anual: o desconto
              // é de quem paga o ano à cabeça, e ninguém paga o que não abre.
              const perMonth = annual && !p.soon ? annualTotal(p.monthly) / 12 : p.monthly;

              return (
                /*
                  As medidas encolhem em ecrã baixo — ver a nota do ecrã baixo em
                  `brand.css`. Num portátil de 720px de altura, o preço aparecia
                  abaixo da dobra: 40px de folga em cada lado do cartão, 36px
                  entre o nome e o preço e 10px por linha da lista somavam mais
                  do que a janela inteira tinha para dar.
                */
                <article
                  key={p.id}
                  className={cx(
                    "flex flex-col p-7 max-h-screen-sm:p-6 sm:p-9",
                    // O filete separa; o último não o leva, senão duplicava a
                    // borda da superfície inteira.
                    p.featured
                      ? "dark"
                      : "bg-chalk border-line-2 max-lg:border-b lg:border-r max-lg:last:border-b-0 lg:last:border-r-0",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="display d3">{p.name}</h3>
                      <p className="mt-2 max-w-[34ch] text-[14.5px] leading-relaxed text-ink-2">{p.tagline}</p>
                    </div>
                    {p.featured && <span className="tag tag-live shrink-0">Recomendado</span>}
                    {p.soon && <span className="tag tag-soon shrink-0">Brevemente</span>}
                  </div>

                  <div className="mt-9 flex items-end gap-2.5 max-h-screen-sm:mt-6">
                    <span className="display text-[3rem] leading-none tabular max-h-screen-sm:text-[2.4rem]">
                      {euro(perMonth)}
                    </span>
                    <span className="mb-1 text-[14px] text-ink-3">/ mês</span>
                  </div>
                  {/* Onde os outros dizem como se factura, o Vision diz que
                      ainda não se factura — é o que impede o preço de se ler
                      como uma coisa que já se pode pagar. */}
                  <p className="mt-2.5 text-[13.5px] text-ink-3 tabular">
                    {p.soon
                      ? p.soonWhen
                      : annual
                        ? `${euro(annualTotal(p.monthly))} por ano, facturado à cabeça`
                        : "Facturado mensalmente"}
                  </p>

                  <ul className="mt-9 border-t border-line max-h-screen-sm:mt-6">
                    {p.includes.map((f) => (
                      <li
                        key={f}
                        className="border-b border-line py-2.5 text-[14.5px] leading-relaxed max-h-screen-sm:py-2 max-h-screen-sm:text-[13.5px]"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>

                  {p.excludes && (
                    <div className="mt-7 max-h-screen-sm:mt-5">
                      <p className="field-label">Não inclui</p>
                      <ul className="mt-3 space-y-1.5">
                        {p.excludes.map((f) => (
                          <li key={f} className="flex gap-3 text-[14.5px] text-ink-3">
                            <span aria-hidden className="mt-[11px] h-px w-2.5 shrink-0 bg-ink-4" />
                            {f}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="mt-auto pt-10 max-h-screen-sm:pt-6">
                    <Link to="/contactos" className={cx("btn w-full", p.featured ? "btn-primary" : "btn-outline")}>
                      {p.soon ? "Avisa-me quando sair" : "Experimentar 30 dias"}
                      <span aria-hidden className="arr">→</span>
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </Reveal>

        <Reveal i={3}>
          <p className="mt-7 max-w-[76ch] text-[14px] leading-relaxed text-ink-3">
            Trinta dias com tudo o que já existe, sem cartão. Depois disso, muda-se de plano ou cancela-se sem período
            mínimo — e os dados do clube saem contigo. O <span className="font-semibold text-ink">Vision</span> ainda
            não se vende: o preço está aqui para poderes contar com ele no orçamento da época.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
