import { Link } from "react-router-dom";
import { Monitor, Telemovel } from "@/components/aparelhos";
import { Seta } from "@/components/marca";
import { SOLUCOES, solucaoDe, type Solucao as Dados } from "@/lib/solucoes";

/**
 * Uma página por pesquisa: futebol, futsal, basquetebol, mensalidades, sócios…
 *
 * O texto vive em `lib/solucoes.ts`. O herói é o da página inicial: o texto à
 * esquerda e os aparelhos à direita. Cada bloco mostra o assunto dos dois
 * lados quando os há: a consola no computador com a app à frente, ou dois
 * telemóveis lado a lado. Os links entre as páginas contam para o Google tanto
 * como para quem lê.
 */
export default function Solucao({ s }: { s: Dados }) {
  const outras = s.relacionadas.map(solucaoDe).filter((x): x is Dados => Boolean(x));

  return (
    <>
      <header className="solucao-heroi palco-cal sob-o-topo">
        <div className="wrap heroi-grelha">
          <div>
            <p className="rotulo text-texto-3">{s.rotulo}</p>
            <h1 className="titulo t1 mt-5 max-w-[16ch]">
              {s.h1}
              <span className="ponto">.</span>
            </h1>
            <p className="lede mt-7">{s.lede}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link to="/contactos" className="btn btn-cheio">
                Experimentar 30 dias
                <Seta />
              </Link>
              <Link to="/planos" className="btn btn-fio">
                Ver planos
              </Link>
            </div>
          </div>
          <Montra captura={s.captura} tel={s.tel} urgente />
        </div>
      </header>

      <section className="palco-cal">
        <div className="wrap">
          {s.blocos.map((b, i) => (
            <article
              key={b.titulo}
              className="fio-cima grid items-center gap-10 py-[clamp(48px,8vw,112px)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16"
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
              <Montra captura={b.captura} tel={b.tel} />
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

/** Uma captura de telemóvel: a app, o site ou o leitor no telemóvel, ou a consola tirada no telemóvel. */
const eTelemovel = (id: string) => /^(app-|site-tel-|porta-)/.test(id) || id.endsWith("-tel");

/**
 * Os ecrãs de um assunto.
 *
 * - computador e telemóvel: o telemóvel à frente, no canto de baixo;
 * - dois telemóveis: lado a lado, o segundo um pouco mais abaixo;
 * - um só ecrã: o aparelho dele.
 */
function Montra({ captura, tel, urgente }: { captura: string; tel?: string; urgente?: boolean }) {
  if (eTelemovel(captura)) {
    return (
      <div className={tel ? "montra-par" : "montra-um"} aria-hidden>
        <Telemovel capturas={[captura]} atual={captura} urgente={urgente} />
        {tel && <Telemovel capturas={[tel]} atual={tel} urgente={urgente} />}
      </div>
    );
  }
  return (
    <div className={tel ? "area-montra" : "montra-um"} aria-hidden>
      <Monitor capturas={[captura]} plano={{ captura }} urgente={urgente} />
      {tel && (
        <div className="area-tel">
          <Telemovel capturas={[tel]} atual={tel} urgente={urgente} />
        </div>
      )}
    </div>
  );
}

export { SOLUCOES };
