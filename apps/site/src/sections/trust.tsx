import { useState } from "react";
import { Link } from "react-router-dom";
import { Reveal, SectionMark, cx } from "@/components/primitives";
import { CONTACT_EMAIL, FAQ, ROADMAP, SECURITY } from "@/lib/content";

/* ========================================================================== */
/* Segurança                                                                  */
/* ========================================================================== */

/**
 * Segurança.
 *
 * ## Porque é que esta secção é longa e escura
 *
 * Porque é a objecção real. Um clube está a decidir pôr fichas de menores num
 * sítio que não controla, e despachar isso com três ícones e a palavra
 * "encriptação" é o que fazem as páginas que não pensaram no assunto.
 *
 * O tom é o de quem explica, não o de quem tranquiliza — incluindo o que **não**
 * podemos prometer. A coluna da esquerda fica presa enquanto a lista corre: o
 * título acompanha a leitura inteira.
 */
export function Seguranca() {
  return (
    <section id="seguranca" className="dark">
      <div className="wrap band">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
          <Reveal>
            <div className="lg:sticky lg:top-28">
              <h2 className="display d2 max-w-[15ch]">São crianças. Tratamos os dados como tal.</h2>
              <p className="lede mt-5 text-ink-2">
                O clube é o responsável pelos dados; nós somos quem os trata em nome dele. Aqui está o que isso
                significa na prática, sem linguagem jurídica.
              </p>
              <a href={`mailto:${CONTACT_EMAIL}?subject=Seguranca`} className="link-arrow mt-8 inline-flex">
                Falar connosco sobre segurança
                <span aria-hidden className="arr">→</span>
              </a>
            </div>
          </Reveal>

          <Reveal i={1}>
            <ul>
              {SECURITY.map((s) => (
                <li key={s.title} className="border-t border-line py-6 last:border-b">
                  <p className="text-[17px] font-semibold tracking-[-0.02em]">{s.title}</p>
                  <p className="mt-1.5 max-w-[58ch] text-[14.5px] leading-relaxed text-ink-2">{s.body}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* Roteiro                                                                    */
/* ========================================================================== */

/**
 * O roteiro — uma linha do tempo com estações, não uma grelha de cartões.
 *
 * As datas são intenções e a página di-lo: uma landing que mistura o que existe
 * com o que está planeado ganha a primeira reunião e perde o cliente na segunda.
 */
export function Roteiro({ n }: { n?: string } = {}) {
  return (
    <section id="roteiro" className="band bg-paper-2">
      <div className="wrap">
        <Reveal>
          <SectionMark n={n}>A caminho</SectionMark>
        </Reveal>

        <div className="mt-6 flex flex-wrap items-end justify-between gap-6">
          <Reveal i={1}>
            <h2 className="display d2 max-w-[16ch]">O roteiro para os próximos tempos.</h2>
          </Reveal>
          <Reveal i={2}>
            <p className="max-w-[42ch] text-[15.5px] leading-relaxed text-ink-2">
              Nada nesta linha existe hoje, e as datas são intenções. É com isto que pode contar nos próximos meses — e
              é com isto que pode decidir se quer começar já.
            </p>
          </Reveal>
        </div>

        <Reveal i={3}>
          <ol className="relative mt-14">
            <span aria-hidden className="absolute top-2 bottom-2 left-[5px] w-px bg-line-2 md:left-[150px]" />

            {ROADMAP.map((r, i) => (
              <li
                key={r.title}
                className="relative grid gap-x-8 gap-y-2 pb-10 pl-8 last:pb-0 md:grid-cols-[150px_minmax(0,1fr)] md:pl-0"
              >
                <span
                  aria-hidden
                  className="absolute top-[8px] left-0 size-[11px] rounded-full border-2 border-field bg-paper-2 md:left-[145px]"
                  style={{ opacity: 1 - i * 0.12 }}
                />
                <p className="text-[12px] leading-[1.4] font-[650] tracking-[0.1em] text-field uppercase md:pr-10 md:text-right">
                  {r.when}
                </p>
                <div className="md:pl-8">
                  <p className="text-[18px] font-semibold tracking-[-0.02em]">{r.title}</p>
                  <p className="mt-1.5 max-w-[52ch] text-[14.5px] leading-relaxed text-ink-2">{r.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* Perguntas                                                                  */
/* ========================================================================== */

/**
 * As perguntas — na página de Planos, que é onde se compram respostas.
 * Acordeão de filete, com o sinal de mais a rodar: a microinteração mais antiga
 * que há, e ainda a mais legível.
 */
export function Perguntas() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="perguntas" className="band">
      <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-20">
        <Reveal>
          <div className="lg:sticky lg:top-28">
            <h2 className="display d2 max-w-[12ch]">O que os clubes perguntam.</h2>
            <p className="mt-5 max-w-[34ch] text-[15px] leading-relaxed text-ink-2">
              Se faltar alguma, escreve — respondemos com o que é verdade hoje, não com o que gostávamos que fosse.
            </p>
          </div>
        </Reveal>

        <Reveal i={1}>
          <ul>
            {FAQ.map((f, i) => {
              const on = open === i;
              return (
                <li key={f.q} className="border-t border-line last:border-b">
                  <button
                    type="button"
                    onClick={() => setOpen(on ? null : i)}
                    aria-expanded={on}
                    className="flex w-full items-start gap-5 py-5 text-left"
                  >
                    <span className="flex-1 text-[16.5px] font-semibold tracking-[-0.02em]">{f.q}</span>
                    <span aria-hidden className="relative mt-2 block size-3 shrink-0">
                      <span className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-ink" />
                      <span
                        className={cx(
                          "absolute top-0 left-1/2 h-full w-px -translate-x-1/2 bg-ink transition-transform duration-300",
                          on && "rotate-90",
                        )}
                        style={{ transitionTimingFunction: "var(--ease-out)" }}
                      />
                    </span>
                  </button>

                  <div
                    className="grid transition-[grid-template-rows] duration-300"
                    style={{ gridTemplateRows: on ? "1fr" : "0fr", transitionTimingFunction: "var(--ease-out)" }}
                  >
                    <div className="overflow-hidden">
                      <p className="max-w-[62ch] pb-6 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* O fecho                                                                    */
/* ========================================================================== */

/**
 * O fecho.
 *
 * A segunda fotografia da página, e a última coisa que se vê antes do rodapé:
 * o clube outra vez, agora por baixo da pergunta. Escurecida muito mais do que a
 * do meio — aqui a imagem é ambiente, não é o assunto, e o texto tem de ganhar
 * sem esforço. Sem ficheiro, fica o verde da casa e ninguém dá pela falta.
 */
export function Fecho() {
  return (
    <section className="dark relative isolate overflow-hidden border-t border-line">
      <img
        src="/fotos/fecho.jpg"
        alt=""
        loading="lazy"
        draggable={false}
        className="absolute inset-0 size-full select-none object-cover opacity-[0.28] [filter:saturate(0.4)]"
        onError={(e) => e.currentTarget.remove()}
      />
      <div aria-hidden className="absolute inset-0 bg-pine/72" />

      <div className="wrap band relative text-center">
        <Reveal>
          <h2 className="display d1 mx-auto max-w-[14ch]">
            Pronto para <em>simplificar o clube?</em>
          </h2>
        </Reveal>
        <Reveal i={1}>
          <p className="lede mx-auto mt-7 text-ink-2">
            Trinta dias com a plataforma toda, sem cartão. Montamos o clube contigo — equipas, atletas, mensalidades e
            o convite às famílias — e no fim decides.
          </p>
        </Reveal>
        <Reveal i={2}>
          <div className="mt-10 flex flex-col items-center justify-center gap-5 sm:flex-row">
            <Link to="/contactos" className="btn btn-primary">
              Começar gratuitamente
              <span aria-hidden className="arr">→</span>
            </Link>
            <Link to="/planos" className="link-arrow">
              Ver os planos
              <span aria-hidden className="arr">→</span>
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
