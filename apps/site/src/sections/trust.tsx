import { useState } from "react";
import { Link } from "react-router-dom";
import { Reveal, SectionMark, cx } from "@/components/primitives";
import { CONTACT_EMAIL, FAQ, ROADMAP, SECURITY } from "@/lib/content";

/* ========================================================================== */
/* 08 — Segurança                                                             */
/* ========================================================================== */

/**
 * Segurança.
 *
 * ## Porque é que esta secção é longa e escura
 *
 * Porque é a objecção real. Um clube está a decidir pôr fichas de menores — nomes,
 * datas de nascimento, NIF, lesões — num sítio que não controla. Despachar isso com
 * três ícones e a palavra "encriptação" é o que fazem as páginas que não pensaram
 * no assunto.
 *
 * O tom é o de quem explica, não o de quem tranquiliza. Em particular, dizemos o
 * que **não** podemos prometer: temos acesso administrativo, e a honestidade sobre
 * isso vale mais do que a frase de marketing que diz o contrário.
 */
export function Seguranca() {
  return (
    <section id="seguranca" className="dark band">
      <div className="wrap">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-20">
          <Reveal>
            <SectionMark n="08">Segurança e dados</SectionMark>
            <h2 className="display d2 mt-7 max-w-[15ch]">São crianças. Tratamos os dados como tal.</h2>
            <p className="lede mt-5 text-ink-2">
              O clube é o responsável pelos dados; nós somos quem os trata em nome dele. Aqui está o que isso significa
              na prática, sem linguagem jurídica.
            </p>
            <a href={`mailto:${CONTACT_EMAIL}?subject=Seguranca`} className="btn btn-outline mt-8">
              Falar connosco sobre segurança
            </a>
          </Reveal>

          <Reveal i={1}>
            <ul className="grid gap-x-10 gap-y-7 sm:grid-cols-2">
              {SECURITY.map((s) => (
                <li key={s.title} className="border-t border-line pt-5">
                  <p className="text-[16px] font-semibold tracking-[-0.02em]">{s.title}</p>
                  <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{s.body}</p>
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
/* 09 — Roteiro                                                               */
/* ========================================================================== */

/**
 * O roteiro.
 *
 * Uma linha do tempo com estações, não uma grelha de cartões: a ordem é a
 * informação — o que vem primeiro é a pergunta que um clube faz.
 *
 * As datas são intenções e a página di-lo. Uma landing que mistura o que existe com
 * o que está planeado ganha a primeira reunião e perde o cliente na segunda — e num
 * mercado onde os clubes se conhecem todos, perde também os outros.
 */
export function Roteiro({ n = "09" }: { n?: string } = {}) {
  return (
    <section id="roteiro" className="band border-t border-line bg-paper-2">
      <div className="wrap">
        <Reveal>
          <SectionMark n={n}>A caminho</SectionMark>
        </Reveal>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          <Reveal i={1}>
            <h2 className="display d2 max-w-[16ch]">O nosso roteiro para os próximos tempos.</h2>
          </Reveal>
          <Reveal i={2}>
            <p className="max-w-[42ch] text-[15.5px] leading-relaxed text-ink-2">
              Nada nesta linha existe hoje, e as datas são intenções. É com isto que pode contar nos proximos meses, e é com isto que pode decidir se quer começar a usar a plataforma já.
            </p>
          </Reveal>
        </div>

        {/*
          Uma linha do tempo, e não uma grelha de cartões.

          A ordem é a informação: primeiro as integrações, depois o scouting, depois
          a inteligência sobre os dados. Numa grelha, tudo parece simultâneo — e a
          pergunta que um clube faz é sempre "o que vem primeiro".
        */}
        <Reveal i={3}>
          <ol className="relative mt-14">
            <span aria-hidden className="absolute top-2 bottom-2 left-[6px] w-px bg-line-2 md:left-[150px]" />

            {ROADMAP.map((r, i) => (
              <li
                key={r.title}
                /*
                 * `md:pr-10` na coluna da data: sem ele, uma estação com duas
                 * palavras ("Inverno 2026/27") encostava ao ponto da linha e
                 * chegava a passar-lhe por baixo. A folga é entre o fim do texto e
                 * a linha, não à volta do bloco inteiro.
                 */
                className="relative grid gap-x-8 gap-y-2 pb-10 pl-8 last:pb-0 md:grid-cols-[150px_minmax(0,1fr)] md:pl-0"
              >
                <span
                  aria-hidden
                  className="absolute top-[7px] left-0 size-[13px] rounded-full border-2 border-field bg-paper-2 md:left-[144px]"
                  style={{ opacity: 1 - i * 0.12 }}
                />
                <p className="font-mono text-[12px] leading-[1.35] tracking-[0.06em] text-field uppercase md:pr-10 md:text-right">
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
/* 11 — Perguntas                                                             */
/* ========================================================================== */

export function Perguntas() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="perguntas" className="band border-t border-line">
      <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-20">
        <Reveal>
          <SectionMark n="11">Perguntas</SectionMark>
          <h2 className="display d2 mt-7 max-w-[12ch]">O que os clubes perguntam.</h2>
          <p className="mt-5 max-w-[34ch] text-[15px] leading-relaxed text-ink-2">
            Se faltar alguma, escreve — respondemos com o que é verdade hoje, não com o que gostávamos que fosse.
          </p>
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
                    {/* Um sinal de mais que roda para menos. A microinteração mais
                        antiga que há, e ainda a mais legível. */}
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
/* 12 — O fecho                                                               */
/* ========================================================================== */

export function Fecho() {
  return (
    <section className="dark">
      <div className="wrap band">
        <Reveal>
          <h2 className="display d1 max-w-[13ch]">Pronto para simplificar o clube?</h2>
        </Reveal>
        <Reveal i={1}>
          <p className="lede mt-7 text-ink-2">
            Trinta dias com a plataforma toda. Montamos o clube contigo — equipas, atletas, mensalidades e o convite às
            famílias — e no fim decides.
          </p>
        </Reveal>
        <Reveal i={2}>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link to="/contactos" className="btn btn-primary">
              Começar gratuitamente
            </Link>
            <Link to="/planos" className="btn btn-outline">
              Ver os planos
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
