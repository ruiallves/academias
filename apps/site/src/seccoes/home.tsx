import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Monitor, Telemovel } from "@/components/aparelhos";
import { Seta } from "@/components/marca";
import { CLUBES_COM_EMBLEMA, euro, NUMEROS, PLANS } from "@/lib/content";
import { useParado } from "@/lib/scroll";

/**
 * As secções da página inicial.
 *
 * Quatro, de propósito: o produto no computador e no telemóvel, os clubes que
 * já cá estão, um passeio por separadores (como o "Vê a plataforma em ação" da
 * Adjunto) e o convite. Os números da plataforma saíram a pedido do Rui. O inventário completo vive em /produto e os preços em
 * /planos. Já houve aqui nove secções, e depois oito: as duas versões foram
 * recusadas por serem confusas.
 *
 * Os ecrãs são capturas reais da consola e da app, com os dados de um clube
 * inventado, o CD Academias (ver `scripts/capturas/GUIAO.md`).
 */

/** O preço de entrada, para a página poder dizer "desde". */
const DESDE = euro(Math.min(...PLANS.filter((p) => !p.soon).map((p) => p.monthly)));

/* -------------------------------------------------------------------------- */
/* Herói                                                                       */
/* -------------------------------------------------------------------------- */

export function Heroi() {
  return (
    <section className="heroi palco-noite">
      <div className="wrap heroi-grelha">
        <div>
          {/* O que se escreve no Google. O título por baixo é o slogan. */}
          <p className="rotulo mb-6">Software de gestão de clubes desportivos</p>
          <h1 className="titulo t1 max-w-[14ch]">
            A infraestrutura digital do teu clube<span className="ponto">.</span>
          </h1>
          <p className="lede mt-7">
            Atletas, treinos, jogos, mensalidades e sócios. Uma consola para quem trabalha no clube e uma app para as
            famílias, os atletas e os sócios.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link to="/contactos" className="btn btn-cheio">
              Experimentar 30 dias
              <Seta />
            </Link>
            <Link to="/planos" className="btn btn-fio">
              Ver planos
            </Link>
          </div>
          <p className="mt-4 text-[0.92rem] text-texto-3">Sem cartão. Depois, desde {DESDE} por mês.</p>
        </div>

        {/* À direita, a consola no computador e a app no telemóvel, à frente. */}
        <div className="heroi-montra" aria-hidden>
          <Monitor capturas={["con-visao-geral"]} plano={{ captura: "con-visao-geral" }} urgente />
          <div className="heroi-tel">
            <Telemovel capturas={["app-inicio"]} atual="app-inicio" urgente />
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Os clubes                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A faixa dos clubes, como a da Adjunto: o emblema num círculo e o nome ao
 * lado, a correr devagar, e os números da plataforma por baixo, a contar.
 * (Recusados antes: os nomes em letra gigante a correr, uma parede só de
 * nomes, e os números num bloco próprio com mais espaço à volta.)
 */
export function Clubes() {
  const lista = (escondida: boolean) => (
    <ul aria-hidden={escondida || undefined}>
      {CLUBES_COM_EMBLEMA.map((c) => (
        <li key={c.nome}>
          <img src={c.emblema} alt="" width={56} height={56} loading="lazy" />
          <span>{c.nome}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="clubes palco-cal" aria-label="Clubes que já usam a Academias">
      <p className="clubes-titulo">Clubes que já usam a Academias</p>
      {/* A lista vai duas vezes para a faixa dar a volta sem costura. */}
      <div className="clubes-pista">
        {lista(false)}
        {lista(true)}
      </div>
      {/* Os números ocupam o espaço que já havia entre a faixa e a secção seguinte, e só esse. */}
      <dl className="clubes-numeros">
        {NUMEROS.itens.map((x) => (
          <div key={x.rotulo}>
            <dd>
              <Contador valor={x.valor} />
            </dd>
            <dt>{x.rotulo}</dt>
          </div>
        ))}
      </dl>
    </section>
  );
}

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
          const t = Math.min(1, (agora - inicio) / 1400);
          setN(Math.round(valor * (1 - Math.pow(1 - t, 3))));
          if (t < 1) quadro = requestAnimationFrame(andar);
        };
        setN(0);
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

  return <b ref={ref}>{milhares(n)}</b>;
}

/* -------------------------------------------------------------------------- */
/* O que a Academias faz: um passeio por separadores                           */
/* -------------------------------------------------------------------------- */

type Area = {
  nome: string;
  titulo: string;
  texto: string;
  /** A consola no computador e a app no telemóvel: o mesmo assunto dos dois lados. */
  pc: string;
  tel: string;
  mais: { to: string; label: string };
};

const AREAS: Area[] = [
  {
    nome: "Gestão",
    titulo: "O clube inteiro arrumado",
    texto: "Atletas, famílias, equipas e staff, com os cargos e as permissões que o clube definir. A ficha de cada atleta junta os jogos, a assiduidade, os documentos e as mensalidades, e as contas do clube abrem também no telemóvel.",
    pc: "con-atleta",
    tel: "con-contas-tel",
    mais: { to: "/produto", label: "Tudo o que a consola faz" },
  },
  {
    nome: "Mensalidades",
    titulo: "O clube emite, a família paga, o banco confirma",
    texto: "As mensalidades saem no início do mês, por escalão ou por atleta. A família paga na app por MB WAY, Multibanco ou cartão, e o estado muda sozinho na consola.",
    pc: "con-mensalidades-depois",
    tel: "app-mensalidades-pago",
    mais: { to: "/mensalidades-clube", label: "Como funcionam as mensalidades" },
  },
  {
    nome: "Treinos",
    titulo: "Do exercício à presença no campo",
    texto: "O treinador desenha o exercício no editor tático, monta o plano da sessão e marca as presenças. A família vê a agenda e avisa quando o atleta falta.",
    pc: "con-quadro-2",
    tel: "app-agenda",
    mais: { to: "/gestao-clubes-futebol", label: "Para clubes de futebol" },
  },
  {
    nome: "Jogos",
    titulo: "Da convocatória à ficha de jogo",
    texto: "A convocatória chega ao telemóvel de cada família, que confirma ou diz que não pode. No fim, a ficha guarda os minutos e os golos de cada atleta.",
    pc: "con-jogo-ficha",
    tel: "app-convocatoria",
    mais: { to: "/gestao-clubes-futebol", label: "Jogos e convocatórias" },
  },
  {
    nome: "Comunicação",
    titulo: "Avisos que chegam, e saber quem leu",
    texto: "O clube escreve para uma equipa, um escalão ou o clube todo. O aviso chega como notificação, e a consola mostra quantas famílias já leram.",
    pc: "con-comunicacao",
    tel: "app-aviso",
    mais: { to: "/app-clube", label: "A app do clube" },
  },
  {
    nome: "Sócios",
    titulo: "Quotas, cartão e adesão online",
    texto: "As categorias e as quotas definem-se na consola. O sócio tem o cartão digital e paga as quotas na mesma app das famílias.",
    pc: "con-socios",
    tel: "app-socio-inicio",
    mais: { to: "/gestao-socios", label: "Sócios e quotas" },
  },
  {
    nome: "Website",
    titulo: "O site do clube, com loja e bilheteira",
    texto: "As notícias, as equipas e o calendário saem do que o clube já tem na consola. A loja vende no próprio site, e o bilhete chega ao telemóvel com um código QR que se lê à porta.",
    pc: "site-inicio",
    tel: "site-tel-bilhete",
    mais: { to: "/site-clube", label: "O site do clube" },
  },
];

export function OQueFaz() {
  const [i, setI] = useState(0);
  const a = AREAS[i];

  return (
    <section className="oquefaz palco-cal faixa">
      <div className="wrap">
        <h2 className="titulo t2">
          O que a Academias faz<span className="ponto">.</span>
        </h2>

        <div className="areas-separadores" role="tablist" aria-label="Áreas da plataforma">
          {AREAS.map((x, n) => (
            <button
              key={x.nome}
              type="button"
              role="tab"
              id={`area-${n}`}
              aria-selected={n === i}
              aria-controls="area-painel"
              onClick={() => setI(n)}
            >
              {x.nome}
            </button>
          ))}
        </div>

        <div id="area-painel" role="tabpanel" aria-labelledby={`area-${i}`} className="area">
          <div className="area-texto">
            <h3 className="titulo t2">
              {a.titulo}
              <span className="ponto">.</span>
            </h3>
            <p className="lede mt-5">{a.texto}</p>
            <Link to={a.mais.to} className="ligacao-seta mt-8">
              {a.mais.label}
              <Seta />
            </Link>
          </div>
          <div className="area-montra" aria-hidden>
            <Monitor capturas={AREAS.map((x) => x.pc)} plano={{ captura: a.pc }} />
            <div className="area-tel">
              <Telemovel capturas={AREAS.map((x) => x.tel)} atual={a.tel} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* O que o clube ganha                                                         */
/* -------------------------------------------------------------------------- */

/**
 * As contas da estimativa, para um clube com `atletas`. Estão escritas na
 * própria secção, por baixo: não são medições, e a página diz isso.
 */
const CONTAS = {
  atletas: 150,
  atletasPorEquipa: 15,
  treinosPorSemana: 2,
  semanasPorMes: 4.33,
  jogosPorMes: 4,
  avisosPorMes: 4,
  minPorMensalidade: 2,
  minPorTreino: 5,
  minPorConvocatoria: 15,
  minPorAviso: 5,
};

const EQUIPAS = Math.round(CONTAS.atletas / CONTAS.atletasPorEquipa);

/** As horas por mês de cada tarefa que deixa de ser feita à mão. */
const PARTES = [
  { horas: (CONTAS.atletas * CONTAS.minPorMensalidade) / 60, texto: "a confirmar e marcar mensalidades" },
  { horas: (EQUIPAS * CONTAS.treinosPorSemana * CONTAS.semanasPorMes * CONTAS.minPorTreino) / 60, texto: "a passar presenças para o Excel" },
  { horas: (EQUIPAS * CONTAS.jogosPorMes * CONTAS.minPorConvocatoria) / 60, texto: "a perguntar quem vai ao jogo" },
  { horas: (EQUIPAS * CONTAS.avisosPorMes * CONTAS.minPorAviso) / 60, texto: "a repetir avisos em cada grupo" },
].map((p) => ({ ...p, horas: Math.max(1, Math.round(p.horas)) }));

const TOTAL_HORAS = PARTES.reduce((s, p) => s + p.horas, 0);

/**
 * O que o clube ganha: uma frase grande e as quatro partes por baixo.
 *
 * (Recusado antes: um seletor de atletas com barras por tarefa e linhas de
 * antes e agora, num bloco de fundo areia. O Rui quis mais simples.)
 */
export function Ganhos() {
  return (
    <section className="ganhos palco-cal">
      <div className="wrap">
        <h2 className="ganhos-frase titulo">
          Um clube com {CONTAS.atletas} atletas ganha cerca de{" "}
          <span className="ganhos-realce">
            <Contador valor={TOTAL_HORAS} /> horas
          </span>{" "}
          por mês<span className="ponto">.</span>
        </h2>

        <ul className="ganhos-partes">
          {PARTES.map((p) => (
            <li key={p.texto}>
              <span className="ganhos-horas">
                <Contador valor={p.horas} /> h
              </span>
              <span>{p.texto}</span>
            </li>
          ))}
        </ul>

        <p className="ganhos-nota">
          Uma estimativa, com {CONTAS.minPorMensalidade} minutos por mensalidade, {CONTAS.minPorTreino} por treino,{" "}
          {CONTAS.minPorConvocatoria} por convocatória e {CONTAS.minPorAviso} por aviso, em equipas de {CONTAS.atletasPorEquipa} atletas com{" "}
          {CONTAS.treinosPorSemana} treinos por semana, {CONTAS.jogosPorMes} jogos e {CONTAS.avisosPorMes} avisos por mês.
        </p>
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
        <h2 className="titulo t1 max-w-[12ch]">
          Experimenta com o teu clube lá dentro<span className="ponto">.</span>
        </h2>
        <div className="flex flex-wrap items-center gap-x-7 gap-y-4">
          <Link to="/contactos" className="btn btn-cheio">
            Experimentar 30 dias
            <Seta />
          </Link>
          <Link to="/planos" className="btn btn-fio">
            Ver planos
          </Link>
        </div>
        <p className="text-texto-2">Trinta dias com tudo, sem cartão e sem período mínimo. Depois, desde {DESDE} por mês.</p>
      </div>
    </section>
  );
}
