import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Monitor, Telemovel, type Plano } from "@/components/aparelhos";
import { cx, Mark, Seta } from "@/components/marca";
import { CLUBES, NUMEROS } from "@/lib/content";
import { seguir, useParado } from "@/lib/scroll";
import { Passeio, type Passo } from "./Passeio";

/**
 * As secções da página inicial.
 *
 * A página mostra o produto a funcionar. Os ecrãs são capturas reais da
 * consola e da app, com os dados de um clube inventado, o CD Academias (ver
 * `scripts/capturas/GUIAO.md`).
 */

const limitar = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Escreve o progresso em `--p`, e só quando muda. Mudar uma variável obriga o
 * navegador a recalcular o estilo de tudo o que está dentro da secção, e uma
 * secção fora do ecrã tem sempre o mesmo valor.
 */
function escrever(el: HTMLElement, p: number) {
  const v = p.toFixed(3);
  if (el.dataset.p === v) return;
  el.dataset.p = v;
  el.style.setProperty("--p", v);
}

/** Quanto da secção já atravessou o ecrã: 0 quando entra por baixo, 1 quando sai por cima. */
function useAtravessar() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return seguir(el, (_p, r, vh) => {
      escrever(el, limitar((vh - r.top) / (vh + r.height)));
    });
  }, []);
  return ref;
}

/* -------------------------------------------------------------------------- */
/* Herói                                                                       */
/* -------------------------------------------------------------------------- */

export function Heroi() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return seguir(el, (_p, r) => {
      escrever(el, limitar(-r.top / (r.height * 0.6)));
    });
  }, []);

  return (
    <section ref={ref} className="heroi palco-cal">
      <div className="wrap">
        <h1 className="titulo t1 max-w-[13ch]">A infraestrutura digital do teu clube.</h1>

        <div className="mt-8 flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <p className="lede">
            Atletas, treinos, jogos, mensalidades e sócios. Uma consola para quem trabalha no clube e uma app para as
            famílias, os atletas e os sócios.
          </p>
          <div className="flex flex-wrap items-center gap-3">
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
        <div className="heroi-montra">
          <Monitor capturas={["con-visao-geral"]} plano={{ captura: "con-visao-geral" }} urgente />
          <div className="heroi-tel">
            <Telemovel capturas={["app-inicio"]} atual="app-inicio" rot={4} urgente />
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Clubes a correr                                                             */
/* -------------------------------------------------------------------------- */

export function Clubes() {
  const lista = (escondida: boolean) => (
    <ul aria-hidden={escondida || undefined}>
      {CLUBES.map((c) => (
        <li key={c}>{c}</li>
      ))}
    </ul>
  );

  return (
    <section className="clubes palco-cal" aria-label="Clubes que já confiam em nós">
      <p className="rotulo wrap mb-6">Clubes que já confiam em nós</p>
      {/* A lista vai duas vezes para a faixa dar a volta sem costura. */}
      <div className="clubes-pista">
        {lista(false)}
        {lista(true)}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* A app do clube: o telemóvel preso                                           */
/* -------------------------------------------------------------------------- */

type Capitulo = Passo & { captura: string; rot: number; escala?: number };

const APP: Capitulo[] = [
  {
    captura: "app-mensalidades-por-pagar",
    rot: 0,
    rotulo: "Mensalidades",
    titulo: "Mensalidades sem complicações.",
    texto: "A família vê o que há para pagar, mês a mês, e o que já está pago.",
  },
  {
    captura: "app-pagar",
    rot: 2,
    rotulo: "Pagamento",
    titulo: "Paga-se em dois toques.",
    texto: "MB WAY ou Multibanco, sem sair da app do clube.",
  },
  {
    captura: "app-mensalidades-pago",
    rot: -3,
    rotulo: "Confirmação",
    titulo: "O pagamento confirma‑se sozinho.",
    texto: "A confirmação vem do banco. No clube, ninguém marca nada à mão.",
  },
  {
    captura: "app-agenda",
    rot: 2,
    rotulo: "Calendário",
    titulo: "Treinos, jogos e convocatórias.",
    texto: "A semana do atleta, sempre atualizada, com resposta à convocatória na app.",
  },
  {
    captura: "app-atleta",
    rot: -2,
    rotulo: "Presenças",
    titulo: "Acompanhar cada treino.",
    texto: "A assiduidade fica registada, e a família avisa quando o atleta vai faltar.",
  },
  {
    captura: "app-atleta-avaliacoes",
    rot: 3,
    rotulo: "Evolução",
    titulo: "Ver o progresso do atleta.",
    texto: "As avaliações do treinador, competência a competência, ao longo da época.",
  },
  {
    captura: "app-socio-inicio",
    rot: -3,
    rotulo: "Sócios",
    titulo: "O cartão de sócio no telemóvel.",
    texto: "Com as quotas, os jogos e as novidades do clube.",
  },
  {
    captura: "app-inicio-serra",
    rot: 2,
    escala: 0.97,
    rotulo: "A marca do clube",
    titulo: "Com o nome e as cores do clube.",
    texto: "Cada clube tem a sua app. Instala-se a partir de um link, sem loja.",
  },
];

export function AppDoClube() {
  return (
    <section className="bloco palco-cal bg-sup">
      <div className="wrap pt-[clamp(64px,9vw,130px)]">
        <p className="rotulo">A app do clube</p>
        <h2 className="titulo t1 mt-4 max-w-[12ch]">O clube no telemóvel de cada família.</h2>
      </div>

      <Passeio id="app" ecras={6} passos={APP} variante="centro">
        {(passo) => {
          const c = APP[passo];
          return (
            // O disco de cor fica parado por trás; só o telemóvel roda.
            <div className="app-disco">
              <Telemovel capturas={APP.map((x) => x.captura)} atual={c.captura} rot={c.rot} escala={c.escala ?? 1} />
            </div>
          );
        }}
      </Passeio>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* A consola: o ecrã preso                                                     */
/* -------------------------------------------------------------------------- */

type Cena = Passo & { plano: Plano };

const CONSOLA: Cena[] = [
  {
    plano: { captura: "con-visao-geral" },
    rotulo: "Visão geral",
    titulo: "Saber o que precisa de atenção.",
    texto: "A consola abre com a lista do que há para tratar: mensalidades em atraso, exames a caducar, treinos por registar.",
  },
  {
    plano: { captura: "con-mensalidades-depois", realce: "linha-tomas" },
    rotulo: "Mensalidades",
    titulo: "Mensalidades que se cobram sozinhas.",
    texto: "Emitidas no início do mês, pagas na app e confirmadas pelo banco.",
  },
  {
    // A captura deste passo é escolhida pelo scroll: ver `QUADROS`, mais abaixo.
    plano: { captura: "con-quadro-1", foco: "campo", zoom: 1.3 },
    rotulo: "Treino",
    titulo: "Desenhar a jogada, fotograma a fotograma.",
    texto: "No editor tático, os jogadores e a bola movem-se de um fotograma para o seguinte. Continua a fazer scroll para os ver.",
  },
  {
    plano: { captura: "con-planeamento" },
    rotulo: "Planeamento",
    titulo: "Planear a semana e a época.",
    texto: "Cada treino com o seu plano, a distância ao jogo e a carga da semana.",
  },
  {
    plano: { captura: "con-presencas-depois", realce: "linha-tomas" },
    rotulo: "Presenças",
    titulo: "Presenças marcadas no campo.",
    texto: "Com as faltas avisadas pela família e as baixas do departamento clínico.",
  },
  {
    plano: { captura: "con-jogo-ficha", realce: "linha-tomas" },
    rotulo: "Jogos",
    titulo: "Da convocatória à ficha de jogo.",
    texto: "A equipa inicial, os minutos e os golos de cada atleta.",
  },
  {
    plano: { captura: "con-atleta-avaliacoes" },
    rotulo: "Avaliações",
    titulo: "Avaliar cada atleta, por competência.",
    texto: "O treinador avalia o plantel e publica. A família vê a avaliação na app.",
  },
  {
    plano: { captura: "con-comunicacao", foco: "leitura", zoom: 1.4 },
    rotulo: "Comunicação",
    titulo: "Comunicar e saber quem leu.",
    texto: "Avisos por equipa ou por escalão, com a taxa de leitura à vista.",
  },
  {
    plano: { captura: "con-inventario" },
    rotulo: "Inventário",
    titulo: "Saber o material que o clube tem.",
    texto: "Equipamentos, bolas e coletes, com o stock de cada artigo e o que foi entregue.",
  },
  {
    plano: { captura: "con-contas" },
    rotulo: "Contas",
    titulo: "As contas do clube, mês a mês.",
    texto: "Receitas e despesas no mesmo sítio, com o saldo sempre à vista.",
  },
];

/** Os quatro fotogramas da jogada no editor tático, tal como o treinador os desenhou. */
const QUADROS = ["con-quadro-1", "con-quadro-2", "con-quadro-3", "con-quadro-4"];
const PASSO_DO_TREINO = 2;
// Pela ordem em que aparecem, com os quatro fotogramas seguidos: o ecrã só monta a captura à vista e as vizinhas.
const CAPTURAS_DA_CONSOLA = CONSOLA.flatMap((x) => (x.plano.captura === QUADROS[0] ? QUADROS : [x.plano.captura]));

export function Consola() {
  // Dentro do passo do treino, o scroll passa os fotogramas da jogada um a um.
  const [quadro, setQuadro] = useState(0);

  return (
    <section className="bloco palco-noite mt-[clamp(8px,1.2vw,20px)]">
      <div className="wrap pt-[clamp(64px,9vw,130px)]">
        <p className="rotulo">A consola</p>
        <h2 className="titulo t1 mt-4 max-w-[12ch]">O clube inteiro, para quem lá trabalha.</h2>
      </div>

      <Passeio
        id="consola"
        ecras={9}
        passos={CONSOLA}
        aoAndar={(p) => {
          const dentro = limitar(p * CONSOLA.length - PASSO_DO_TREINO);
          setQuadro(Math.min(QUADROS.length - 1, Math.floor(dentro * QUADROS.length)));
        }}
      >
        {(passo) => {
          const cena = CONSOLA[passo];
          const plano = passo === PASSO_DO_TREINO ? { ...cena.plano, captura: QUADROS[quadro] } : cena.plano;
          return <Monitor capturas={CAPTURAS_DA_CONSOLA} plano={plano} />;
        }}
      </Passeio>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* O ciclo                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Os seis momentos do ciclo, cada um num cartão de cor com um número grande.
 * Os números são os do clube de exemplo, os mesmos que aparecem nos ecrãs acima.
 */
const CICLO: { titulo: string; texto: string; valor: string; legenda: string; cor: "acento" | "noite" | "branco" }[] = [
  { titulo: "Pagamento", texto: "A mensalidade é emitida, paga na app e confirmada pelo banco.", valor: "35,00 €", legenda: "Pago por MB WAY", cor: "acento" },
  { titulo: "Treino", texto: "O treinador desenha o exercício e monta o plano da sessão.", valor: "75 min", legenda: "Quarta, 19:00, Campo 2", cor: "noite" },
  { titulo: "Presença", texto: "No campo, marca quem veio. As faltas avisadas já lá estão.", valor: "14/16", legenda: "Presentes no treino", cor: "branco" },
  { titulo: "Avaliação", texto: "De tempos a tempos, avalia cada atleta por competência.", valor: "4,3", legenda: "Média em cinco", cor: "acento" },
  { titulo: "Evolução", texto: "As avaliações juntam-se e mostram o caminho do atleta.", valor: "", legenda: "De junho a outubro", cor: "noite" },
  { titulo: "Comunicação", texto: "O clube avisa as famílias e vê quem já leu.", valor: "41/46", legenda: "Famílias leram o aviso", cor: "branco" },
];

export function Ciclo() {
  const ref = useRef<HTMLElement>(null);
  const parado = useParado();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return seguir(el, (p) => escrever(el, p));
  }, []);

  // Com movimento reduzido, a pista deixa de andar com o scroll e passa a rolar à mão.
  if (parado) {
    return (
      <section className="palco-cal faixa">
        <div className="wrap">
          <h2 className="titulo t1 max-w-[13ch]">Do pagamento à evolução do atleta.</h2>
        </div>
        <div className="mt-10 overflow-x-auto">
          <CicloPista />
        </div>
      </section>
    );
  }

  return (
    <section ref={ref} className="ciclo palco-cal" style={{ height: "340svh" }}>
      <div className="ciclo-preso">
        <div className="wrap">
          <p className="rotulo">Tudo ligado</p>
          <h2 className="titulo t2 mt-3 max-w-[18ch]">Do pagamento à evolução do atleta.</h2>
        </div>
        <CicloPista />
      </div>
    </section>
  );
}

function CicloPista() {
  return (
    <ol className="ciclo-pista">
      {CICLO.map((c, i) => (
        <li key={c.titulo} className={cx("ciclo-cartao", c.cor === "branco" ? "ciclo-branco" : "palco-" + c.cor)}>
          <span className="ciclo-n">{i + 1}</span>
          <div className="ciclo-valor" aria-hidden>
            {c.valor ? (
              <b>{c.valor}</b>
            ) : (
              // A evolução não é um número: é a linha a subir.
              <svg viewBox="0 0 200 90" fill="none">
                <polyline points="6,78 52,62 98,58 146,34 194,10" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="194" cy="10" r="9" fill="var(--acento)" />
              </svg>
            )}
            <span>{c.legenda}</span>
          </div>
          <div>
            <h3 className="titulo t3">{c.titulo}</h3>
            <p className="mt-2 text-texto-2">{c.texto}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
/* -------------------------------------------------------------------------- */
/* De sete ferramentas para uma                                                */
/* -------------------------------------------------------------------------- */

const FERRAMENTAS = [
  "A folha de Excel das mensalidades",
  "O grupo dos pais",
  "A folha de presenças em papel",
  "Os comprovativos de transferência",
  "O caderno do treinador",
  "A pasta dos exames médicos",
  "Os cartões de sócio em cartolina",
];

export function Ferramentas() {
  const ref = useAtravessar();

  return (
    <section ref={ref} className="ferramentas palco-cal faixa">
      <div className="wrap grid gap-12 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-20">
        <div>
          <h2 className="titulo t1 max-w-[9ch]">De sete sítios para um.</h2>
          <p className="lede mt-6">Um clube vive hoje espalhado por folhas, grupos e pastas. Na Academias fica tudo ligado.</p>
        </div>
        <div className="flex flex-col justify-center gap-8">
          <ul className="ferramentas-lista">
            {FERRAMENTAS.map((f, i) => (
              <li key={f} className="ferramenta" style={{ ["--a" as string]: 0.16 + i * 0.035 }}>
                {f}
              </li>
            ))}
          </ul>
          <p className="ferramenta-uma self-start">
            <Mark size={44} />
            Academias
          </p>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Números                                                                     */
/* -------------------------------------------------------------------------- */

/** "5093" passa a "5 093", com um espaço que não parte a linha. */
const milhares = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

/** Conta de 0 até ao valor, uma vez, quando o número entra no ecrã. */
function Contador({ valor }: { valor: number }) {
  const ref = useRef<HTMLElement>(null);
  const parado = useParado();
  const [n, setN] = useState(valor);

  useEffect(() => {
    const el = ref.current;
    if (!el || parado) return;
    let quadro = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const inicio = performance.now();
        const andar = (agora: number) => {
          const t = limitar((agora - inicio) / 1400);
          setN(Math.round(valor * (1 - Math.pow(1 - t, 3))));
          if (t < 1) quadro = requestAnimationFrame(andar);
        };
        quadro = requestAnimationFrame(andar);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(quadro);
    };
  }, [valor, parado]);

  return (
    <b ref={ref}>
      {milhares(n)}
    </b>
  );
}

export function Numeros() {
  return (
    <section className="bloco palco-acento">
      <div className="wrap faixa">
        <h2 className="titulo t2 max-w-[16ch]">O que os clubes já fizeram na Academias.</h2>
        <div className="numeros-grelha mt-[clamp(36px,5vw,72px)]">
          {NUMEROS.itens.map((x) => (
            <p key={x.rotulo} className="numero">
              <Contador valor={x.valor} />
              <span>{x.rotulo}</span>
            </p>
          ))}
        </div>
        <p className="mt-10 text-[0.9rem] text-texto-3">Contados na plataforma a {NUMEROS.data}.</p>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Fecho                                                                       */
/* -------------------------------------------------------------------------- */

export function Fecho() {
  return (
    <section className="bloco palco-noite mb-[clamp(8px,1.2vw,20px)]">
      <div className="wrap faixa flex flex-col items-start gap-9">
        <h2 className="titulo t1 max-w-[12ch]">Experimenta com o teu clube lá dentro.</h2>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
          <Link to="/contactos" className="btn btn-cheio">
            Experimentar 30 dias
            <Seta />
          </Link>
          <p className="text-texto-2">Sem cartão e sem período mínimo.</p>
        </div>
      </div>
    </section>
  );
}
