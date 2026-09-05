import { useState } from "react";
import { Link } from "react-router-dom";
import { ProductFrame, Reveal, SectionMark, cx } from "@/components/primitives";
import { PAYMENT_METHODS, PaymentMark } from "@/components/PaymentIcons";
import { AppShot, ConsoleShot, MembershipShot } from "@/components/shots";
import { CampoTaticoShot } from "@/components/shots-treino";
import { MODULES } from "@/lib/content";

/* ========================================================================== */
/* O produto — um tour, não quatro secções                                    */
/* ========================================================================== */

/**
 * O tour do produto.
 *
 * A homepage antiga explicava o produto em quatro secções compridas; esta
 * mostra-o num sítio só, com três separadores: a consola, a app das famílias e
 * a página de sócios. Quem quer a lista completa tem a página Software — a
 * homepage vende a vista, não o inventário.
 *
 * Os separadores são texto sublinhado, não pastilhas: é a microinteração de um
 * jornal, não a de uma app.
 */
type TabId = "consola" | "treino" | "familias" | "socios";

const TABS: {
  id: TabId;
  label: string;
  lede: string;
  points: [string, string][];
}[] = [
  {
    id: "consola",
    label: "A consola",
    lede: "Do primeiro treino de Setembro ao último recibo de Junho — a secretaria, o balneário e a direção na mesma plataforma.",
    points: [
      ["O plantel todo, sempre certo", "Atletas, escalões, equipas, staff e sócios num registo só — ou importado de um Excel, com validação linha a linha."],
      ["A época inteira, num calendário", "Treinos, jogos e consultas. Marca-se uma vez e aparece a quem interessa."],
      ["Presenças e convocatórias sem papel", "O treino fecha-se no telemóvel ao lado do campo; a convocatória sai para as famílias no momento em que fecha."],
      ["O dinheiro do clube num sítio", "Mensalidades por escalão ou por atleta, quotas de sócio, e a dívida real de sempre."],
    ],
  },
  {
    id: "treino",
    label: "Área técnica",
    lede: "O treino sai do caderno: o exercício desenha-se num campo à escala real, o plano monta-se por blocos e a carga calcula-se sozinha.",
    points: [
      ["Um editor tático com animação", "Jogadores, cones, zonas e setas num campo com as medidas verdadeiras — e frames para mostrar o movimento."],
      ["Futebol e futsal hoje, mais desportos a caminho", "Futebol de 11, 9, 7 e 5, e futsal — cada campo com as suas medidas e o seu piso. Em expansão para outras modalidades, a começar pelo basquetebol."],
      ["A carga sem folha à parte", "Minutos, intensidade e objetivo em cada bloco; o volume e o tempo por objetivo derivam daí."],
    ],
  },
  {
    id: "familias",
    label: "A app das famílias",
    lede: "A parte do produto que os pais vêem todos os dias — com o nome, a cor e o ícone do clube, não os nossos.",
    points: [
      ["Instala-se num link", "Sem App Store, sem aprovações. Dois toques a partir da mensagem que o clube manda."],
      ["Deixa de haver o grupo do WhatsApp", "Horário, alteração de última hora, convocatória e mensalidade — tudo chega ao mesmo sítio, com aviso no telemóvel."],
      ["Os pais vêem o filho crescer", "Assiduidade, jogos, avaliações do treinador e relatórios que o clube decida partilhar."],
    ],
  },
  {
    id: "socios",
    label: "Sócios",
    lede: "Uma página pública com a marca do clube, onde qualquer pessoa se torna sócia em dois minutos.",
    points: [
      ["As categorias são do clube", "Categorias, quotas e benefícios, tudo configurável pelo clube."],
      ["Adesão sem papel", "A pessoa preenche, a direção aprova, o número de sócio é atribuído."],
      ["Quotas como mensalidades", "Cobram-se pelos mesmos meios, com o mesmo estado sempre certo."],
    ],
  },
];

export function Tour() {
  const [tab, setTab] = useState<TabId>("consola");
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <section id="software" className="band">
      <div className="wrap">
        {/* O título e os separadores partilham o mesmo filete.
            Sem etiqueta por cima, sem parágrafo de apoio: o produto entra sem
            preâmbulo, e a secção abre de uma forma que nenhuma outra da página
            repete. */}
        <Reveal>
          <div className="flex flex-col gap-7 border-b border-line lg:flex-row lg:items-end lg:justify-between lg:gap-12">
            <h2 className="display d2 max-w-[14ch] lg:pb-6">Tudo o que um clube faz.</h2>

            <div role="tablist" aria-label="As caras do produto" className="flex flex-wrap gap-x-8 gap-y-2">
              {TABS.map((t) => {
                const on = t.id === tab;
                return (
                  <button
                    key={t.id}
                    role="tab"
                    type="button"
                    aria-selected={on}
                    onClick={() => setTab(t.id)}
                    className={cx(
                      "-mb-px border-b-2 pb-4 text-[15.5px] font-semibold tracking-[-0.01em] transition-colors",
                      on ? "border-field text-ink" : "border-transparent text-ink-3 hover:text-ink",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        </Reveal>

        <div className="mt-10 grid items-start gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <Reveal i={2} key={`text-${tab}`}>
            <p className="lede">{active.lede}</p>
            <ul className="mt-8">
              {active.points.map(([t, d]) => (
                <li key={t} className="border-t border-line py-4.5 last:border-b">
                  <p className="text-[16.5px] font-semibold tracking-[-0.02em]">{t}</p>
                  <p className="mt-1 max-w-[48ch] text-[14.5px] leading-relaxed text-ink-2">{d}</p>
                </li>
              ))}
            </ul>
            <Link to="/software" className="link-arrow mt-8 inline-flex">
              Ver tudo o que a plataforma faz
              <span aria-hidden className="arr">→</span>
            </Link>
          </Reveal>

          <Reveal i={3} key={`shot-${tab}`}>
            {tab === "consola" && (
              <ProductFrame label="Visão geral · Life Club" shot="/shots/consola.png" alt="A consola do clube">
                <ConsoleShot className="min-h-[340px]" />
              </ProductFrame>
            )}
            {tab === "treino" && (
              <ProductFrame
                label="Editor tático · Pressão após perda"
                shot="/shots/treino-editor.png"
                alt="O editor tático com um exercício desenhado"
              >
                <CampoTaticoShot className="min-h-[340px]" />
              </ProductFrame>
            )}
            {tab === "familias" && (
              <div className="canto flex justify-center overflow-hidden bg-pine px-6 py-12 sm:py-16">
                <AppShot />
              </div>
            )}
            {tab === "socios" && (
              <ProductFrame label="lifeclub.academias.pt/sersocio" shot="/shots/socios.png" alt="Página de adesão a sócio">
                <MembershipShot className="min-h-[300px]" />
              </ProductFrame>
            )}
          </Reveal>
        </div>

        {/* Os módulos, ditos por extenso — uma linha, não uma grelha. */}
        <Reveal i={4}>
          <p className="mt-16 border-t border-line pt-6 text-[14.5px] leading-relaxed text-ink-3">
            <span className="font-semibold text-ink">Dentro da plataforma: </span>
            {MODULES.map((m, i) => (
              <span key={m.key}>
                {m.name}
                {i < MODULES.length - 1 && <span aria-hidden className="mx-2 text-line-2">·</span>}
              </span>
            ))}
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* Pagamentos                                                                 */
/* ========================================================================== */

const PASSOS = [
  { t: "O clube define", d: "Mensalidade por escalão, ou um valor só para aquele atleta. Define-se uma vez." },
  { t: "A família recebe", d: "Aparece na app, com o prazo à vista e sem ninguém ter de mandar mensagem." },
  { t: "O pai paga", d: "No telemóvel, em segundos, quando lhe der jeito." },
  { t: "O banco confirma", d: "A confirmação chega ao servidor pela euPago, verificada." },
  { t: "O clube vê", d: "O estado muda sozinho, na consola e na app. A dívida real está sempre certa." },
];

/**
 * Pagamentos — cinco passos numerados em serifa, sobre papel escurecido.
 *
 * Os números grandes fazem o trabalho que antes faziam cartões: dão ritmo e
 * ordem sem caixas. Os meios de pagamento fecham a secção numa linha discreta,
 * com os logótipos verdadeiros — e com o nome escrito nos dois que não têm
 * logótipo para ter, o cartão e o débito directo. Ver `PaymentIcons.tsx`.
 */
export function Pagamentos() {
  return (
    <section id="pagamentos" className="band-tight bg-paper-2">
      <div className="wrap">
        {/* Uma batida curta a seguir ao tour, que é longo. Abre com a frase —
            não com uma etiqueta e um título — e vai directa aos cinco passos.
            O contraste de densidade entre secções é o ritmo da página. */}
        <Reveal>
          <h2 className="display d3 max-w-[30ch]">
            A mensalidade deixa de ser uma tarefa de alguém. Passa a ser uma coisa que acontece — e que se vê
            acontecer.
          </h2>
        </Reveal>

        <Reveal i={1}>
          <ol className="mt-12 grid gap-x-8 gap-y-10 border-t border-line pt-10 sm:grid-cols-2 lg:grid-cols-5">
            {PASSOS.map((p, i) => (
              <li key={p.t}>
                <p
                  className="display text-[2.6rem] leading-none text-ink-4"
                  aria-hidden
                >
                  {i + 1}
                </p>
                <p className="mt-3 text-[16.5px] font-semibold tracking-[-0.02em]">{p.t}</p>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{p.d}</p>
              </li>
            ))}
          </ol>
        </Reveal>

        {/* O processador e os meios — uma linha, não um cartão. */}
        <Reveal i={2}>
          <div className="mt-14 flex flex-col gap-6 border-t border-line pt-8 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="max-w-[54ch] text-[15px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">Processado pela euPago.</span> Um processador português, com
                os meios que as famílias portuguesas já usam. O dinheiro vai directo para a conta do clube — nós não
                somos parte no pagamento.
              </p>
            </div>
            {/* As marcas assentam directamente no papel — são tinta escura sobre
                creme, e uma pastilha à volta só acrescentaria uma caixa que a
                página não tem em mais lado nenhum. Ver `PaymentMark`. */}
            <ul className="flex flex-wrap items-center gap-x-7 gap-y-4" aria-label="Meios de pagamento aceites">
              {PAYMENT_METHODS.map((m) => (
                <li key={m.id} className="flex items-center">
                  <PaymentMark method={m} />
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* Sócios — a secção completa, usada na página Software                       */
/* ========================================================================== */

export function Socios({ n }: { n?: string } = {}) {
  return (
    <section id="socios" className="band bg-paper-2">
      <div className="wrap">
        <Reveal>
          <SectionMark n={n}>Sócios</SectionMark>
        </Reveal>

        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
          <Reveal i={1}>
            <h2 className="display d2 max-w-[14ch]">O clube também vive de sócios.</h2>
            <p className="lede mt-5">
              Uma página pública com a marca do clube, onde qualquer pessoa se torna sócia em dois minutos — e o clube
              deixa de andar atrás de fichas em papel.
            </p>

            <ul className="mt-9">
              {[
                ["As categorias são do clube", "Categorias, quotas e benefícios, tudo configurável pelo clube."],
                ["Adesão sem papel", "A pessoa preenche, aceita os termos e fica à espera de aprovação. A direção aprova e o número de sócio é atribuído."],
                ["Quotas como mensalidades", "As quotas cobram-se pelos mesmos meios, com o mesmo estado sempre certo."],
              ].map(([t, d]) => (
                <li key={t} className="border-t border-line py-5 last:border-b">
                  <p className="text-[16.5px] font-semibold tracking-[-0.02em]">{t}</p>
                  <p className="mt-1.5 max-w-[44ch] text-[15px] leading-relaxed text-ink-2">{d}</p>
                </li>
              ))}
            </ul>
          </Reveal>

          <Reveal i={2}>
            <ProductFrame label="lifeclub.academias.pt/sersocio" shot="/shots/socios.png" alt="Página de adesão a sócio">
              <MembershipShot className="min-h-[300px]" />
            </ProductFrame>
            <p className="mt-4 text-[13.5px] text-ink-3">
              Incluída no plano <span className="font-semibold text-ink">Connect</span>.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
