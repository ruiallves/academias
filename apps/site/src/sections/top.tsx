import { useState } from "react";
import { Link } from "react-router-dom";
import { ProductFrame, Reveal, cx } from "@/components/primitives";
import { AppShot, ConsoleShot } from "@/components/shots";

/* ========================================================================== */
/* Herói                                                                      */
/* ========================================================================== */

/**
 * O herói.
 *
 * ## A composição
 *
 * Texto centrado, curto, em serifa — e logo a seguir o produto: a consola e o
 * telemóvel lado a lado, a atravessar a fronteira entre o papel e o
 * verde-pinheiro. A mudança de chão a meio da imagem é o gesto da página
 * inteira: o produto é a ponte entre o clube (em cima, à luz do dia) e a
 * plataforma (em baixo, a casa).
 *
 * ## O arco
 *
 * Atrás do título, um arco de 1px — o pontapé de canto do logótipo, em grande.
 * É decoração, mas é a **nossa** decoração: reconhece-se sem o logótipo à vista.
 *
 * As duas interfaces são tratadas como imagem: não-selecionáveis, sem eventos
 * (ver `.shot`). Capturas verdadeiras em `public/shots/` ganham sempre.
 */
export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* O arco de canto, em grande — 1px, a cor do filete. */}
      <svg
        aria-hidden
        className="pointer-events-none absolute -top-[220px] -left-[220px] size-[640px] text-line"
        viewBox="0 0 640 640"
        fill="none"
      >
        <path d="M0 640A640 640 0 0 0 640 0" stroke="currentColor" strokeWidth="1" />
        <path d="M0 520A520 520 0 0 0 520 0" stroke="currentColor" strokeWidth="1" opacity="0.6" />
      </svg>

      <div className="wrap relative pt-16 text-center sm:pt-24">
        <Reveal>
          <p className="eyebrow">Gestão desportiva para clubes portugueses</p>
        </Reveal>

        <Reveal i={1}>
          <h1 className="display d1 mx-auto mt-6 max-w-[15ch]">
            O teu clube, <em>num só lugar.</em>
          </h1>
        </Reveal>

        <Reveal i={2}>
          <p className="lede mx-auto mt-6">
            A plataforma mais atual de gestão desportiva portuguesa. Liga a direção, os treinadores, os departamentos e
            as famílias.
          </p>
        </Reveal>

        <Reveal i={3}>
          <div className="mt-9 flex flex-col items-center justify-center gap-5 sm:flex-row">
            <Link to="/contactos" className="btn btn-primary">
              Experimentar 30 dias
              <span aria-hidden className="arr">→</span>
            </Link>
            <Link to="/planos" className="link-arrow">
              Ver os planos
              <span aria-hidden className="arr">→</span>
            </Link>
          </div>
        </Reveal>
      </div>

      {/* O produto, a atravessar do papel para o pinheiro. */}
      <div className="relative mt-14 sm:mt-20">
        <div aria-hidden className="absolute inset-x-0 top-[38%] bottom-0 bg-pine" />
        <div className="wrap relative pb-16 sm:pb-24">
          <Reveal i={4}>
            <div className="relative">
              <ProductFrame
                label="app.academias.pt — Life Club"
                shot="/shots/consola.png"
                alt="A consola do clube: precisa de atenção, métricas e a semana"
                className="shadow-[0_48px_90px_-52px_rgb(6_24_20/0.6)]"
              >
                <ConsoleShot className="min-h-[340px]" />
              </ProductFrame>

              <div className="mt-6 flex justify-center lg:absolute lg:-right-2 lg:-bottom-14 lg:mt-0 xl:-right-8">
                <AppShot />
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* A tese                                                                     */
/* ========================================================================== */

const HOJE = [
  { o: "O plantel", onde: "vive num Excel." },
  { o: "As presenças", onde: "ficam num caderno." },
  { o: "Os avisos", onde: "perdem-se no WhatsApp." },
  { o: "As mensalidades", onde: "cobram-se uma a uma." },
];

/**
 * O clube, hoje.
 *
 * ## Porque é que esta é a primeira coisa a seguir ao herói
 *
 * Porque é a única que quem chega já conhece. Aqui estava a arquitectura de
 * permissões — quem vê o quê — e isso é uma resposta a uma pergunta que ninguém
 * fez ainda: é engenharia, dita antes de a pessoa saber ao que isto serve. (O
 * assunto não se perdeu: vive na secção de segurança, que é onde a pergunta
 * nasce a sério.)
 *
 * O que fica é o reconhecimento. Quatro linhas que um diretor lê e pensa "é
 * exactamente isto" — e o parágrafo a seguir não acusa as ferramentas, acusa a
 * distância entre elas, que é o que a plataforma vem fechar.
 */
export function Realidade() {
  return (
    <section id="sistema" className="dark">
      <div className="wrap band">
        <Reveal>
          <p className="eyebrow">O clube, hoje</p>
        </Reveal>

        <div className="mt-10">
          {HOJE.map((h, i) => (
            <Reveal key={h.o} i={i + 1}>
              <p className="display d2 border-t border-line py-6 last:border-b sm:py-7">
                {h.o} <em className="text-mint">{h.onde}</em>
              </p>
            </Reveal>
          ))}
        </div>

        <Reveal i={5}>
          <p className="mt-10 max-w-[56ch] text-[15.5px] leading-relaxed text-ink-2">
            Nenhuma destas ferramentas está errada — o problema é que não falam umas com as outras. Alguém no clube
            passa a semana a copiar informação de um sítio para o outro, e saber quem falta no sábado ainda custa três
            mensagens. É esse trabalho que desaparece.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* O campo                                                                    */
/* ========================================================================== */

/**
 * A fotografia.
 *
 * ## Porque é que a página precisa de uma
 *
 * Até aqui o site era feito só de duas matérias: tipografia e interface. Ambas
 * são desenhadas, e uma página inteiramente desenhada — sem nada que tenha sido
 * *apanhado* com uma máquina — é exactamente o que se lê como gerada. Uma
 * fotografia é a única coisa numa página que não pode ter sido inventada por
 * quem a compôs: alguém esteve lá.
 *
 * ## Onde entra
 *
 * A seguir às quatro linhas do clube de hoje e antes do produto. É a dobradiça
 * do argumento: o Excel e o caderno de um lado, o software do outro, e no meio a
 * razão por que qualquer das duas coisas existe. Sem esta imagem, a página passa
 * de uma queixa administrativa directamente para uma consola.
 *
 * ## O tratamento
 *
 * A fotografia não entra crua. Perde saturação, escurece, e assenta sobre o
 * verde da casa — fica **da paleta** em vez de ser um rectângulo colado. É o que
 * separa uma imagem de marca de uma imagem de banco de imagens.
 *
 * ## Sem ficheiro
 *
 * A faixa **muda de forma** em vez de ficar um buraco verde. Com fotografia é
 * alta e cinematográfica, com a frase encostada ao fundo; sem ela encolhe para
 * uma faixa estreita com a frase ao centro, que se lê como uma citação entre
 * dois capítulos. Nas duas versões é uma peça inteira — nunca um rectângulo
 * partido, a mesma regra das capturas de produto.
 */
export function Campo() {
  const [foto, setFoto] = useState(true);

  return (
    <section className={cx("relative isolate overflow-hidden bg-pine", !foto && "border-t border-line-2/20")}>
      {foto && (
        <>
          <img
            src="/fotos/campo.jpg"
            alt="Treino de futebol de formação ao fim da tarde"
            loading="lazy"
            draggable={false}
            className="absolute inset-0 size-full select-none object-cover opacity-[0.55] [filter:saturate(0.55)_contrast(1.05)]"
            onError={() => setFoto(false)}
          />
          {/* O escurecimento por baixo do texto — legibilidade sem uma caixa. */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(to top, rgb(14 51 45 / 0.92) 0%, rgb(14 51 45 / 0.35) 55%, rgb(14 51 45 / 0.15) 100%)",
            }}
          />
        </>
      )}
    </section>
  );
}
