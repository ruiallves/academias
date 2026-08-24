import { Link } from "react-router-dom";
import { ProductFrame, Reveal, SectionMark, cx } from "@/components/primitives";
import { AppShot, ConsoleShot, MembershipShot } from "@/components/shots";

/* ========================================================================== */
/* 02 — Gestão do clube                                                       */
/* ========================================================================== */

/**
 * A gestão do clube.
 *
 * ## O que esta secção tem de fazer
 *
 * É o primeiro contacto com o produto a sério, e a pergunta de quem lê é simples:
 * *isto faz o que eu preciso?*. Por isso mostra a **amplitude** — plantel, época,
 * calendário, dinheiro, comunicação, clínico — e não três detalhes de interface.
 * Os detalhes vêm depois, em cada secção dedicada.
 *
 * A lista é curta e escrita em coisas, não em funcionalidades: "o plantel todo",
 * "a época inteira", "o dinheiro". Um diretor reconhece o seu trabalho nessas
 * palavras; não reconhece em "gestão centralizada de recursos".
 */
const GESTAO = [
  {
    t: "O plantel todo, sempre certo",
    d: "Atletas, escalões, equipas, staff e sócios num registo só. Inscreve-se um atleta em segundos, ou importa-se o plantel inteiro de um Excel — com validação linha a linha antes de gravar.",
  },
  {
    t: "A época inteira, num calendário",
    d: "Treinos, jogos, torneios e consultas. Marca-se uma vez e aparece a quem interessa: ao treinador da equipa, à família do atleta, à secretaria.",
  },
  {
    t: "Presenças e convocatórias sem papel",
    d: "O treino fecha-se no telemóvel ao lado do campo. A convocatória de sábado escolhe-se do plantel e sai para as famílias no momento em que fecha.",
  },
  {
    t: "O dinheiro do clube num sítio",
    d: "Mensalidades por escalão ou por atleta, quotas de sócio, e a dívida real de sempre — não só a do mês. Sem folha paralela para saber quem está em falta.",
  },
];

export function Consola() {
  return (
    <section id="software" className="band border-t border-line">
      <div className="wrap">
        <Reveal>
          <SectionMark n="02">Gestão do clube</SectionMark>
        </Reveal>

        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start lg:gap-16">
          <Reveal i={1}>
            <h2 className="display d2 max-w-[16ch]">Tudo o que um clube faz, num sítio só.</h2>
            <p className="lede mt-5">
              Do primeiro treino de Setembro ao último recibo de Junho. Uma plataforma que serve a secretaria, o
              balneário e a direção — sem cada um ter a sua ferramenta.
            </p>

            <ul className="mt-9 space-y-7">
              {GESTAO.map((c) => (
                <li key={c.t} className="border-t border-line pt-5">
                  <p className="text-[17px] font-semibold tracking-[-0.02em]">{c.t}</p>
                  <p className="mt-1.5 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">{c.d}</p>
                </li>
              ))}
            </ul>

            <Link to="/software" className="link mt-8 inline-block text-[15px]">
              Ver o software por dentro
            </Link>
          </Reveal>

          <Reveal i={2}>
            <ProductFrame
              label="Visão geral · Life Club"
              shot="/shots/consola.png"
              alt="Consola do clube"
              className="lg:sticky lg:top-24"
            >
              <ConsoleShot className="min-h-[340px]" />
            </ProductFrame>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* 03 — Equipa técnica                                                        */
/* ========================================================================== */

const TREINADOR = [
  { k: "Calendário", v: "Os treinos e jogos das equipas dele. Marca, altera ou cancela — e as famílias sabem sem ninguém escrever no grupo." },
  { k: "Presenças", v: "Fecha o treino em vinte segundos, no telemóvel, ao lado do campo. A assiduidade do atleta constrói-se sozinha." },
  { k: "Convocatórias", v: "Escolhe o plantel para sábado a partir de quem está disponível — o clínico já disse quem não pode jogar." },
  { k: "Avaliações", v: "As competências da modalidade, de 1 a 5, com o que está bem e o que se vai trabalhar. Avalia-se o plantel de uma vez, sem sair do ecrã." },
  { k: "Relatórios", v: "Um texto sobre o percurso de um atleta — interno, ou partilhado com a família quando o clube quiser." },
  { k: "Plantel", v: "A ficha de cada atleta: assiduidade, minutos, jogos, avaliações e disponibilidade clínica." },
  { k: "Scouting", v: "Pode pedir um reforço para uma posição e acompanhar quem o clube anda a observar." },
];

/**
 * A equipa técnica.
 *
 * Fundo escuro e duas colunas assimétricas — o corte visual mais forte da página.
 * É aqui que o produto deixa de ser software de secretaria e passa a ser uma
 * ferramenta de quem está no campo, e a mudança de ambiente diz isso antes do texto.
 */
export function Treinador() {
  return (
    <section className="dark band">
      <div className="wrap">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
          <Reveal>
            <SectionMark n="03">Equipa técnica</SectionMark>
            <h2 className="display d2 mt-7 max-w-[14ch]">Feito para quem está no campo.</h2>
            <p className="lede mt-5 text-ink-2">
              O treinador entra e vê as equipas dele — só as dele. Tudo o que regista tem consequência do outro lado, e
              nada do que regista precisa de ser copiado outra vez por alguém.
            </p>
          </Reveal>

          <Reveal i={1}>
            <dl>
              {TREINADOR.map((t, i) => (
                <div
                  key={t.k}
                  className={cx(
                    "grid grid-cols-[100px_minmax(0,1fr)] gap-5 border-t border-line py-5 sm:grid-cols-[140px_minmax(0,1fr)]",
                    i === TREINADOR.length - 1 && "border-b",
                  )}
                >
                  <dt className="font-mono text-[12px] tracking-[0.06em] text-mint uppercase">{t.k}</dt>
                  <dd className="text-[15.5px] leading-relaxed text-ink-2">{t.v}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* 04 — As famílias                                                           */
/* ========================================================================== */

const FAMILIA = [
  {
    t: "É a app do clube, não a nossa",
    d: "Nome, cor e ícone do clube. O pai instala o clube no telemóvel — nós não aparecemos em lado nenhum.",
  },
  {
    t: "Instala-se num link",
    d: "Sem App Store, sem aprovações, sem actualizações a fazer. Dois toques a partir da mensagem que o clube manda.",
  },
  {
    t: "Deixa de haver o grupo do WhatsApp",
    d: "Horário do treino, alteração de última hora, convocatória de sábado e mensalidade — tudo chega ao mesmo sítio, com aviso no telemóvel. Ninguém pergunta duas vezes a que horas é.",
  },
  {
    t: "Os pais vêem o filho crescer",
    d: "Assiduidade ao longo da época, jogos, avaliações do treinador e relatórios que o clube decida partilhar. É a parte que faz uma família sentir que o clube trabalha a sério.",
  },
];

export function Familias() {
  return (
    <section id="familias" className="band border-t border-line">
      <div className="wrap">
        <Reveal>
          <SectionMark n="04">Experiência da família</SectionMark>
        </Reveal>

        <Reveal i={1}>
          <h2 className="display d2 mt-7 max-w-[17ch]">A parte do produto que os pais vêem todos os dias.</h2>
          <p className="lede mt-5">
            É aqui que um clube deixa de parecer amador. A família instala a app do clube e passa a saber tudo o que
            precisa sem perguntar a ninguém.
          </p>
        </Reveal>

        <div className="mt-14 grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]">
          <Reveal i={2}>
            <div className="relative flex justify-center overflow-hidden rounded-[3px] px-6 py-14 sm:py-20">
              <div
                aria-hidden
                className="absolute inset-0"
                style={{ background: "radial-gradient(90% 70% at 50% 0%, #12796e 0%, #0f6b62 45%, #073f3a 100%)" }}
              />
              <div
                aria-hidden
                className="absolute inset-0 opacity-[0.14]"
                style={{
                  backgroundImage:
                    "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
                  backgroundSize: "44px 44px",
                }}
              />
              <div className="relative">
                <AppShot />
              </div>
            </div>
          </Reveal>

          <Reveal i={3}>
            <ul className="space-y-7">
              {FAMILIA.map((f) => (
                <li key={f.t} className="border-t border-line pt-5">
                  <p className="text-[17px] font-semibold tracking-[-0.02em]">{f.t}</p>
                  <p className="mt-1.5 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">{f.d}</p>
                </li>
              ))}
            </ul>
            <p className="mt-8 text-[13.5px] text-ink-3">
              Incluída no plano <span className="font-semibold text-ink">Clube Ligado</span>.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* 05 — Pagamentos                                                            */
/* ========================================================================== */

const PASSOS = [
  { n: "01", t: "O clube define", d: "Mensalidade por escalão, ou um valor só para aquele atleta. Define-se uma vez." },
  { n: "02", t: "A família recebe", d: "Aparece na app, com o prazo à vista e sem ninguém ter de mandar mensagem." },
  { n: "03", t: "O pai paga", d: "No telemóvel, em segundos, quando lhe der jeito." },
  { n: "04", t: "O banco confirma", d: "A confirmação chega ao servidor pela euPago, verificada." },
  { n: "05", t: "O clube vê", d: "O estado muda sozinho, na consola e na app. A dívida real está sempre certa." },
];

/**
 * Os meios de pagamento.
 *
 * Emblemas tipográficos e não logótipos: as marcas MB WAY, Multibanco e Apple Pay
 * têm regras de utilização próprias, e pôr um PNG apanhado da internet numa página
 * comercial é o tipo de coisa que dá uma carta de advogado.
 *
 * Para usar os oficiais, largar os ficheiros em `public/logos/` (a euPago fornece o
 * kit de marca aos clientes) e trocar o texto pela imagem — a moldura já está feita.
 */
const MEIOS = ["MB WAY", "Multibanco", "Cartão", "Apple Pay", "Google Pay"];

export function Pagamentos() {
  return (
    <section id="pagamentos" className="band border-t border-line bg-paper-2">
      <div className="wrap">
        <Reveal>
          <SectionMark n="05">Pagamentos</SectionMark>
        </Reveal>

        <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
          <Reveal i={1}>
            <h2 className="display d2 max-w-[15ch]">Menos cobranças. Menos mensagens.</h2>
          </Reveal>
          <Reveal i={2}>
            <p className="max-w-[40ch] text-[15.5px] leading-relaxed text-ink-2">
              A mensalidade deixa de ser uma tarefa de alguém. Passa a ser uma coisa que acontece — e que se vê
              acontecer.
            </p>
          </Reveal>
        </div>

        <Reveal i={3}>
          <ol className="relative mt-14 grid gap-8 md:grid-cols-5 md:gap-5">
            <span aria-hidden className="absolute top-[7px] right-0 left-0 hidden h-px bg-line-2 md:block" />
            {PASSOS.map((p) => (
              <li key={p.n} className="relative">
                <span aria-hidden className="mb-5 hidden size-[15px] items-center justify-center rounded-full bg-paper-2 md:flex">
                  <span className="size-2 rounded-full bg-field" />
                </span>
                <p className="font-mono text-[11.5px] tracking-[0.12em] text-ink-4">{p.n}</p>
                <p className="mt-1 text-[16.5px] font-semibold tracking-[-0.02em]">{p.t}</p>
                <p className="mt-1.5 text-[14.5px] leading-relaxed text-ink-2">{p.d}</p>
              </li>
            ))}
          </ol>
        </Reveal>

        {/* Os meios, com o processador à vista. */}
        <Reveal i={4}>
          <div className="mt-14 rounded-[3px] border border-line bg-chalk p-7 sm:p-9">
            <div className="flex flex-wrap items-start justify-between gap-8">
              <div>
                <p className="eyebrow">Processado pela euPago</p>
                <p className="mt-3 max-w-[44ch] text-[17px] leading-snug font-semibold tracking-[-0.02em]">
                  Um processador português, com os meios que as famílias portuguesas já usam.
                </p>
                <p className="mt-3 max-w-[52ch] text-[14.5px] leading-relaxed text-ink-2">
                  O dinheiro vai directo para a conta do clube. Nós não somos parte no pagamento — ligamos o clube ao
                  processador e mantemos o estado sempre certo dos dois lados.
                </p>
              </div>

              <ul className="flex flex-wrap gap-2">
                {MEIOS.map((m) => (
                  <li
                    key={m}
                    className="flex h-[46px] min-w-[104px] items-center justify-center rounded-[3px] border border-line-2 px-4 text-[13.5px] font-semibold tracking-[-0.01em]"
                  >
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* 06 — Scouting                                                              */
/* ========================================================================== */

const SCOUTING = [
  ["Uma lista de quem se anda a ver", "Nomes que chegaram por um treinador, por um jogo ou por um contacto. Com o clube de origem, a posição e quem os indicou."],
  ["Observações de jogo", "Quem foi ver, a que jogo, e o que achou — escrito no momento, não recordado três meses depois."],
  ["Pedidos da equipa técnica", "O treinador diz de que precisa: um lateral esquerdo para os Sub-15. O pedido fica registado e o scouting trabalha sobre ele."],
  ["Vídeo do clube", "Os clips ficam no clube, com acesso restrito a quem faz scouting — não num Drive partilhado com meio mundo."],
  ["Listas de decisão", "As opções por posição, prontas para a conversa de Janeiro."],
  ["Quando entra, já cá está", "O que se observou fica no histórico. Ninguém volta a escrever a ficha do atleta do zero."],
];

export function Scouting() {
  return (
    <section className="band border-t border-line">
      <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-20">
        <Reveal>
          <SectionMark n="06">Scouting</SectionMark>
          <h2 className="display d2 mt-7 max-w-[15ch]">Para os clubes que também olham para fora.</h2>
          <p className="lede mt-5">
            Acompanhar quem se anda a ver, guardar o que se viu, e chegar à decisão com o que o clube sabe — em vez do
            que alguém se lembra.
          </p>
          <p className="mt-6 max-w-[46ch] text-[15px] leading-relaxed text-ink-2">
            Vive à parte do plantel de propósito: quem ainda não é do clube não tem escalão, não tem mensalidade e não
            aparece nas listas de quem treina cá. E o acesso é próprio — nem toda a gente no clube deve ver isto.
          </p>
        </Reveal>

        <Reveal i={1}>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {SCOUTING.map(([t, d]) => (
              <li key={t} className="rounded-[3px] border border-line bg-chalk p-5">
                <p className="text-[15.5px] font-semibold tracking-[-0.02em]">{t}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{d}</p>
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}

/* ========================================================================== */
/* 07 — Sócios                                                                */
/* ========================================================================== */

/**
 * A página pública de adesão a sócio.
 *
 * A peça que mais surpreende numa demonstração: o clube não recebe só mensalidades
 * de atletas — recebe sócios, de qualquer pessoa da terra, por um link. E o cartão
 * preenche-se enquanto a pessoa escreve o nome.
 */
export function Socios() {
  return (
    <section id="socios" className="band border-t border-line bg-paper-2">
      <div className="wrap">
        <Reveal>
          <SectionMark n="07">Sócios</SectionMark>
        </Reveal>

        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center lg:gap-16">
          <Reveal i={1}>
            <h2 className="display d2 max-w-[14ch]">O clube também vive de sócios.</h2>
            <p className="lede mt-5">
              Uma página pública com a marca do clube, onde qualquer pessoa se torna sócia em dois minutos — e o clube
              deixa de andar atrás de fichas em papel.
            </p>

            <ul className="mt-9 space-y-6">
              {[
                ["As categorias são do clube", "Tudo configuravel pelo clube, categorias, cotas e benificios."],
                ["Adesão sem papel", "A pessoa preenche, aceita os termos e fica à espera de aprovação. A direção aprova e o número de sócio é atribuído."],
                ["Quotas como mensalidades", "As quotas cobram-se pelos mesmos meios, com o mesmo estado sempre certo."],
              ].map(([t, d]) => (
                <li key={t} className="border-t border-line pt-5">
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
              Incluída no plano <span className="font-semibold text-ink">Clube Ligado</span>.
            </p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
