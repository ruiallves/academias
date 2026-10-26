import { Link } from "react-router-dom";
import { Monitor, Telemovel } from "@/components/aparelhos";
import { Seta } from "@/components/marca";
import { SOLUCOES, solucaoDe, type Solucao as Dados } from "@/lib/solucoes";

/**
 * Uma página por pesquisa: futebol, futsal, basquetebol, mensalidades, sócios…
 *
 * O texto vive em `lib/solucoes.ts`. A página segue o desenho do Produto: o
 * título com a pesquisa por cima, blocos com o ecrã real ao lado, as perguntas
 * e links para as outras páginas. Os links entre elas contam para o Google
 * tanto como para quem lê.
 */
export default function Solucao({ s }: { s: Dados }) {
  const outras = s.relacionadas.map(solucaoDe).filter((x): x is Dados => Boolean(x));

  return (
    <>
      <header className="palco-cal sob-o-topo">
        <div className="wrap">
          <p className="rotulo text-texto-3">{s.rotulo}</p>
          <h1 className="titulo t1 mt-5 max-w-[18ch]">
            {s.h1}
            <span className="ponto">.</span>
          </h1>
          <div className="mt-9 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <p className="lede">{s.lede}</p>
            <div className="flex flex-wrap gap-3">
              <Link to="/contactos" className="btn btn-cheio">
                Experimentar 30 dias
                <Seta />
              </Link>
              <Link to="/planos" className="btn btn-fio">
                Ver planos
              </Link>
            </div>
          </div>
        </div>
        <div className="px-[clamp(8px,1.2vw,20px)]">
          <div className="solucao-montra">
            <Aparelho captura={s.captura} urgente />
          </div>
        </div>
      </header>

      <section className="palco-cal">
        <div className="wrap">
          {s.blocos.map((b, i) => (
            <article
              key={b.titulo}
              className="fio-cima grid items-center gap-10 py-[clamp(48px,8vw,112px)] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16"
            >
              <div className={i % 2 ? "lg:order-2" : undefined}>
                <h2 className="titulo t2 max-w-[16ch]">
                  {b.titulo}
                  <span className="ponto">.</span>
                </h2>
                <p className="lede mt-5">{b.texto}</p>
                <ul className="mt-8">
                  {b.itens.map((it) => (
                    <li key={it} className="fio-cima py-3 text-[1rem] leading-snug">
                      {it}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="grid min-w-0 place-items-center">
                <Aparelho captura={b.captura} />
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="perguntas" className="palco-cal faixa scroll-mt-(--topo)">
        <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-20">
          <h2 className="titulo t2 max-w-[10ch]">
            Perguntas
            <span className="ponto">.</span>
          </h2>
          <div className="border-b border-fio">
            {s.perguntas.map((f) => (
              <details key={f.q} className="pergunta">
                <summary>
                  <span className="titulo t4">{f.q}</span>
                  <span aria-hidden className="mais text-texto-3">
                    +
                  </span>
                </summary>
                <p className="corpo pb-6">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="palco-cal faixa-curta">
        <div className="wrap">
          <p className="rotulo text-texto-3">Também na Academias</p>
          <ul className="mt-6 grid gap-x-10 sm:grid-cols-2">
            {outras.map((o) => (
              <li key={o.path} className="fio-cima">
                <Link to={o.path} className="group flex items-center justify-between gap-4 py-5">
                  <span>
                    <span className="titulo t4 block">{o.nome}</span>
                    <span className="mt-1 block text-[0.95rem] leading-snug text-texto-2">{o.rotulo}</span>
                  </span>
                  <Seta />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="bloco palco-noite mb-[clamp(8px,1.2vw,20px)]">
        <div className="wrap faixa-curta flex flex-wrap items-center justify-between gap-8">
          <p className="titulo t2 max-w-[20ch]">
            Trinta dias com tudo, com o teu clube lá dentro
            <span className="ponto">.</span>
          </p>
          <Link to="/contactos" className="btn btn-cheio">
            Começar
            <Seta />
          </Link>
        </div>
      </section>
    </>
  );
}

/** A consola num ecrã, a app num telemóvel. As capturas da app começam por `app-`. */
function Aparelho({ captura, urgente }: { captura: string; urgente?: boolean }) {
  return captura.startsWith("app-") ? (
    <Telemovel capturas={[captura]} atual={captura} urgente={urgente} />
  ) : (
    <Monitor capturas={[captura]} plano={{ captura }} urgente={urgente} />
  );
}

export { SOLUCOES };
