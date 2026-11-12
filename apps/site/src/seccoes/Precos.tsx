import { useState } from "react";
import { Link } from "react-router-dom";
import { cx, Seta } from "@/components/marca";
import { AI_ADDON, ANNUAL_DISCOUNT, annualTotal, euro, PLANS } from "@/lib/content";

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
 *
 * O Assistente IA é um extra com o mesmo preço em qualquer plano. O
 * interruptor "Com Assistente IA" soma-o ao preço de cada cartão, para o clube
 * ver o que paga ao todo em vez de fazer a conta na cabeça (decisão do Rui a
 * 12/11/2026: a alternativa era uma caixa à parte por baixo dos planos).
 */
export function Precos({ pagina = false }: { pagina?: boolean }) {
  const [anual, setAnual] = useState(false);
  const [comIA, setComIA] = useState(false);

  const extra = comIA ? AI_ADDON.monthly : 0;

  return (
    <section id="planos" className={cx("palco-cal", pagina ? "sob-o-topo pb-[clamp(48px,6vw,92px)]" : "faixa")}>
      <div className="wrap">
        <div className="flex flex-col items-start justify-between gap-8 lg:flex-row lg:items-end">
          <div>
            {pagina ? <h1 className="titulo t1">Planos<span className="ponto">.</span></h1> : <h2 className="titulo t1">Planos<span className="ponto">.</span></h2>}
            <p className="lede mt-6">
              A Consola é o clube por dentro. O Connect junta as famílias, os sócios e os pagamentos. O Connect Pro
              acrescenta o site do clube. O Assistente IA junta-se a qualquer um deles.
            </p>
          </div>

          <div className="flex flex-col items-start gap-4 lg:items-end">
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
            {/* O assistente soma-se ao preço de cada plano: um interruptor, como o das definições de um telemóvel. */}
            <label className="alternador">
              <input type="checkbox" id="com-assistente" checked={comIA} onChange={(e) => setComIA(e.target.checked)} />
              <span className="alternador-pista" aria-hidden />
              <span>Com assistente IA</span>
            </label>
          </div>
        </div>

        <div className="planos-mesa mt-12">
          {PLANS.map((p) => {
            // Um plano que ainda não se vende não tem preço anual.
            const base = p.monthly + extra;
            const porMes = anual && !p.soon ? annualTotal(base) / 12 : base;

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
                  {p.priceNote ??
                    (anual && !p.soon ? `${euro(annualTotal(base))} por ano, faturado à cabeça` : "Faturado mensalmente")}
                  {comIA && `, com o ${AI_ADDON.name}`}
                </p>

                <ul className="plano-lista">
                  {p.includes.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                  {comIA && (
                    <li className="plano-ia">
                      {AI_ADDON.name}, {AI_ADDON.credits.toLocaleString("pt-PT")} créditos por mês
                    </li>
                  )}
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
          O assistente IA são {euro(AI_ADDON.monthly)} por mês em qualquer plano, com {AI_ADDON.credits.toLocaleString("pt-PT")} créditos:
          cerca de {AI_ADDON.credits.toLocaleString("pt-PT")} presenças ou convocatórias, ou 100 treinos planeados.{" "}
          <Link to="/assistente-ia-clubes" className="ligacao">
            O que faz
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
