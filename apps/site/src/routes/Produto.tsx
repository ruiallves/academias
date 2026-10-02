import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Monitor, Telemovel } from "@/components/aparelhos";
import { cx, Seta } from "@/components/marca";
import { PESSOAS, ROADMAP, SECURITY } from "@/lib/content";

/**
 * O clube por dentro.
 *
 * A página para quem já viu a semana e quer a lista. Está organizada por
 * pessoa, que é como um clube pensa: o que tem a direção, o treinador, o
 * departamento clínico, a família.
 *
 * À direita fica uma montra presa ao ecrã. Mostra o ecrã real de quem está a
 * ser lido: a consola para quem trabalha no clube, o telemóvel para quem está
 * em casa.
 */
export default function Produto() {
  const [ativa, setAtiva] = useState(PESSOAS[0].id);
  const lista = useRef<HTMLDivElement>(null);

  // A pessoa que atravessa o meio do ecrã é a que a montra mostra.
  useEffect(() => {
    const el = lista.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) if (e.isIntersecting) setAtiva((e.target as HTMLElement).dataset.pessoa!);
      },
      { rootMargin: "-48% 0px -48% 0px" },
    );
    el.querySelectorAll("[data-pessoa]").forEach((x) => io.observe(x));
    return () => io.disconnect();
  }, []);

  const pessoa = PESSOAS.find((p) => p.id === ativa) ?? PESSOAS[0];
  const pcs = PESSOAS.filter((p) => p.montra.tipo === "pc");
  const tels = PESSOAS.filter((p) => p.montra.tipo === "tel");

  return (
    <>
      <header className="palco-cal sob-o-topo">
        <div className="wrap pb-[clamp(40px,6vw,88px)]">
          <h1 className="titulo t1 max-w-[10ch]">O clube por dentro.</h1>
          <div className="mt-9 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <p className="lede">
              Tudo o que a plataforma faz hoje, pessoa a pessoa. A consola serve quem trabalha no clube. A app serve as
              famílias, os atletas e os sócios.
            </p>
            <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Pessoas">
              {PESSOAS.map((p) => (
                <a key={p.id} href={`#${p.id}`} className={cx("rotulo transition-colors", p.id === ativa ? "text-texto" : "text-texto-3 hover:text-texto")}>
                  {p.nome}
                </a>
              ))}
            </nav>
          </div>
        </div>
      </header>

      <section className="palco-cal">
        <div className="wrap grid gap-x-[clamp(32px,5vw,96px)] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div ref={lista}>
            {PESSOAS.map((p) => (
              <article key={p.id} id={p.id} data-pessoa={p.id} className="fio-cima scroll-mt-[calc(var(--topo)+16px)] py-[clamp(48px,9svh,110px)] lg:min-h-[78svh]">
                <div className="flex items-center gap-3">
                  <h2 className="titulo t2">{p.nome}</h2>
                  {p.connect && <span className="etiqueta etiqueta-viva">Connect</span>}
                </div>
                <p className="lede mt-4">{p.linha}</p>
                <ul className="mt-8">
                  {p.itens.map((it) => (
                    <li key={it} className="fio-cima py-3 text-[1rem] leading-snug">
                      {it}
                    </li>
                  ))}
                </ul>

                {/* No telemóvel não há montra presa: cada pessoa leva o seu ecrã por baixo. */}
                <div className="mt-8 grid place-items-center lg:hidden">
                  {p.montra.tipo === "pc" ? (
                    <Monitor capturas={[p.montra.captura]} plano={{ captura: p.montra.captura }} />
                  ) : (
                    <Telemovel capturas={[p.montra.captura]} atual={p.montra.captura} />
                  )}
                </div>
              </article>
            ))}
          </div>

          <div className="hidden lg:block">
            <div className="sticky top-(--topo) grid h-[calc(100svh-var(--topo))] place-items-center py-8">
              <div className="relative grid w-full place-items-center">
                <div
                  className="col-start-1 row-start-1 w-full transition-[opacity,transform] duration-700"
                  style={pessoa.montra.tipo === "pc" ? undefined : { opacity: 0, transform: "scale(0.96)" }}
                >
                  <Monitor
                    capturas={pcs.map((p) => p.montra.captura)}
                    plano={{ captura: pessoa.montra.tipo === "pc" ? pessoa.montra.captura : pcs[0].montra.captura }}
                    urgente
                  />
                </div>
                <div
                  className="col-start-1 row-start-1 transition-[opacity,transform] duration-700"
                  style={pessoa.montra.tipo === "tel" ? undefined : { opacity: 0, transform: "scale(0.96)" }}
                >
                  <Telemovel
                    capturas={tels.map((p) => p.montra.captura)}
                    atual={pessoa.montra.tipo === "tel" ? pessoa.montra.captura : tels[0].montra.captura}
                    rot={pessoa.id === "atleta" ? -3 : pessoa.id === "socio" ? 3 : 0}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Por baixo: as decisões que não se veem. */}
      <section className="bloco palco-noite faixa">
        <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
          <div>
            <h2 className="titulo t2 max-w-[12ch]">O que não se vê.</h2>
            <p className="lede mt-5">Um clube guarda dados de menores. Estas são as regras que os protegem.</p>
          </div>
          <dl className="grid gap-x-10 sm:grid-cols-2">
            {SECURITY.map((s) => (
              <div key={s.title} className="fio-cima py-5">
                <dt className="titulo t4">{s.title}</dt>
                <dd className="mt-1.5 text-[0.95rem] leading-relaxed text-texto-2">{s.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* O roteiro: o que ainda não existe, dito com clareza. */}
      <section id="roteiro" className="palco-cal faixa scroll-mt-(--topo)">
        <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
          <div>
            <h2 className="titulo t2 max-w-[12ch]">O que vem a seguir.</h2>
            <p className="lede mt-5">As datas são intenções. O que aqui está ainda não existe no produto.</p>
          </div>
          <ol>
            {ROADMAP.map((r) => (
              <li key={r.title} className="fio-cima grid gap-x-8 gap-y-1 py-6 sm:grid-cols-[150px_minmax(0,1fr)]">
                <p className="rotulo pt-1.5 text-texto-3">{r.when}</p>
                <div>
                  <h3 className="titulo t3">{r.title}</h3>
                  <p className="corpo mt-2">{r.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bloco palco-noite mb-[clamp(8px,1.2vw,20px)]">
        <div className="wrap faixa-curta flex flex-wrap items-center justify-between gap-8">
          <p className="titulo t2 max-w-[18ch]">Queres ver isto com o teu clube lá dentro?</p>
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
      </section>
    </>
  );
}
