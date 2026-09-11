import { teamById } from "@/lib/api";
import { exportCallUpSheet, hora, type CallUpSheet, type SheetOrder, type SheetRow } from "@/lib/callup-sheet";
import type { MatchDetail } from "@/lib/matches";

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

/**
 * O jogo inteiro, como a folha o lê.
 *
 * ## Porque é que isto é uma função
 *
 * Porque havia duas maneiras de montar este objecto, e só uma estava certa. A
 * página do jogo passava a equipa de trabalho e o treinador principal; o ecrã
 * das Convocatórias passava `staff: []` e `coachName: null`, porque a lista de
 * jogos que ele tem não traz a equipa. O mesmo botão "Exportar PDF" dava duas
 * folhas diferentes consoante o sítio onde se carregava — e a das Convocatórias
 * saía sem massagista, sem delegado e sem ninguém a assinar.
 *
 * Quem exporta passa o jogo completo (`GET /api/matches/:id`), e isto decide o
 * resto num sítio só.
 */
export function folhaDoJogo(match: MatchDetail): SheetMatch {
  return {
    teamId: match.teamId,
    teamName: match.teamName,
    opponent: match.opponent,
    isHome: match.isHome,
    venue: match.venue,
    // A prova do jogo — a folha não a pede a ninguém.
    competition: match.competition ?? null,
    startsAt: match.startsAt,
    submitted: match.submitted,
    // Assina a folha o treinador principal escalado para o jogo; sem ele, o
    // treinador do jogo ou da equipa — que o servidor já escolheu com a regra
    // certa (`escolherTreinador`), e não "o primeiro da lista".
    coachName: match.staff.find((m) => m.role === "Treinador principal")?.name ?? match.coachName,
    /*
     * A equipa de trabalho do jogo, se alguém a escalou; senão, a equipa técnica
     * da ficha da equipa.
     *
     * Um clube preencheu a equipa técnica na equipa e esperava vê-la na
     * convocatória — a folha só lia a do jogo, que estava vazia, e saía sem
     * ninguém. Escalar para o jogo continua a mandar: quem vai a este jogo pode
     * não ser a equipa técnica toda.
     */
    staff: (match.staff.length > 0 ? match.staff : (match.teamStaff ?? [])).map((m) => ({ name: m.name, role: m.role })),
    roundLabel: match.roundLabel,
    meetingPoint: match.meetingPoint,
    meetingAt: match.meetingAt,
    arrivalAt: match.arrivalAt,
    callUpNotes: match.callUpNotes,
  };
}

type Exportar = {
  match: SheetMatch;
  rows: SheetRow[];
  academy: { name: string; logoUrl: string; signalColor: string };
  season: string;
};

/**
 * A folha pronta a desenhar — tudo menos o `save()`.
 *
 * Separada de `descarregarFolha` pela mesma razão que `buildCallUpPdf` está
 * separada de `exportCallUpSheet`: gravar o ficheiro é a única coisa que precisa
 * de um navegador. Sem esta costura, um teste só conseguia verificar a folha
 * montando o objecto à mão — e aí estava a verificar a sua própria cópia, não a
 * que os ecrãs usam. Foi exactamente numa cópia destas que a equipa de trabalho
 * se perdeu.
 */
export function folhaParaExportar(p: Exportar): CallUpSheet {
  const kickOff = new Date(p.match.startsAt);

  return {
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
    // `headCoach`, e não `coaches[0]`: a lista vem sem ordem, e num clube o
    // primeiro era o treinador de guarda-redes.
    coachName: p.match.coachName ?? teamById(p.match.teamId)?.headCoach?.name ?? null,
    staff: p.match.staff,
    rows: p.rows,
  };
}

export async function descarregarFolha(p: Exportar): Promise<void> {
  await exportCallUpSheet(folhaParaExportar(p));
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
