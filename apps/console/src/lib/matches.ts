import { apiGet, apiPost } from "@/lib/http";
import type { AttentionItem } from "@/data/types";

/**
 * Jogos: a lista, e a página de cada um.
 *
 * ## O âmbito não se decide aqui
 *
 * Um treinador vê os jogos das equipas dele e um director vê os do clube todo —
 * mas isso acontece no servidor, em `teamScopeFilter`, e não neste ficheiro. A
 * lista que chega já é a lista certa. Filtrar no cliente daria a mesma imagem e
 * nenhuma das garantias: quem soubesse o id de um jogo de outro escalão chegava
 * lá na mesma.
 *
 * ## O que há-de vir
 *
 * A ficha de jogo é para ser preenchida à mão hoje e importada amanhã (ZeroZero,
 * FPF). É por isso que o `MatchDetail` traz `source` e `statsEnteredAt`: quem
 * abrir a página tem de perceber, sem perguntar a ninguém, se aquele resultado
 * foi escrito por um colega ou veio de fora.
 */

export type MatchStatus = "SCHEDULED" | "PLAYED" | "CANCELLED" | "POSTPONED";

export type CallUpStatus = "CALLED" | "CONFIRMED" | "DECLINED";

/** Uma linha do plantel convocado, já com o que fez no jogo. */
export type SquadRow = {
  athleteId: string;
  name: string;
  position: string | null;
  callUpStatus: CallUpStatus;
  isGuest: boolean;
  guestFromTeam?: string;
  /** Se tem linha na ficha. Quem ficou no banco não tem — a ausência é a resposta. */
  played: boolean;
  minutes: number;
  started: boolean;
  /** Golos no futebol, pontos nos restantes. */
  tally: number;
  assists: number;
  yellowCards: number;
  redCard: boolean;

  /* --- O detalhe dos minutos ------------------------------------------------
     Tudo opcional, e `null` significa "ninguém registou" — que é diferente de
     zero. Um titular tem `onMinute` nulo (entrou aos 0, sabe-se por `started`);
     quem jogou até ao fim tem `offMinute` nulo. Ver `MatchAppearance`. */
  onMinute: number | null;
  offMinute: number | null;
  /** Os minutos dos amarelos, por ordem. Vazio quando não foram registados. */
  yellowAt: number[];
  redAt: number | null;
  /** Os minutos dos golos e das assistências. Vazios quando não registados. */
  tallyAt: number[];
  assistsAt: number[];
};

export type MatchStaffRow = { id: string; membershipId: string; name: string; role: string };

export type MatchDetail = {
  id: string;
  teamId: string;
  teamName: string;
  maxAge: number;
  sportId: string;
  maxCallUps: number;
  startsAt: string;
  endsAt: string;
  venue: string;
  opponent: string;
  isHome: boolean;
  /** A prova. `null` num amigável, ou num jogo marcado antes de isto existir. */
  competition: { id: string; label: string } | null;
  status: MatchStatus;
  ourScore: number | null;
  theirScore: number | null;
  coachName: string | null;
  submitted: boolean;
  submittedAt: string | null;
  /** Quando alguém preencheu a ficha à mão. Ver a nota no topo. */
  statsEnteredAt: string | null;
  /** Preenchido quando o jogo veio de fora. Nulo quando foi marcado à mão. */
  source: { provider: string; url: string | null; at: string | null } | null;
  squad: SquadRow[];
  staff: MatchStaffRow[];
};

export type MatchListRow = {
  id: string;
  teamId: string;
  teamName: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  opponent: string;
  isHome: boolean;
  status: MatchStatus;
  ourScore: number | null;
  theirScore: number | null;
  submitted: boolean;
  /**
   * A função com que **eu** estou escalado neste jogo, se estiver.
   *
   * Vem do servidor já filtrado pela minha `membershipId`: a lista traz a minha
   * linha da ficha técnica e não a equipa de trabalho toda. É o que deixa a
   * massagista ver, na lista de jogos, quais são os dela.
   */
  myStaffRole: string | null;
  /**
   * É de uma equipa minha?
   *
   * A lista de jogos passou a trazer o clube todo — ver um jogo do escalão de
   * cima é a razão de isto existir. O que é **trabalho meu** distingue-se por
   * aqui: convocar, preencher a ficha, abrir a página do jogo. Ver
   * `calendarScopeFilter` no servidor.
   */
  mine: boolean;
  /** Vazio quando o jogo não é meu — a convocatória é do escalão dele. */
  calledUp: { athleteId: string; status: CallUpStatus }[];
};

export const listMatches = (from?: Date, to?: Date) => {
  const q = new URLSearchParams();
  if (from) q.set("from", from.toISOString());
  if (to) q.set("to", to.toISOString());
  return apiGet<MatchListRow[]>(`/api/matches${q.toString() ? `?${q}` : ""}`);
};

export const getMatch = (id: string) => apiGet<MatchDetail>(`/api/matches/${id}`);

export const staffPool = () =>
  apiGet<{ membershipId: string; name: string; role: string | null }[]>("/api/matches/equipa-tecnica");

/** `null` nos dois limpa o resultado e devolve o jogo a agendado. */
export const saveResult = (id: string, ourScore: number | null, theirScore: number | null) =>
  apiPost<{ ok: true }>(`/api/matches/${id}/resultado`, { ourScore, theirScore });

/**
 * A ficha inteira de cada vez.
 *
 * Um pedido por cada carregar num "+1" dava vinte pedidos por minuto de um
 * treinador a acertar minutos no telemóvel, e uma ficha meio gravada quando a
 * rede falhasse a meio. Um jogo tem vinte linhas, não duas mil.
 */
export const saveAppearances = (
  id: string,
  rows: {
    athleteId: string;
    minutes: number;
    started: boolean;
    tally: number;
    assists: number;
    yellowCards: number;
    redCard: boolean;
    /* Omitidos quando não há detalhe — o servidor guarda `null` e a ficha do
       atleta continua a somar por `minutes`. */
    onMinute?: number;
    offMinute?: number;
    yellowAt?: number[];
    redAt?: number;
    tallyAt?: number[];
    assistsAt?: number[];
  }[],
) => apiPost<{ ok: true; saved: number }>(`/api/matches/${id}/ficha`, { rows });

/**
 * O plantel retroactivo de um jogo já disputado.
 *
 * Só se usa na página do jogo: o ecrã de Convocatórias monta o futuro e avisa
 * famílias; isto regista o passado e não avisa ninguém. Ver o serviço para o
 * porquê da separação.
 */
export const retroPool = (id: string) =>
  apiGet<{ athleteId: string; name: string; position: string | null }[]>(`/api/matches/${id}/plantel-elegivel`);

export const saveRetroSquad = (id: string, athleteIds: string[]) =>
  apiPost<{ ok: true; calledUp: number }>(`/api/matches/${id}/plantel`, { athleteIds });

export const saveMatchStaff = (id: string, rows: { membershipId: string; role: string }[]) =>
  apiPost<{ ok: true; saved: number }>(`/api/matches/${id}/staff`, { rows });

/* -------------------------------------------------------------------------- */

/** O mínimo que é preciso saber de um jogo para dizer o que falta nele. */
type Pendencia = {
  startsAt: string;
  teamName: string;
  opponent: string;
  status: MatchStatus;
  ourScore: number | null;
  submitted: boolean;
  myStaffRole: string | null;
  mine: boolean;
};

/**
 * Os jogos onde **eu** estou escalado e que ainda não aconteceram.
 *
 * ## Porque é que isto é um item de atenção e não uma página
 *
 * Porque para quem está escalado — a massagista, o delegado, o médico — isto não
 * é uma lista para consultar: é um compromisso com hora marcada. Vive no mesmo
 * painel que "2 mensalidades vencidas" porque é a mesma pergunta ("o que é que eu
 * tenho para fazer?"), e a resposta certa para o departamento clínico é esta e
 * não "convoca os teus jogadores".
 *
 * A gravidade é sempre `info`: não é um problema, é uma marcação. Um sino
 * vermelho por um jogo que corre bem é um sino que se aprende a ignorar.
 */
export function myMatchDuty(rows: Pendencia[], agora = Date.now()): AttentionItem[] {
  const meus = rows
    .filter((r) => r.myStaffRole && r.status !== "CANCELLED" && new Date(r.startsAt).getTime() >= agora)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  if (meus.length === 0) return [];

  const proximo = meus[0];
  const dias = Math.max(0, Math.ceil((new Date(proximo.startsAt).getTime() - agora) / 86_400_000));
  const quando = dias === 0 ? "hoje" : dias === 1 ? "amanhã" : `em ${dias} dias`;

  return [
    {
      id: "my-match-duty",
      severity: "info",
      title:
        meus.length === 1
          ? `Estás escalado para um jogo`
          : `Estás escalado para ${meus.length} jogos`,
      // O que interessa a quem lê: quando é o próximo, contra quem, e a fazer o
      // quê. A contagem já está no título.
      detail: `O próximo é ${quando} — ${proximo.teamName} vs ${proximo.opponent}, como ${proximo.myStaffRole}`,
      to: "/jogos?meus=1",
      action: "Ver",
    },
  ];
}

/**
 * O que falta fazer nos jogos, na linguagem do painel "Precisa de atenção".
 *
 * ## Porque é que isto vive aqui e não na página
 *
 * Porque é lido em dois sítios — na Visão geral, a partir do que veio no
 * arranque, e na página dos Jogos, a partir da leitura larga que ela faz. Duas
 * cópias das mesmas frases divergiam à primeira correcção de texto, e um clube
 * via "2 convocatórias por enviar" num ecrã e outra coisa no outro.
 *
 * Recebe as linhas em vez de as ir buscar: quem chama já as tem, e cada um tem a
 * sua janela de tempo.
 *
 * ## As regras que estão aqui dentro
 *
 * A janela das convocatórias é de dez dias — um jogo daqui a dois meses não é uma
 * pendência, é o calendário. As fichas por preencher **não** têm janela: um jogo
 * de Outubro por preencher em Janeiro continua a ser trabalho por fazer, e deixar
 * de o contar era fingir que se resolveu sozinho.
 */
export function matchAttention(rows: Pendencia[], agora = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  /*
   * Só conta o que é meu para fazer.
   *
   * A lista de jogos passou a incluir os das outras equipas. Sem este `mine`, um
   * treinador abria os Jogos com "sete convocatórias por enviar" de escalões que
   * não são dele — e que ele não tem como enviar. Um painel de pendências que
   * conta trabalho alheio deixa de se acreditar à segunda vez que se olha.
   */
  const activo = (r: Pendencia) => r.mine && r.status !== "CANCELLED";

  const porConvocar = rows
    .filter((r) => activo(r) && !r.submitted)
    .filter((r) => {
      const t = new Date(r.startsAt).getTime();
      return t >= agora && t - agora <= 10 * 86_400_000;
    })
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());

  if (porConvocar.length > 0) {
    const dias = Math.max(0, Math.ceil((new Date(porConvocar[0].startsAt).getTime() - agora) / 86_400_000));
    items.push({
      id: "callups-pending",
      /*
       * Urgente a três dias ou menos.
       *
       * Uma convocatória que não sai a tempo é uma família que não sabe se o
       * filho joga no sábado — e é o tipo de falha que se paga com um telefonema
       * ao clube, não com uma linha num relatório.
       */
      severity: dias <= 3 ? "risk" : "warn",
      title: `${porConvocar.length} ${porConvocar.length === 1 ? "convocatória por enviar" : "convocatórias por enviar"}`,
      detail:
        dias === 0
          ? `O mais próximo é hoje, ${porConvocar[0].teamName}`
          : dias === 1
            ? `O mais próximo é amanhã, ${porConvocar[0].teamName}`
            : `O mais próximo é em ${dias} dias, ${porConvocar[0].teamName}`,
      to: "/jogos?falta=convocar",
      action: "Convocar",
    });
  }

  const porPreencher = rows.filter(
    (r) => activo(r) && new Date(r.startsAt).getTime() < agora && r.ourScore === null,
  );

  if (porPreencher.length > 0) {
    items.push({
      id: "matches-unfilled",
      severity: "warn",
      title: `${porPreencher.length} ${porPreencher.length === 1 ? "jogo sem resultado" : "jogos sem resultado"}`,
      detail: "Sem ficha, os minutos e os golos não entram na ficha do atleta",
      to: "/jogos?falta=preencher",
      action: "Preencher",
    });
  }

  return items;
}

/* -------------------------------------------------------------------------- */

/** Ganhou, empatou ou perdeu. `undefined` enquanto não houver resultado. */
export function outcome(m: { ourScore: number | null; theirScore: number | null }) {
  if (m.ourScore === null || m.theirScore === null) return undefined;
  if (m.ourScore > m.theirScore) return "win" as const;
  if (m.ourScore < m.theirScore) return "loss" as const;
  return "draw" as const;
}

export const OUTCOME_LABEL = { win: "Vitória", draw: "Empate", loss: "Derrota" } as const;
export const OUTCOME_TONE = { win: "ok", draw: "neutral", loss: "risk" } as const;

/**
 * As funções sugeridas para a ficha técnica.
 *
 * Sugestões, e não uma lista fechada: escreve-se por cima. Cada clube chama-lhes
 * o que quer, e uma lista fechada obrigaria a um deploy por cada função nova que
 * um cliente inventasse.
 */
export const STAFF_ROLES = [
  "Treinador principal",
  "Treinador adjunto",
  "Treinador de guarda-redes",
  "Delegado ao jogo",
  "Massagista",
  "Fisioterapeuta",
  "Médico",
];
