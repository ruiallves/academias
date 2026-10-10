import { useEffect, useMemo, useState } from "react";
import { cx } from "@/components/primitives";
import { Check, Pause, Play, Repeat, Trash2, X } from "@/lib/icons";
import { sportById } from "@/lib/api";
import { profileOf } from "@/lib/sports";
import { saveAddedTime, saveAppearances, saveOvertime, saveResult, type MatchDetail } from "@/lib/matches";
import { useJogadores, type Jogador } from "./GamePlan";
import {
  ajustar,
  carimbo,
  descontosDeTempo,
  duracaoDa,
  feminina,
  inicioDa,
  mostrador,
  nomeDaParte,
  ordem,
  ordinal,
  regrasDoJogo,
  rotulo,
  tempoAdicional,
  totalDePartes,
  type Contagem,
  type Momento,
} from "./relogio";
import { Cartao } from "./ui";

/**
 * O jogo ao vivo: um relógio e quatro botões.
 *
 * É para o telemóvel, junto ao campo, com uma mão. Por isso não há formulário:
 * carrega-se no que aconteceu (golo, cartão, substituição), escolhe-se o
 * jogador numa lista de quem está em campo, e fica registado ao minuto que o
 * relógio marca. Um engano apaga-se na lista de acontecimentos.
 *
 * ## O relógio
 *
 * Conta como a modalidade conta (ver `relogio.ts`): parte a parte, com
 * intervalo entre elas, pausas a meio (uma lesão, um desconto de tempo) que
 * não acabam a parte, compensação no futebol e cronómetro a zero em cada
 * parte no futsal e no basquetebol. Havia um botão só, "Parar (intervalo)", e
 * parar para uma lesão era o mesmo que acabar a parte.
 *
 * ## Onde isto fica guardado
 *
 * Enquanto o jogo decorre, no próprio telemóvel: uma rede fraca no campo não
 * pode fazer perder um golo. No fim, "Terminar e gravar" escreve o resultado, a
 * ficha e o tempo adicional de uma vez, no mesmo formato que o Pós-jogo usa. O
 * que se gravou aqui abre lá, para acertar o que for preciso.
 *
 * É opcional: quem preferir preenche tudo depois, no Pós-jogo.
 */

type Tipo = "golo" | "sofrido" | "amarelo" | "vermelho" | "sub" | "tempo";
type Lado = "nos" | "eles";
/** `valor` é quanto vale: 1 num golo, 1, 2 ou 3 num cesto. */
type Acontecimento = Momento & {
  id: string;
  tipo: Tipo;
  atleta?: string;
  entra?: string;
  valor?: number;
  /** De quem é o desconto de tempo. */
  lado?: Lado;
  /** Registado no intervalo (uma substituição ao intervalo, por exemplo). */
  aoIntervalo?: boolean;
};

/**
 * Antes de começar, a jogar, parado a meio de uma parte, no intervalo entre
 * duas, ou acabado. Parado e intervalo são coisas diferentes: parado continua
 * na mesma parte; o intervalo fecha-a, e a seguinte começa do seu início.
 */
type Fase = "antes" | "a-jogar" | "parado" | "intervalo" | "fim";

type Estado = {
  versao: 2;
  /** Os titulares, por id. */
  onze: string[];
  acontecimentos: Acontecimento[];
  parte: number;
  fase: Fase;
  /** Segundos já contados nesta parte até à última paragem. */
  base: number;
  /** Quando o relógio voltou a andar; nulo se está parado. */
  desde: number | null;
  /** Segundos jogados em cada parte já acabada. */
  jogados: number[];
  /** A compensação anunciada em cada parte (futebol). */
  anunciados: number[];
  /** Um desconto de tempo a decorrer: de quem, e até quando. */
  pausa: { lado: Lado; ate: number } | null;
  /** Os minutos de cada parte do prolongamento, a partir do momento em que começa. */
  prolongamento: number[];
};

const chave = (id: string) => `academias.jogo.ao-vivo.${id}`;
const novoId = () => Math.random().toString(36).slice(2, 10);
const DESCONTO_DE_TEMPO_MS = 60_000;
/** Como cada pessoa prefere ler o relógio do futebol. Ver `Contagem`. */
const CHAVE_CONTAGEM = "academias.jogo.contagem";
/** Na substituição, "sai" de ninguém: a entrada que completa uma equipa com um expulso (futsal). */
const NO_LUGAR_DO_EXPULSO = "__expulso__";

type EstadoAntigo = { onze: string[]; base: number; desde: number | null; acontecimentos: Omit<Acontecimento, "parte">[] };

/**
 * O que estava guardado neste telemóvel.
 *
 * Um jogo começado antes desta versão tinha um relógio só, em minutos: abre
 * como a 1.ª parte, parado onde estava, para não se perder nada.
 */
function ler(id: string): Estado | null {
  try {
    const v = localStorage.getItem(chave(id));
    if (!v) return null;
    const lido = JSON.parse(v) as Estado | EstadoAntigo;
    // Guardado antes de haver prolongamento: não tinha nenhum.
    if ("versao" in lido && lido.versao === 2) return { ...lido, prolongamento: lido.prolongamento ?? [] };
    const antigo = lido as EstadoAntigo;
    const comecou = antigo.base > 0 || antigo.desde !== null || antigo.acontecimentos.length > 0;
    return {
      versao: 2,
      onze: antigo.onze,
      acontecimentos: antigo.acontecimentos.map((a) => ({ ...a, parte: 1 })),
      parte: 1,
      fase: comecou ? "parado" : "antes",
      base: antigo.base * 60 + (antigo.desde !== null ? Math.max(0, (Date.now() - antigo.desde) / 1000) : 0),
      desde: null,
      jogados: [],
      anunciados: [],
      pausa: null,
      prolongamento: [],
    };
  } catch {
    return null;
  }
}

export function LiveMatch({ match, mayRecord, onSaved }: { match: MatchDetail; mayRecord: boolean; onSaved: () => void }) {
  const jogadores = useJogadores(match);
  const porId = useMemo(() => new Map(jogadores.map((j) => [j.id, j])), [jogadores]);
  const titularesDoPlano = (match.plan?.slots ?? []).map((s) => s.athleteId).filter((x): x is string => Boolean(x));

  const profile = profileOf(sportById(match.sportId));

  const [estado, setEstado] = useState<Estado>(
    () =>
      ler(match.id) ?? {
        versao: 2,
        onze: titularesDoPlano,
        acontecimentos: [],
        parte: 1,
        fase: "antes",
        base: 0,
        desde: null,
        jogados: [],
        anunciados: [],
        pausa: null,
        prolongamento: [],
      },
  );
  const regras = useMemo(
    () => regrasDoJogo(profile, match.matchMinutes, estado.prolongamento),
    [profile, match.matchMinutes, estado.prolongamento],
  );
  const regraProl = regras.regraDoProlongamento;
  /** Os minutos de cada parte do prolongamento, escolhidos antes de ele começar. */
  const [minutosProl, setMinutosProl] = useState(regraProl.minutes);
  const [agora, setAgora] = useState(Date.now());
  const [aEscolher, setAEscolher] = useState<{ tipo: Tipo; sai?: string; valor?: number } | null>(null);
  /*
   * O basquetebol conta pontos (1, 2 ou 3 por cesto) e não tem cartões. O
   * futebol e o futsal contam golos e têm amarelos e vermelhos.
   */
  const pontos = profile?.code === "basketball";
  /** O painel de acertar o relógio, e a pergunta antes de uma acção que não se desfaz. */
  const [acertar, setAcertar] = useState(false);
  const [confirmar, setConfirmar] = useState<{ texto: string; sim: string; fazer: () => void } | null>(null);
  const [aGravar, setAGravar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [gravado, setGravado] = useState(false);

  const mudar = (novo: Estado) => {
    setEstado(novo);
    setGravado(false);
    try {
      localStorage.setItem(chave(match.id), JSON.stringify(novo));
    } catch {
      /* sem armazenamento, o registo vive até fechar a página */
    }
  };

  // O relógio anda de segundo a segundo enquanto conta, ou enquanto corre um desconto de tempo.
  const aAndar = estado.desde !== null;
  const emDesconto = estado.pausa !== null && estado.pausa.ate > agora;
  useEffect(() => {
    if (!aAndar && !estado.pausa) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [aAndar, estado.pausa]);

  const segundos = estado.base + (estado.desde !== null ? Math.max(0, (agora - estado.desde) / 1000) : 0);
  /*
   * O relógio do jogo ou o da parte (só no futebol: nas outras é sempre o da
   * parte). Cada um escolhe tocando no relógio, e fica lembrado neste
   * telemóvel para os jogos seguintes.
   */
  const [contagem, setContagem] = useState<Contagem>(() => {
    try {
      return localStorage.getItem(CHAVE_CONTAGEM) === "parte" ? "parte" : "jogo";
    } catch {
      return "jogo";
    }
  });
  const trocaContagem = !regras.reinicia;
  const trocarContagem = () => {
    const nova: Contagem = contagem === "jogo" ? "parte" : "jogo";
    setContagem(nova);
    try {
      localStorage.setItem(CHAVE_CONTAGEM, nova);
    } catch {
      /* sem armazenamento, vale só até fechar a página */
    }
  };
  const visor = mostrador(regras, estado.parte, segundos, contagem);
  const comecou = estado.fase !== "antes";
  const ultimaParte = estado.parte >= totalDePartes(regras);
  const parte = nomeDaParte(regras, estado.parte);
  /** O artigo da parte: "a 2.ª parte", "o 3.º período". */
  const a = (p: number) => (feminina(regras, p) ? "a" : "o");

  /* Quem está em campo agora: os titulares, com as trocas e as expulsões por cima. */
  const emCampo = useMemo(() => {
    const s = new Set(estado.onze);
    for (const a of [...estado.acontecimentos].sort((x, y) => ordem(x) - ordem(y))) {
      if (a.tipo === "sub" && a.entra) {
        // Sem quem sai, é a entrada no lugar de um expulso (futsal).
        if (a.atleta) s.delete(a.atleta);
        s.add(a.entra);
      }
      if (a.tipo === "vermelho" && a.atleta) s.delete(a.atleta);
    }
    return s;
  }, [estado]);
  const jaJogaram = new Set([...estado.onze, ...estado.acontecimentos.map((a) => a.entra).filter((x): x is string => Boolean(x))]);
  const noBanco = jogadores.filter((j) => !jaJogaram.has(j.id) && j.estado !== "baixa" && j.estado !== "recusou");

  /*
   * No futsal, a equipa com um expulso completa-se passados dois minutos (ou
   * depois de sofrer golo): entra outro jogador sem sair ninguém. Quantas
   * dessas entradas ainda há por fazer.
   */
  const completaExpulsos = profile?.code === "futsal";
  const lugaresDeExpulsos =
    estado.acontecimentos.filter((x) => x.tipo === "vermelho").length -
    estado.acontecimentos.filter((x) => x.tipo === "sub" && !x.atleta).length;

  const soma = (tipo: Tipo) => estado.acontecimentos.filter((a) => a.tipo === tipo).reduce((n, a) => n + (a.valor ?? 1), 0);
  const nossos = soma("golo");
  const deles = soma("sofrido");

  /*
   * O minuto do que acontece agora. No intervalo e no fim, é o fim da parte que
   * acabou: uma substituição feita ao intervalo conta como saída nesse minuto.
   */
  const momentoAgora = (): Momento & { aoIntervalo?: boolean } =>
    estado.fase === "intervalo" || estado.fase === "fim"
      ? {
          parte: estado.parte,
          minuto: inicioDa(regras, estado.parte) + duracaoDa(regras, estado.parte),
          aoIntervalo: estado.fase === "intervalo",
        }
      : carimbo(regras, estado.parte, segundos);

  const registar = (a: Omit<Acontecimento, "id" | keyof Momento | "aoIntervalo">) => {
    mudar({ ...estado, acontecimentos: [...estado.acontecimentos, { ...a, ...momentoAgora(), id: novoId() }] });
    setAEscolher(null);
  };
  const acertarMinuto = (id: string, d: number) =>
    mudar({
      ...estado,
      acontecimentos: estado.acontecimentos.map((a) => {
        if (a.id !== id) return a;
        const m = ajustar(regras, a, d);
        return { ...a, minuto: m.minuto, extra: m.extra };
      }),
    });

  /* ---- o relógio ---- */
  const parar = (): Pick<Estado, "base" | "desde"> => ({ base: segundos, desde: null });
  const comecar = () => {
    mudar({ ...estado, fase: "a-jogar", parte: 1, base: 0, desde: Date.now(), pausa: null });
    setAgora(Date.now());
  };
  const pausar = () => mudar({ ...estado, ...parar(), fase: "parado" });
  const retomar = () => {
    mudar({ ...estado, fase: "a-jogar", desde: Date.now(), pausa: null });
    setAgora(Date.now());
  };
  /** Acaba a parte: o intervalo, ou o fim do jogo na última. */
  const fimDaParte = () => {
    const jogados = [...estado.jogados];
    jogados[estado.parte - 1] = segundos;
    mudar({ ...estado, ...parar(), jogados, fase: ultimaParte ? "fim" : "intervalo", pausa: null });
  };
  /** A parte seguinte começa do seu início — do zero, ou dos 45:00 no futebol. */
  const comecarParte = () => {
    mudar({ ...estado, parte: estado.parte + 1, fase: "a-jogar", base: 0, desde: Date.now(), pausa: null });
    setAgora(Date.now());
  };
  /** Carregou-se em "Fim" cedo de mais: a parte volta, parada onde estava. */
  const desfazerFim = () => mudar({ ...estado, fase: "parado" });
  /** Um desconto de tempo para o relógio e conta o minuto. */
  const pedirTempo = (lado: Lado) => {
    const agoraMs = Date.now();
    mudar({
      ...estado,
      ...parar(),
      fase: "parado",
      pausa: { lado, ate: agoraMs + DESCONTO_DE_TEMPO_MS },
      acontecimentos: [...estado.acontecimentos, { ...carimbo(regras, estado.parte, segundos), id: novoId(), tipo: "tempo", lado }],
    });
    setAgora(agoraMs);
  };
  /*
   * O prolongamento começa no fim do jogo. Futebol e futsal: as duas partes
   * de uma vez, e só uma vez. Basquetebol: um período de cada vez, tantos
   * quantos for preciso.
   */
  const podeProlongar = estado.fase === "fim" && !gravado && (regraProl.repeat || estado.prolongamento.length === 0);
  const comecarProlongamento = () => {
    const m = Math.min(regraProl.maxMinutes, Math.max(1, minutosProl));
    const prolongamento = regraProl.repeat ? [...estado.prolongamento, m] : Array.from({ length: regraProl.parts }, () => m);
    mudar({ ...estado, prolongamento, parte: estado.parte + 1, fase: "a-jogar", base: 0, desde: Date.now(), pausa: null });
    setAgora(Date.now());
  };
  /*
   * O prolongamento carregado por engano: volta ao fim do tempo regulamentar
   * (ou do prolongamento anterior). Só enquanto a parte que começou não tem
   * nada registado.
   */
  const primeiraDoProlongamento = regraProl.repeat ? totalDePartes(regras) : regras.partes + 1;
  const podeCancelarProlongamento =
    estado.prolongamento.length > 0 &&
    estado.parte === primeiraDoProlongamento &&
    (estado.fase === "a-jogar" || estado.fase === "parado") &&
    !estado.acontecimentos.some((x) => x.parte >= primeiraDoProlongamento);
  const cancelarProlongamento = () => {
    const prolongamento = regraProl.repeat ? estado.prolongamento.slice(0, -1) : [];
    const anterior = estado.parte - 1;
    mudar({ ...estado, prolongamento, parte: anterior, fase: "fim", base: estado.jogados[anterior - 1] ?? 0, desde: null, pausa: null });
  };

  /*
   * Acertar o relógio à mão.
   *
   * O relógio de quem está no banco nem sempre é o do árbitro: começou-se
   * tarde, carregou-se no sítio errado, ou o jogo recomeçou. Dá para saltar
   * para outra parte, acertar o tempo e recomeçar a parte ou o jogo. O que
   * muda a parte ou deita tempo fora pede confirmação.
   */
  const irParaParte = (p: number) => {
    const jogados = [...estado.jogados];
    // As partes que se saltam ficam jogadas por inteiro.
    for (let i = 1; i < p; i++) if (jogados[i - 1] == null) jogados[i - 1] = duracaoDa(regras, i) * 60;
    // Para trás, a parte retoma onde acabou; para a frente, começa do início.
    const base = p === estado.parte ? segundos : p < estado.parte ? (jogados[p - 1] ?? 0) : 0;
    mudar({ ...estado, parte: p, fase: "parado", base, desde: null, pausa: null, jogados });
  };
  const acertarTempo = (d: number) => {
    const base = Math.max(0, segundos + d);
    mudar({ ...estado, base, desde: estado.desde !== null ? Date.now() : null });
    setAgora(Date.now());
  };
  const recomecarParte = () => mudar({ ...estado, fase: "parado", base: 0, desde: null, pausa: null });
  const recomecarJogo = () =>
    mudar({
      ...estado,
      acontecimentos: [],
      parte: 1,
      fase: "antes",
      base: 0,
      desde: null,
      jogados: [],
      anunciados: [],
      pausa: null,
      prolongamento: [],
    });

  const anunciar = (d: number) => {
    const anunciados = [...estado.anunciados];
    anunciados[estado.parte - 1] = Math.min(30, Math.max(0, (anunciados[estado.parte - 1] ?? 0) + d));
    mudar({ ...estado, anunciados });
  };

  async function terminar() {
    if (aGravar) return;
    setAGravar(true);
    setErro(null);
    try {
      // O fim do jogo, com o prolongamento se houve.
      const ultima = totalDePartes(regras);
      const fim = inicioDa(regras, ultima) + duracaoDa(regras, ultima);
      const linhas = [...jaJogaram].map((id) => {
        const meus = estado.acontecimentos.filter((a) => a.atleta === id);
        const entrou = estado.acontecimentos.find((a) => a.tipo === "sub" && a.entra === id);
        const saiu = meus.find((a) => a.tipo === "sub");
        const vermelho = meus.find((a) => a.tipo === "vermelho");
        const marcados = meus.filter((a) => a.tipo === "golo");
        const golos = marcados.map((a) => a.minuto);
        const total = marcados.reduce((n, a) => n + (a.valor ?? 1), 0);
        const amarelos = meus.filter((a) => a.tipo === "amarelo").map((a) => a.minuto);
        const de = entrou?.minuto ?? 0;
        const ate = saiu?.minuto ?? vermelho?.minuto ?? fim;
        return {
          athleteId: id,
          minutes: Math.max(0, ate - de),
          started: estado.onze.includes(id),
          tally: total,
          assists: 0,
          yellowCards: Math.min(2, amarelos.length),
          redCard: Boolean(vermelho),
          ...(entrou ? { onMinute: entrou.minuto } : {}),
          ...(saiu ? { offMinute: saiu.minuto } : {}),
          ...(amarelos.length ? { yellowAt: amarelos.slice(0, 2) } : {}),
          ...(vermelho ? { redAt: vermelho.minuto } : {}),
          ...(golos.length && !pontos ? { tallyAt: golos.slice(0, 12) } : {}),
        };
      });

      /*
       * O prolongamento e o tempo adicional antes da ficha: o servidor conta os
       * minutos de cada um com eles (ver `minutosEmCampo`). O prolongamento vai
       * primeiro, porque é ele que diz quantas partes têm tempo adicional. Um
       * jogo que já tinha prolongamento gravado e aqui não teve, limpa-o.
       */
      if (profile && (estado.prolongamento.length > 0 || (match.overtimeMinutes?.length ?? 0) > 0)) {
        await saveOvertime(match.id, estado.prolongamento);
      }
      // A parte em curso, se não se carregou em "Fim", conta com o que o relógio tem.
      const jogados = [...estado.jogados];
      if (estado.fase === "a-jogar" || estado.fase === "parado") jogados[estado.parte - 1] = segundos;
      const adicional = tempoAdicional(regras, jogados, estado.anunciados);
      if (adicional.some((m) => m > 0)) await saveAddedTime(match.id, adicional);

      await saveResult(match.id, nossos, deles);
      await saveAppearances(match.id, linhas);
      mudar({ ...estado, ...parar(), jogados, fase: "fim", pausa: null });
      setGravado(true);
      onSaved();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível gravar o jogo.");
    } finally {
      setAGravar(false);
    }
  }

  /* ---- antes de começar: confirmar quem começa ---- */
  if (match.squad.length === 0) {
    return <Aviso titulo="O jogo ao vivo precisa dos convocados" texto="Envia a convocatória (ou regista o plantel no Pós-jogo) para poderes marcar golos, cartões e substituições a jogadores." />;
  }
  if (!mayRecord) {
    return <Aviso titulo="Só quem regista a ficha acompanha o jogo ao vivo" texto="O resultado e a ficha aparecem no Pós-jogo quando forem gravados." />;
  }

  const nome = (id?: string) => (id ? (porId.get(id)?.curto ?? "Atleta") : "");
  const nomeDoLado = (lado?: Lado) => (lado === "eles" ? match.opponent : match.teamName);
  const TEXTO: Record<Tipo, string> = pontos
    ? { golo: "Cesto", sofrido: "Cesto sofrido", amarelo: "Amarelo", vermelho: "Vermelho", sub: "Substituição", tempo: "Desconto de tempo" }
    : { golo: "Golo", sofrido: "Golo sofrido", amarelo: "Amarelo", vermelho: "Vermelho", sub: "Substituição", tempo: "Desconto de tempo" };
  /*
   * Um sinal por tipo, para a lista se ler de relance à beira do campo: dez
   * linhas de texto iguais obrigavam a ler cada uma. O golo sofrido usa a
   * mesma bola, apagada: é golo, mas não é nosso.
   */
  const ICONE: Record<Tipo, string> = {
    golo: pontos ? "🏀" : "⚽",
    sofrido: pontos ? "🏀" : "⚽",
    amarelo: "🟨",
    vermelho: "🟥",
    sub: "🔄",
    tempo: "⏱️",
  };

  const fimDaParteTexto = ultimaParte ? "Fim do jogo" : `Fim d${a(estado.parte)} ${parte}`;
  const estadoTexto =
    estado.fase === "antes"
      ? "Por começar"
      : estado.fase === "intervalo"
        ? `Intervalo · acabou ${a(estado.parte)} ${parte}`
        : estado.fase === "fim"
          ? "Fim do jogo"
          : emDesconto
            ? `${parte} · desconto de tempo de ${nomeDoLado(estado.pausa?.lado)}`
            : `${parte} · ${aAndar ? "a decorrer" : "em pausa"}`;
  const anunciado = estado.anunciados[estado.parte - 1] ?? 0;
  const naParte = estado.fase === "a-jogar" || estado.fase === "parado";
  const tempos = (lado: Lado) =>
    descontosDeTempo(
      regras,
      estado.parte,
      estado.acontecimentos.filter((a) => a.tipo === "tempo" && a.lado === lado),
    );

  return (
    <div className="mx-auto max-w-[720px] space-y-4">
      {/* O relógio e o resultado. */}
      <Cartao className="px-4 py-5 text-center">
        <Rotulo className={cx(estado.fase === "intervalo" && "text-signal-ink")}>{estadoTexto}</Rotulo>
        <div className="mt-1 flex items-center justify-center gap-5">
          <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink tabular">{nossos}</span>
          {/*
            O relógio. No futebol toca-se nele para trocar entre o tempo do jogo
            e o da parte; a legenda por baixo diz qual se está a ver.
          */}
          <button
            type="button"
            disabled={!trocaContagem}
            onClick={trocarContagem}
            aria-label={trocaContagem ? `Relógio: tempo ${contagem === "jogo" ? "do jogo" : "da parte"}. Tocar para mudar.` : undefined}
            title={trocaContagem ? "Tocar para mudar entre o tempo do jogo e o da parte" : undefined}
            className="flex flex-col items-center rounded-[10px] border border-transparent px-2 py-1 transition-colors duration-[120ms] enabled:cursor-pointer enabled:hover:border-line enabled:hover:bg-sunken/60 enabled:active:scale-[0.98]"
          >
            <span className={cx("font-mono text-[28px] leading-none tabular", estado.fase === "intervalo" || estado.fase === "fim" ? "text-ink-3" : "text-ink")}>
              {visor.principal}
            </span>
            {/* A compensação a correr, no futebol; nas outras, quanto dura a parte. */}
            {visor.extra ? (
              <span className="mt-1 font-mono text-[15px] leading-none font-semibold text-signal-ink tabular">{visor.extra}</span>
            ) : regras.reinicia ? (
              <span className="mt-1 font-mono text-[11px] leading-none text-ink-4 tabular">de {String(duracaoDa(regras, estado.parte)).padStart(2, "0")}:00</span>
            ) : null}
            {/*
              A legenda é uma pastilha com o sinal de trocar: sem ele, ninguém
              adivinhava que o relógio se toca.
            */}
            {trocaContagem && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[10px] leading-none text-ink-3">
                <Repeat className="size-2.5" strokeWidth={2} aria-hidden />
                {contagem === "jogo" ? "tempo do jogo" : `tempo d${a(estado.parte)} ${ordinal(regras, estado.parte)}`}
              </span>
            )}
          </button>
          <span className="text-[44px] leading-none font-semibold tracking-[-0.03em] text-ink-3 tabular">{deles}</span>
        </div>
        <div className="mt-1 flex justify-center gap-10 text-[11px] text-ink-3">
          <span className="max-w-[40%] truncate">{match.teamName}</span>
          <span className="max-w-[40%] truncate">{match.opponent}</span>
        </div>

        {emDesconto && estado.pausa && (
          <p className="mt-2 font-mono text-meta text-ink-2 tabular">
            Falta {Math.ceil((estado.pausa.ate - agora) / 1000)} s do desconto de tempo
          </p>
        )}
        {naParte && regras.reinicia && visor.esgotado && (
          <p className="mt-2 text-meta font-medium text-warn">
            Acabou o tempo d{a(estado.parte)} {parte}.
          </p>
        )}
        {regras.compensacao && naParte && anunciado > 0 && (
          <p className="mt-2 text-meta text-ink-3">Compensação anunciada: +{anunciado}′</p>
        )}

        {/* Os comandos do relógio, conforme a fase. */}
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {estado.fase === "antes" && (
            <BotaoRelogio onClick={comecar} principal>
              <Play className="size-4" strokeWidth={2} /> Começar o jogo
            </BotaoRelogio>
          )}
          {estado.fase === "a-jogar" && (
            <>
              <BotaoRelogio onClick={pausar}>
                <Pause className="size-4" strokeWidth={2} /> Pausar
              </BotaoRelogio>
              <BotaoRelogio onClick={fimDaParte} principal={visor.esgotado}>
                {fimDaParteTexto}
              </BotaoRelogio>
            </>
          )}
          {estado.fase === "parado" && (
            <>
              <BotaoRelogio onClick={retomar} principal>
                <Play className="size-4" strokeWidth={2} /> Retomar
              </BotaoRelogio>
              <BotaoRelogio onClick={fimDaParte}>{fimDaParteTexto}</BotaoRelogio>
            </>
          )}
          {estado.fase === "intervalo" && (
            <BotaoRelogio onClick={comecarParte} principal>
              <Play className="size-4" strokeWidth={2} /> Começar {a(estado.parte + 1)} {nomeDaParte(regras, estado.parte + 1)}
            </BotaoRelogio>
          )}
        </div>
        {(estado.fase === "intervalo" || (estado.fase === "fim" && !gravado)) && (
          <button type="button" onClick={desfazerFim} className="mt-2 text-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Afinal ainda não acabou {a(estado.parte)} {parte}
          </button>
        )}
        {podeCancelarProlongamento && (
          <button type="button" onClick={cancelarProlongamento} className="mt-2 text-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline">
            Afinal não há {estado.prolongamento.length > 1 && regraProl.repeat ? "mais prolongamento" : "prolongamento"}
          </button>
        )}

        {/*
          O prolongamento, no fim do jogo. Pergunta-se a duração antes de
          começar: na formação joga-se muitas vezes menos do que as Leis dizem.
        */}
        {podeProlongar && (
          <div className="mt-4 rounded-[10px] border border-line px-3 py-3">
            <div className="flex flex-wrap items-center justify-center gap-2 text-meta text-ink-3">
              <span className="font-semibold text-ink">{estado.prolongamento.length > 0 ? "Mais um prolongamento" : "Prolongamento"}</span>
              <span>{regraProl.repeat ? "de" : `${regraProl.parts} ×`}</span>
              <button
                type="button"
                aria-label="Menos um minuto de prolongamento"
                onClick={() => setMinutosProl((m) => Math.max(1, m - 1))}
                className="flex size-8 items-center justify-center rounded-[6px] border border-line text-ink hover:border-ink"
              >
                −
              </button>
              <span className="w-6 font-mono text-body text-ink tabular">{minutosProl}</span>
              <button
                type="button"
                aria-label="Mais um minuto de prolongamento"
                onClick={() => setMinutosProl((m) => Math.min(regraProl.maxMinutes, m + 1))}
                className="flex size-8 items-center justify-center rounded-[6px] border border-line text-ink hover:border-ink"
              >
                +
              </button>
              <span>min</span>
            </div>
            <div className="mt-2">
              <BotaoRelogio onClick={comecarProlongamento}>
                <Play className="size-4" strokeWidth={2} /> Começar {a(estado.parte + 1)} {nomeDaParte({ ...regras, prolongamento: [...estado.prolongamento, minutosProl] }, estado.parte + 1)}
              </BotaoRelogio>
            </div>
          </div>
        )}

        {/* Compensação anunciada (futebol): o mínimo que o árbitro mostrou. */}
        {regras.compensacao && naParte && (
          <div className="mt-3 flex items-center justify-center gap-2 text-meta text-ink-3">
            <span>Compensação</span>
            <button type="button" aria-label="Menos um minuto de compensação" onClick={() => anunciar(-1)} className="flex size-8 items-center justify-center rounded-[6px] border border-line text-ink hover:border-ink">
              −
            </button>
            <span className="w-8 font-mono text-body text-ink tabular">+{anunciado}′</span>
            <button type="button" aria-label="Mais um minuto de compensação" onClick={() => anunciar(1)} className="flex size-8 items-center justify-center rounded-[6px] border border-line text-ink hover:border-ink">
              +
            </button>
          </div>
        )}

        {/* Descontos de tempo (futsal, basquetebol): param o relógio e contam um minuto. */}
        {regras.timeouts && naParte && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["nos", "eles"] as const).map((lado) => {
              const t = tempos(lado);
              const esgotados = t ? t.usados >= t.max : true;
              return (
                <button
                  key={lado}
                  type="button"
                  disabled={esgotados || emDesconto}
                  onClick={() => pedirTempo(lado)}
                  className="flex h-11 min-w-0 flex-col items-center justify-center rounded-[10px] border border-line px-2 text-ink hover:border-ink disabled:opacity-40 disabled:hover:border-line"
                >
                  <span className="max-w-full truncate text-meta font-semibold">Desconto de tempo · {nomeDoLado(lado)}</span>
                  {t && <span className="font-mono text-[11px] text-ink-3 tabular">{t.usados} de {t.max}</span>}
                </button>
              );
            })}
          </div>
        )}
        {/* Acertar o relógio: saltar de parte, acertar o tempo, recomeçar. */}
        {comecou && !gravado && (
          <div className="mt-3 border-t border-line pt-2">
            <button
              type="button"
              aria-expanded={acertar}
              onClick={() => {
                setAcertar((v) => !v);
                setConfirmar(null);
              }}
              className="text-meta text-ink-3 underline-offset-2 hover:text-ink hover:underline"
            >
              {acertar ? "Fechar" : "Acertar o relógio"}
            </button>

            {acertar && !confirmar && (
              <div className="mt-2 space-y-3 text-left">
                <div>
                  <p className="text-[11px] font-semibold text-ink-3">Ir para</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Array.from({ length: totalDePartes(regras) }, (_, i) => i + 1).map((p) => (
                      <button
                        key={p}
                        type="button"
                        aria-pressed={p === estado.parte}
                        disabled={p === estado.parte && naParte}
                        onClick={() =>
                          setConfirmar({
                            texto: `Passar para ${a(p)} ${nomeDaParte(regras, p)}? O relógio fica parado ${
                              p <= estado.parte ? `onde ${feminina(regras, p) ? "ela" : "ele"} tinha ficado` : "no início"
                            }. Os acontecimentos ficam como estão.`,
                            sim: `Ir para ${a(p)} ${nomeDaParte(regras, p)}`,
                            fazer: () => irParaParte(p),
                          })
                        }
                        className={cx(
                          "h-9 rounded-full border px-3 text-meta",
                          p === estado.parte ? "border-ink bg-ink text-surface" : "border-line text-ink hover:border-ink",
                        )}
                      >
                        {nomeDaParte(regras, p)}
                      </button>
                    ))}
                  </div>
                </div>

                {naParte && (
                  <div>
                    <p className="text-[11px] font-semibold text-ink-3">Acertar o tempo d{a(estado.parte)} {parte}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {[
                        [-60, "−1 min"],
                        [-10, "−10 s"],
                        [10, "+10 s"],
                        [60, "+1 min"],
                      ].map(([d, t]) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => acertarTempo(Number(d))}
                          className="h-9 rounded-full border border-line px-3 font-mono text-meta text-ink tabular hover:border-ink"
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {naParte && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmar({
                          texto: `Recomeçar ${a(estado.parte)} ${parte} do zero? O relógio volta ao início ${feminina(regras, estado.parte) ? "dela" : "dele"} e fica parado. Os acontecimentos ficam como estão.`,
                          sim: "Recomeçar",
                          fazer: recomecarParte,
                        })
                      }
                      className="h-9 rounded-full border border-line px-3 text-meta text-ink hover:border-ink"
                    >
                      Recomeçar {a(estado.parte)} {parte}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      setConfirmar({
                        texto: `Recomeçar o jogo? Apaga o relógio e os ${estado.acontecimentos.length} acontecimentos registados neste telemóvel. Os titulares ficam.`,
                        sim: "Recomeçar o jogo",
                        fazer: recomecarJogo,
                      })
                    }
                    className="h-9 rounded-full border border-line px-3 text-meta text-risk hover:border-risk"
                  >
                    Recomeçar o jogo
                  </button>
                </div>
              </div>
            )}

            {confirmar && (
              <div role="alertdialog" aria-label="Confirmar" className="mt-2 rounded-[10px] border border-ink px-3 py-3 text-left">
                <p className="text-meta text-ink">{confirmar.texto}</p>
                <div className="mt-2 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => setConfirmar(null)} className="ctl-ghost h-9">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      confirmar.fazer();
                      setConfirmar(null);
                      setAcertar(false);
                    }}
                    className="ctl-primary h-9"
                  >
                    {confirmar.sim}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Cartao>

      {/* Os titulares, enquanto o jogo não começa. */}
      {!comecou && (
        <section>
          <div>
            <Rotulo>Quem começa · {estado.onze.length}</Rotulo>
            <p className="mt-0.5 text-meta text-ink-3">{titularesDoPlano.length > 0 ? "Vem da equipa inicial do Pré-jogo. Acerta se mudou à última hora." : "Escolhe os titulares."}</p>
          </div>
          <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {jogadores
              .filter((j) => j.estado !== "baixa" && j.estado !== "recusou")
              .map((j) => {
                const on = estado.onze.includes(j.id);
                return (
                  <li key={j.id}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => mudar({ ...estado, onze: on ? estado.onze.filter((x) => x !== j.id) : [...estado.onze, j.id] })}
                      className={cx("flex h-12 w-full items-center gap-2.5 rounded-[10px] border px-3 text-left", on ? "border-ink bg-ink text-surface" : "border-line text-ink")}
                    >
                      <span className="w-6 font-mono text-[12px] tabular opacity-70">{j.numero ?? "–"}</span>
                      <span className="min-w-0 flex-1 truncate text-body font-medium">{j.nome}</span>
                      {on && <Check className="size-4" strokeWidth={2} />}
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
      )}

      {/* Os quatro botões. Alvos grandes: é para carregar com o polegar. */}
      {comecou && (
        <section className="grid grid-cols-2 gap-2">
          {pontos ? (
            <>
              {/* Um cesto vale um, dois ou três: três botões nossos, três deles. */}
              <div className="col-span-2 grid grid-cols-3 gap-2">
                {[1, 2, 3].map((v) => (
                  <Botao key={v} onClick={() => setAEscolher({ tipo: "golo", valor: v })}>{`+${v}`}</Botao>
                ))}
              </div>
              <div className="col-span-2 grid grid-cols-3 gap-2">
                {[1, 2, 3].map((v) => (
                  <Botao key={v} onClick={() => registar({ tipo: "sofrido", valor: v })} suave>{`Eles +${v}`}</Botao>
                ))}
              </div>
            </>
          ) : (
            <>
              <Botao onClick={() => setAEscolher({ tipo: "golo" })}>Golo</Botao>
              <Botao onClick={() => registar({ tipo: "sofrido" })} suave>
                Golo sofrido
              </Botao>
              <Botao onClick={() => setAEscolher({ tipo: "amarelo" })} suave>
                Cartão amarelo
              </Botao>
              <Botao onClick={() => setAEscolher({ tipo: "vermelho" })} suave>
                Cartão vermelho
              </Botao>
            </>
          )}
          <Botao onClick={() => setAEscolher({ tipo: "sub" })} suave largo>
            Substituição
          </Botao>
        </section>
      )}

      {/* Escolher o jogador do acontecimento. */}
      {aEscolher && (
        <section className="rounded-[12px] border border-ink bg-surface p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <Rotulo className="text-ink">
              {aEscolher.tipo === "sub"
                ? aEscolher.sai === NO_LUGAR_DO_EXPULSO
                  ? "No lugar do expulso. Quem entra?"
                  : aEscolher.sai
                    ? `Sai ${nome(aEscolher.sai)}. Quem entra?`
                    : "Quem sai?"
                : `${TEXTO[aEscolher.tipo]} · de quem?`}
            </Rotulo>
            <button type="button" className="ctl-ghost size-8 justify-center px-0" aria-label="Cancelar" onClick={() => setAEscolher(null)}>
              <X className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {(aEscolher.tipo === "sub" && aEscolher.sai ? noBanco : jogadores.filter((j) => emCampo.has(j.id))).map((j: Jogador) => (
              <li key={j.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (aEscolher.tipo === "sub") {
                      if (!aEscolher.sai) setAEscolher({ tipo: "sub", sai: j.id });
                      else if (aEscolher.sai === NO_LUGAR_DO_EXPULSO) registar({ tipo: "sub", entra: j.id });
                      else registar({ tipo: "sub", atleta: aEscolher.sai, entra: j.id });
                    } else registar({ tipo: aEscolher.tipo, atleta: j.id, ...(aEscolher.valor ? { valor: aEscolher.valor } : {}) });
                  }}
                  className="flex h-12 w-full items-center gap-2.5 rounded-[10px] border border-line px-3 text-left text-ink hover:border-ink"
                >
                  <span className="w-6 font-mono text-[12px] text-ink-3 tabular">{j.numero ?? "–"}</span>
                  <span className="min-w-0 flex-1 truncate text-body font-medium">{j.nome}</span>
                </button>
              </li>
            ))}
          </ul>
          {aEscolher.tipo === "sub" && !aEscolher.sai && completaExpulsos && lugaresDeExpulsos > 0 && (
            <button
              type="button"
              onClick={() => setAEscolher({ tipo: "sub", sai: NO_LUGAR_DO_EXPULSO })}
              className="mt-1.5 flex h-12 w-full items-center rounded-[10px] border border-dashed border-line-strong px-3 text-left text-body text-ink hover:border-ink"
            >
              Ninguém: entra um jogador no lugar do expulso
            </button>
          )}
          {aEscolher.tipo === "sub" && aEscolher.sai && noBanco.length === 0 && <p className="text-meta text-ink-3">Não há mais ninguém no banco.</p>}
        </section>
      )}

      {/* O que já aconteceu, do mais recente para trás. */}
      {estado.acontecimentos.length > 0 && (
        <section>
          <div>
            <Rotulo>Acontecimentos · {estado.acontecimentos.length}</Rotulo>
          </div>
          <ol>
            {[...estado.acontecimentos]
              .sort((a, b) => ordem(b) - ordem(a))
              .map((a) => (
                <li key={a.id} className="flex items-center gap-2 border-b border-line py-2">
                  {a.aoIntervalo ? (
                    <span className="w-[100px] shrink-0 text-center text-meta text-ink-3">Intervalo</span>
                  ) : (
                    <span className="flex w-[100px] shrink-0 items-center">
                      <button type="button" aria-label="Menos um minuto" onClick={() => acertarMinuto(a.id, -1)} className="flex size-8 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink">
                        −
                      </button>
                      <span className="flex-1 text-center font-mono text-body leading-tight text-ink tabular">
                        {rotulo(regras, a, contagem)}
                        {/* O minuto da parte só se lê com a parte ao lado. */}
                        {(regras.reinicia || contagem === "parte") && <span className="block text-[10px] text-ink-4">{ordinal(regras, a.parte)}</span>}
                      </span>
                      <button type="button" aria-label="Mais um minuto" onClick={() => acertarMinuto(a.id, 1)} className="flex size-8 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-ink">
                        +
                      </button>
                    </span>
                  )}
                  <span aria-hidden className={cx("w-6 shrink-0 text-center text-[17px] leading-none", a.tipo === "sofrido" && "opacity-35 grayscale")}>
                    {ICONE[a.tipo]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                    <span className="font-medium">
                      {TEXTO[a.tipo]}
                      {pontos && a.valor ? ` de ${a.valor}` : ""}
                    </span>
                    {a.tipo === "sub"
                      ? a.atleta
                        ? ` · sai ${nome(a.atleta)}, entra ${nome(a.entra)}`
                        : ` · entra ${nome(a.entra)} no lugar do expulso`
                      : a.tipo === "tempo"
                        ? ` · ${nomeDoLado(a.lado)}`
                        : a.atleta
                          ? ` · ${nome(a.atleta)}`
                          : ""}
                  </span>
                  <button
                    type="button"
                    aria-label="Apagar este acontecimento"
                    onClick={() => mudar({ ...estado, acontecimentos: estado.acontecimentos.filter((x) => x.id !== a.id) })}
                    className="flex size-8 shrink-0 items-center justify-center rounded-[6px] text-ink-4 hover:bg-sunken hover:text-risk"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
          </ol>
        </section>
      )}

      {/* Terminar. */}
      {comecou && (
        <section className="flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-surface px-3 py-2.5">
          {erro && (
            <span className="text-meta text-risk" role="alert">
              {erro}
            </span>
          )}
          {gravado && !erro && (
            <span className="inline-flex items-center gap-1 text-meta text-ok">
              <Check className="size-3.5" strokeWidth={2} /> Resultado e ficha gravados. Acerta o resto no Pós-jogo.
            </span>
          )}
          {!gravado && !erro && <span className="text-meta text-ink-3">Fica guardado neste telemóvel até gravares.</span>}
          <button type="button" onClick={() => void terminar()} disabled={aGravar} className="ctl-primary ml-auto h-11 px-4">
            {aGravar ? "A gravar…" : `Terminar e gravar ${nossos}–${deles}`}
          </button>
        </section>
      )}
    </div>
  );
}

/** O título de um bloco. */
function Rotulo({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cx("text-meta font-semibold text-ink", className)}>{children}</span>;
}

function BotaoRelogio({ children, onClick, principal }: { children: React.ReactNode; onClick: () => void; principal?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx("inline-flex h-11 items-center gap-2 rounded-[10px] px-5 text-body font-semibold", principal ? "bg-ink text-surface" : "border border-line text-ink hover:border-ink")}
    >
      {children}
    </button>
  );
}

function Botao({ children, onClick, suave, largo }: { children: string; onClick: () => void; suave?: boolean; largo?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "h-16 rounded-[12px] text-[16px] font-semibold transition-transform active:scale-[0.98]",
        suave ? "border border-line bg-surface text-ink hover:border-ink" : "bg-ink text-surface",
        largo && "col-span-2",
      )}
    >
      {children}
    </button>
  );
}

function Aviso({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{titulo}</h3>
      <p className="mx-auto mt-1 max-w-[460px] text-meta leading-relaxed text-ink-3">{texto}</p>
    </div>
  );
}
