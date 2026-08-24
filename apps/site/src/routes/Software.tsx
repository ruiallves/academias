import { Link } from "react-router-dom";
import { ProductFrame, Reveal, SectionMark, cx } from "@/components/primitives";
import { AppShot, ConsoleShot } from "@/components/shots";
import { MODULES } from "@/lib/content";

/**
 * Software — a página para quem já percebeu a ideia e quer ver a lista.
 *
 * A landing vende a tese; esta responde a "mas isso faz o quê, ao certo?".
 *
 * **O produto vem primeiro.** As duas interfaces aparecem logo a seguir ao título,
 * antes da lista de módulos: quem chega aqui quer ver, e uma lista de sete módulos
 * a abrir a página é uma lista que se lê sem se saber ainda ao que se parece.
 *
 * O que está incluído em cada plano é dito **em cada módulo**, e não numa tabela de
 * comparação no fim — é onde a pergunta nasce.
 */
export default function Software() {
  return (
    <>
      <header className="border-b border-line">
        <div className="wrap pt-14 pb-12 sm:pt-20 sm:pb-16">
          <Reveal>
            <SectionMark n="—">Software</SectionMark>
            <h1 className="display d1 mt-6 max-w-[15ch]">Tudo o que a plataforma faz hoje.</h1>
            <p className="lede mt-6">
              Sete módulos, uma base de dados, um controlo de acessos. O que está aqui está construído e em uso — o que
              está a caminho tem uma secção só para si.
            </p>
          </Reveal>
        </div>
      </header>

      {/* As duas caras */}
      <section className="band-tight border-t border-line bg-paper-2">
        <div className="wrap">
          <Reveal>
            <h2 className="display d2 max-w-[16ch]">O mesmo sistema, visto de dois sítios.</h2>
          </Reveal>

          <div className="mt-12 grid items-start gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
            <Reveal i={1}>
              <ProductFrame label="Consola · direção e treinadores" shot="/shots/consola.png" alt="A consola do clube">
                <ConsoleShot className="min-h-[360px]" />
              </ProductFrame>
              <p className="mt-4 max-w-[52ch] text-[14.5px] leading-relaxed text-ink-2">
                Uma aplicação, vários papéis. A navegação, os ecrãs e os dados mudam consoante quem entra — a direção vê
                o clube, o treinador vê as equipas dele, o departamento clínico vê o que é clínico.
              </p>
            </Reveal>

            <Reveal i={2}>
              <div className="flex justify-center">
                <AppShot />
              </div>
              <p className="mx-auto mt-6 max-w-[34ch] text-center text-[14.5px] leading-relaxed text-ink-2">
                A app das famílias, com a marca do clube. Instala-se a partir de um link, sem loja de aplicações.
              </p>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Os módulos */}
      <section className="band-tight">
        <div className="wrap">
          <ul className="grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m, i) => (
              <Reveal key={m.key} as="li" i={i % 3}>
                <div className="flex items-baseline gap-3">
                  <h2 className="text-[19px] font-semibold tracking-[-0.025em]">{m.name}</h2>
                  {m.paidTier && <span className="tag tag-live">Clube Ligado</span>}
                </div>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{m.line}</p>
                <ul className="mt-4 space-y-1.5 border-t border-line pt-4">
                  {m.items.map((it) => (
                    <li key={it} className="flex gap-2.5 text-[14.5px] text-ink-2">
                      <span
                        aria-hidden
                        className="mt-[9px] size-1.5 shrink-0 bg-field"
                        style={{ clipPath: "polygon(0 0, 100% 50%, 0 100%)" }}
                      />
                      {it}
                    </li>
                  ))}
                </ul>
              </Reveal>
            ))}
          </ul>
        </div>
      </section>

      {/* Fundações — a parte técnica, para quem pergunta */}
      <section className="dark band">
        <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
          <Reveal>
            <SectionMark n="—">Por baixo</SectionMark>
            <h2 className="display d2 mt-7 max-w-[13ch]">As decisões que não se vêem.</h2>
            <p className="lede mt-5 text-ink-2">
              São estas que decidem se a plataforma aguenta um clube a sério.
            </p>
          </Reveal>

          <Reveal i={1}>
            <dl className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
              {[
                ["Isolamento na base de dados", "Cada clube é uma ilha, garantida pela base de dados e não por um filtro na aplicação."],
                ["Permissões como dados", "Papéis e verbos configuráveis pelo clube, não condições espalhadas pelo código."],
                ["Âmbito por equipa e por atleta", "Derivado do servidor a cada pedido. A interface não é a fronteira."],
                ["O pagamento é do servidor", "Só a confirmação do banco muda um estado para pago."],
                ["App instalável, sem loja", "PWA com notificações, ícone e nome do clube."],
                ["Registo de auditoria", "Append-only. O que se faz fica escrito."],
              ].map(([t, d]) => (
                <div key={t} className="border-t border-line pt-5">
                  <dt className="text-[16px] font-semibold tracking-[-0.02em]">{t}</dt>
                  <dd className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{d}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </section>

      <section className="band-tight border-t border-line">
        <div className="wrap flex flex-wrap items-center justify-between gap-6">
          <p className={cx("display d3 max-w-[20ch]")}>Queres ver isto com os dados do teu clube?</p>
          <div className="flex flex-wrap gap-3">
            <Link to="/contactos" className="btn btn-ink">
              Marcar uma demonstração
            </Link>
            <Link to="/planos" className="btn btn-outline">
              Ver planos
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
