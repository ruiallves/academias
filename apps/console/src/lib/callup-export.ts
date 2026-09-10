import { teamById } from "@/lib/api";
import { exportCallUpSheet, hora, type SheetOrder, type SheetRow } from "@/lib/callup-sheet";

/**
 * Descarregar a folha da convocatória — sem perguntar nada.
 *
 * ## Porque é que já não há diálogo
 *
 * Havia um, e perguntava a prova, a jornada, o ponto de encontro e as horas. Só
 * que essas coisas passaram a ser ditas **ao submeter a convocatória** (ver
 * `SubmitCallUpDialog`) e a viver no jogo, onde a app da família também as lê.
 * Perguntá-las outra vez aqui era pedir duas vezes a mesma resposta e arriscar
 * que o papel dissesse uma coisa e a app do pai dissesse outra — que é
 * exactamente o problema que se estava a resolver.
 *
 * Sobra uma escolha que é só do papel: a **ordem** da lista. Por nome dá-se
 * mais depressa com quem assina; por número é a ordem do plantel. Não é
 * informação sobre o jogo, é uma preferência de quem imprime, e por isso fica
 * onde estava — no navegador de quem imprime, por equipa.
 */

/** O mínimo que a folha precisa de saber sobre o jogo. */
export type SheetMatch = {
  teamId: string;
  teamName: string;
  opponent: string;
  isHome: boolean;
  venue: string;
  startsAt: string;
  competition: { id: string; label: string } | null;
  submitted: boolean;
  coachName: string | null;
  staff: { name: string; role: string }[];
  /** A logística dita ao submeter. Nula enquanto a convocatória não sair. */
  roundLabel?: string | null;
  meetingPoint?: string | null;
  meetingAt?: string | null;
  arrivalAt?: string | null;
  callUpNotes?: string | null;
};

export async function descarregarFolha(p: {
  match: SheetMatch;
  rows: SheetRow[];
  academy: { name: string; logoUrl: string; signalColor: string };
  season: string;
}): Promise<void> {
  const kickOff = new Date(p.match.startsAt);

  await exportCallUpSheet({
    competition: p.match.competition?.label ?? "",
    round: p.match.roundLabel ?? "",
    /*
     * Sem ponto de encontro dito, o recinto do jogo — que é onde a equipa se
     * junta quando ninguém combinou outra coisa. É a mesma queda que o diálogo
     * antigo fazia ao pré-preencher o campo.
     */
    meetingPoint: p.match.meetingPoint ?? p.match.venue,
    meetingTime: p.match.meetingAt ? hora(new Date(p.match.meetingAt)) : "",
    arrivalTime: p.match.arrivalAt ? hora(new Date(p.match.arrivalAt)) : "",
    notes: p.match.callUpNotes ?? "",
    order: ordemLembrada(p.match.teamId),
    academy: p.academy,
    season: p.season,
    team: p.match.teamName,
    opponent: p.match.opponent,
    isHome: p.match.isHome,
    venue: p.match.venue,
    kickOff,
    submitted: p.match.submitted,
    coachName: p.match.coachName ?? teamById(p.match.teamId)?.coaches[0]?.name ?? null,
    staff: p.match.staff,
    rows: p.rows,
  });
}

const chave = (teamId: string) => `academia.convocatoria.ordem.${teamId}`;

/** A ordem preferida desta equipa. Por nome, enquanto ninguém disser outra coisa. */
export function ordemLembrada(teamId: string): SheetOrder {
  try {
    const v = localStorage.getItem(chave(teamId));
    return v === "number" ? "number" : "name";
  } catch {
    // Uma janela privada não impede ninguém de imprimir: perde-se a preferência.
    return "name";
  }
}

export function lembrarOrdem(teamId: string, order: SheetOrder): void {
  try {
    localStorage.setItem(chave(teamId), order);
  } catch {
    /* idem */
  }
}
