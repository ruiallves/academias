import { Link } from "react-router-dom";
import { ProductFrame, Reveal, SectionMark } from "@/components/primitives";
import { AppShot, ConsoleShot } from "@/components/shots";

/* ========================================================================== */
/* Herói                                                                      */
/* ========================================================================== */

/**
 * O herói.
 *
 * ## A frase
 *
 * "O clube inteiro. Finalmente ligado." — e não "plataforma all-in-one de gestão
 * desportiva". A segunda descreve a categoria; a primeira descreve o alívio. Um
 * diretor não acorda a querer uma plataforma: acorda a querer parar de perguntar
 * ao treinador quem faltou.
 *
 * ## O visual
 *
 * Duas interfaces, não uma. Um painel gigante de dashboard é o cliché da categoria
 * e não diz nada; a consola e o telemóvel lado a lado dizem a tese inteira antes de
 * se ler uma linha — isto é uma coisa só, vista de dois sítios.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--color-line) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
          maskImage: "linear-gradient(to bottom, black, transparent 78%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 78%)",
        }}
      />

      <div className="wrap relative pt-16 pb-14 sm:pt-24 sm:pb-20">
        <Reveal>
          <p className="tag tag-live">
            <span className="size-1.5 rounded-full bg-current" />
            Em uso em clubes portugueses
          </p>
        </Reveal>

        <Reveal i={1}>
          <h1 className="display d1 mt-6 max-w-[16ch]">
            O teu clube
            <br />
            num só lugar.
          </h1>
        </Reveal>

        <Reveal i={2}>
          <p className="lede mt-6">
            A plataforma mais atual de gestão desportiva portuguesa. Liga a direção, os treinadores, os teus departamentos e as famílias aqui mesmo.
          </p>
        </Reveal>

        <Reveal i={3}>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link to="/contactos" className="btn btn-ink">
              Experimentar 30 dias
            </Link>
            <a href="#sistema" className="btn btn-outline">
              Ver como funciona
            </a>
          </div>
        </Reveal>
      </div>

      <div className="wrap relative pb-16 sm:pb-24">
        <Reveal i={4}>
          <div className="relative">
            <ProductFrame
              label="app.academias.pt — Life Club"
              shot="/shots/consola.png"
              alt="A consola do clube: precisa de atenção, métricas e a semana"
              className="shadow-[0_40px_80px_-56px_rgb(12_16_15/0.45)]"
            >
              <ConsoleShot className="min-h-[340px]" />
            </ProductFrame>

            <div className="mt-6 flex justify-center lg:absolute lg:-right-2 lg:-bottom-16 lg:mt-0 xl:-right-8">
              <AppShot />
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* 01 — O sistema                                                             */
/* ========================================================================== */

const FLUXOS = [
  {
    from: "O treinador convoca",
    to: "A família recebe",
    body: "A convocatória fecha na consola e chega ao telemóvel do pai com hora, sítio e o que levar. Ninguém reencaminha nada.",
  },
  {
    from: "O clube lança a mensalidade",
    to: "O pai paga no telemóvel",
    body: "Uma mensalidade por escalão, ou um valor só para aquele atleta. Aparece na app da família com o prazo à vista.",
  },
  {
    from: "O banco confirma",
    to: "O clube vê o estado mudar",
    body: "A confirmação chega do banco ao servidor e o estado muda sozinho, na consola e na app.",
  },
];

const CAMADAS = [
  { name: "Direção", line: "vê o clube todo" },
  { name: "Treinadores", line: "vêem as equipas deles" },
  { name: "Departamento clínico", line: "vê o que é clínico" },
  { name: "Famílias", line: "vêem os seus filhos" },
];

export function Sistema() {
  return (
    <section id="sistema" className="dark band">
      <div className="wrap">
        <Reveal>
          <SectionMark n="01">Como funciona</SectionMark>
        </Reveal>

        <Reveal i={1}>
          <h2 className="display d2 mt-7 max-w-[18ch]">
            Uma plataforma onde cada um vê exactamente o que é dele.
          </h2>
        </Reveal>

        <div className="mt-14 grid gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          <Reveal i={2}>
            <p className="eyebrow">Um clube, quatro pontos de vista</p>
            <ul className="mt-6">
              {CAMADAS.map((c, i) => (
                <li key={c.name} className="relative border-t border-line py-5 pl-9 last:border-b">
                  <span
                    aria-hidden
                    className="absolute top-[26px] left-0 size-2 rounded-full bg-mint"
                    style={{ opacity: 1 - i * 0.16 }}
                  />
                  {i < CAMADAS.length - 1 && (
                    <span aria-hidden className="absolute top-[34px] bottom-[-14px] left-[3.5px] w-px bg-line-2" />
                  )}
                  <p className="text-[19px] font-semibold tracking-[-0.02em]">{c.name}</p>
                  <p className="text-[14.5px] text-ink-3">{c.line}</p>
                </li>
              ))}
            </ul>
            <p className="mt-6 max-w-[38ch] text-[14.5px] leading-relaxed text-ink-3">
              O âmbito não é uma opção da interface — é o servidor que decide. Um treinador não consegue pedir os
              atletas de outra equipa, nem que tente.
            </p>
          </Reveal>

          <Reveal i={3}>
            <p className="eyebrow">O que atravessa</p>
            <ul className="mt-6 space-y-3">
              {FLUXOS.map((f) => (
                <li key={f.from} className="rounded-[3px] border border-line p-6">
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[17px] font-semibold tracking-[-0.02em]">
                    {f.from}
                    <span aria-hidden className="text-mint">
                      →
                    </span>
                    {f.to}
                  </p>
                  <p className="mt-2 max-w-[52ch] text-[14.5px] leading-relaxed text-ink-2">{f.body}</p>
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
