import { useState } from "react";
import { Link } from "react-router-dom";
import { cx, Seta } from "@/components/marca";
import { ANNUAL_DISCOUNT, annualTotal, euro, PLANS } from "@/lib/content";

/**
 * Os planos.
 *
 * Três blocos lado a lado. O recomendado (o Connect Pro) é o escuro; o Connect
 * leva "O mais escolhido", que é o que a maioria dos clubes tem. Um plano com
 * `soon` mostra o preço sem botão de experimentar, para o clube poder contar
 * com ele no orçamento da época.
 *
 * Em anual mostra-se o equivalente mensal em grande e o total do ano por
 * baixo, que é como uma pessoa compara com o que já paga.
 */
export function Precos({ pagina = false }: { pagina?: boolean }) {
  const [anual, setAnual] = useState(false);

  return (
    <section id="planos" className={cx("palco-cal", pagina ? "sob-o-topo pb-[clamp(48px,6vw,92px)]" : "faixa")}>
      <div className="wrap">
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
          <div>
            {pagina ? <h1 className="titulo t1">Planos<span className="ponto">.</span></h1> : <h2 className="titulo t1">Planos<span className="ponto">.</span></h2>}
            <p className="lede mt-6">
              A Consola é o clube por dentro. O Connect junta as famílias, os sócios e os pagamentos. O Connect Pro
              acrescenta o site do clube.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="interruptor">
              <button type="button" aria-pressed={!anual} onClick={() => setAnual(false)}>
                Mensal
              </button>
              <button type="button" aria-pressed={anual} onClick={() => setAnual(true)}>
                Anual
              </button>
            </div>
            <span className={cx("etiqueta", anual && "etiqueta-viva")}>Poupa {ANNUAL_DISCOUNT * 100}%</span>
          </div>
        </div>

        <div className="planos-mesa mt-12">
          {PLANS.map((p) => {
            // Um plano que ainda não se vende não tem preço anual.
            const porMes = anual && !p.soon ? annualTotal(p.monthly) / 12 : p.monthly;

            return (
              <article key={p.id} className={cx("plano", p.featured ? "palco-noite" : "bg-sup")}>
                {/* As medidas cá dentro vêm de `--u` (ver `.planos-mesa`), para o plano caber no ecrã. */}
                {/* A etiqueta numa linha própria, com a mesma altura em todos os cartões:
                    ao lado do nome, "Connect Pro" partia em duas linhas e o preço descia. */}
                <div className="mb-3 flex min-h-7 items-center gap-2">
                  {p.featured && <span className="etiqueta etiqueta-viva">Recomendado</span>}
                  {p.popular && <span className="etiqueta">O mais escolhido</span>}
                  {p.soon && <span className="etiqueta etiqueta-breve">Brevemente</span>}
                </div>
                <h3 className="titulo plano-nome">{p.name}</h3>
                <p className="plano-linha">{p.tagline}</p>

                <div className="plano-preco">
                  {p.from && <span>desde</span>}
                  <b className="titulo">{euro(porMes)}</b>
                  <span>por mês</span>
                </div>
                <p className="plano-nota">
                  {p.priceNote ?? (anual && !p.soon ? `${euro(annualTotal(p.monthly))} por ano, faturado à cabeça` : "Faturado mensalmente")}
                </p>

                <ul className="plano-lista">
                  {p.includes.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>

                {p.excludes && (
                  <p className="plano-fora">
                    <b>Não inclui:</b> {p.excludes.join(", ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}.
                  </p>
                )}

                <div className="plano-acao">
                  <Link to="/contactos" className={cx("btn", p.soon ? "btn-fio" : "btn-cheio")}>
                    {p.soon ? "Avisa-me quando sair" : "Experimentar 30 dias"}
                    <Seta />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>

        <p className="mt-7 max-w-[76ch] text-[0.92rem] leading-relaxed text-texto-3">
          Trinta dias com tudo o que já existe, sem cartão. Depois disso, muda-se de plano ou cancela-se sem período
          mínimo, e os dados do clube saem contigo.
        </p>
      </div>
    </section>
  );
}
