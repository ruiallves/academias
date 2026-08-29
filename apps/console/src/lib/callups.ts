import { apiGet } from "@/lib/http";
import { matches, reloadAcademy, type ApiMatch, type GuestCandidate } from "@/lib/store";
import { activeRestriction, isUnavailable } from "@/lib/clinical";
import { athleteById, listAthletes } from "@/lib/api";
import type { Session } from "@/lib/permissions";
import type { Athlete } from "@/data/types";

/**
 * Convocatórias.
 *
 * ## Guardar e submeter são coisas diferentes
 *
 * Guardar é livre e não avisa ninguém. **Submeter** fecha a lista e é o único
 * momento em que as famílias recebem uma notificação — é a regra que o servidor
 * impõe, e a interface tem de a tornar óbvia, senão o treinador submete a meio de
 * pensar e o pai recebe um aviso que muda daí a dez minutos.
 */

// Mesma origem em produção, `localhost` só em dev — ver `lib/http.ts`.
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

async function send(path: string, method = "POST", body?: unknown): Promise<void> {
  const raw = sessionStorage.getItem("academia.session");
  const token = raw ? (JSON.parse(raw) as { accessToken: string }).accessToken : undefined;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": raw ? (JSON.parse(raw) as { academySlug: string }).academySlug : "life-club",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    // A mensagem do servidor é a que interessa: diz o nome do atleta lesionado ou
    // o tecto da equipa. Substituí-la por "erro ao guardar" perde a única
    // informação útil.
    throw new Error(parsed?.message ?? "Não foi possível guardar a convocatória.");
  }
}

export const saveCallUps = (matchId: string, athleteIds: string[]) =>
  send(`/api/matches/${matchId}/convocatoria`, "POST", { athleteIds });

export const submitCallUps = (matchId: string) =>
  send(`/api/matches/${matchId}/convocatoria/submeter`);

export const reopenCallUps = (matchId: string) =>
  send(`/api/matches/${matchId}/convocatoria/reabrir`);

export const setMaxCallUps = (teamId: string, max: number) =>
  send(`/api/matches/equipas/${teamId}/max-convocados`, "PATCH", { max });

/** Depois de escrever, relê a academia — os números do menu e da ficha mudam com isto. */
export async function refresh(): Promise<void> {
  await reloadAcademy();
}

/* -------------------------------------------------------------------------- */
/* Leituras                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Os jogos que **eu** tenho para convocar, do mais próximo para o mais distante.
 *
 * ## Só as minhas equipas
 *
 * Não filtrava nada, e trazia o calendário inteiro do clube. Isso está certo no
 * calendário — um treinador tem de saber quando joga o escalão de cima e onde,
 * e é por isso que `calendarScopeFilter` deixa passar tudo (ver `permissions.ts`).
 * Aqui está errado: esta página não é uma agenda, é uma fila de trabalho, e um
 * jogo dos Sub-13 numa fila de quem não treina os Sub-13 é trabalho de outra
 * pessoa a ocupar espaço — e a lista de convocáveis daquele jogo nem sequer lhe
 * abre.
 *
 * `m.mine` é a resposta do servidor (`inTeamScope`), a mesma que a página dos
 * Jogos já lê. Contar equipas aqui seria uma segunda resposta à mesma pergunta,
 * e duas respostas acabam sempre a discordar uma vez. Para a direcção é sempre
 * verdadeira, porque as equipas dela são todas.
 *
 * ## E só os que ainda não começaram
 *
 * Havia seis horas de tolerância depois do apito inicial. A intenção era boa — o
 * treinador a fechar a lista à beira do campo — mas o efeito era um jogo
 * disputado de manhã a aparecer por convocar à tarde, num sítio onde tudo o que
 * lá está é uma coisa por fazer.
 *
 * Convocar depois do jogo continua a ser possível, e continua a ser onde deve
 * ser: **na página do jogo**, onde se está a preencher a ficha e se sabe quem
 * jogou. Aqui é o que está para vir.
 */
export function upcomingMatches(): ApiMatch[] {
  const agora = Date.now();
  return matches
    .filter((m) => m.mine)
    .filter((m) => m.status === "SCHEDULED" && new Date(m.startsAt).getTime() >= agora)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export type Eligible = {
  athlete: Athlete;
  /** Porque é que não pode ser convocado. Vazio = pode. */
  blockedBy: string | null;
};

/**
 * O plantel de um jogo, com quem não pode ir e porquê.
 *
 * Quem está de baixa aparece na lista — mas bloqueado e com o motivo à vista. É
 * deliberado: escondê-lo levava o treinador a pensar que o atleta saiu da equipa,
 * e a lista deixava de bater certo com o plantel que ele tem na cabeça.
 */
export function eligibleFor(session: Session, match: ApiMatch): Eligible[] {
  return listAthletes(session)
    .filter((a) => a.teamId === match.teamId)
    .map((a) => ({
      athlete: a,
      blockedBy:
        a.status === "paused"
          ? "Em pausa"
          : isUnavailable(a.id)
            ? (activeRestriction(a.id)?.title ?? "De baixa clínica")
            : null,
    }))
    .sort((x, y) => {
      // Disponíveis primeiro; o resto por número de camisola, como um treinador lê
      // um plantel.
      if (Boolean(x.blockedBy) !== Boolean(y.blockedBy)) return x.blockedBy ? 1 : -1;
      return (x.athlete.squadNumber ?? 99) - (y.athlete.squadNumber ?? 99);
    });
}

/**
 * O próximo jogo para o qual este atleta está convocado.
 *
 * Só conta convocatórias **submetidas**: uma lista ainda em rascunho não é uma
 * convocatória, e mostrá-la na ficha do atleta seria prometer o que ainda pode
 * mudar. Alimenta a etiqueta "Convocado" da ficha.
 */
export function calledUpFor(athleteId: string): ApiMatch | undefined {
  const now = Date.now();
  return matches
    .filter((m) => m.submitted && m.status === "SCHEDULED" && new Date(m.startsAt).getTime() >= now)
    .filter((m) => m.calledUp.some((c) => c.athleteId === athleteId))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
}

/** Nome do adversário e sítio, para a etiqueta e para os avisos. */
export function matchLabel(m: ApiMatch): string {
  return `${m.isHome ? "vs" : "@"} ${m.opponent}`;
}

export function athleteName(id: string): string {
  return athleteById(id)?.name ?? "—";
}

/** Utilidade para a API do fetch acima ser lida em qualquer sítio sem repetição. */
export const fetchMatches = () => apiGet<ApiMatch[]>("/api/matches");

/**
 * Quem se pode convocar de um escalão inferior — jogam para cima, nunca para
 * baixo. Vazio quando o escalão não segue o padrão "Sub-N" (a academia é
 * multi-desporto e nem todas as modalidades numeram assim) ou quando não há
 * ninguém elegível.
 */
export const fetchGuestPool = (matchId: string) => apiGet<GuestCandidate[]>(`/api/matches/${matchId}/convidados-elegiveis`);
