/**
 * Os jogos do CD Academias.
 *
 * Um modelo só, do qual saem as três formas que a API devolve: a lista do
 * arranque (`ApiMatch`), a lista da página Jogos (`MatchListRow`) e a página de
 * um jogo (`MatchDetail`). O jogo de sábado 10/10 dos Sub-13 é escrito à mão,
 * porque é o que o site mostra; os outros são gerados com semente fixa.
 */
import { em } from "./clube.mjs";

const semAcentos = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const chave = (s) => semAcentos(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const idDe = (nome) => `a-${chave(nome)}`;

function sorte(semente) {
  let h = 1779033703 ^ semente.length;
  for (let i = 0; i < semente.length; i++) {
    h = Math.imul(h ^ semente.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export const JOGO_DE_SABADO = "jg-sub13-j5";

/** [equipa, jornada, dia, hora, adversário, em casa, resultado]. */
const CALENDARIO = [
  ["t-sub13", 1, "2026-09-12", "15:00", "GD Vale do Rio", true, [3, 1]],
  ["t-sub13", 2, "2026-09-19", "11:00", "AD Monte Alto", false, [1, 1]],
  ["t-sub13", 3, "2026-09-26", "15:00", "FC Ribeira Nova", true, [2, 0]],
  ["t-sub13", 4, "2026-10-03", "11:00", "Sporting da Lagoa", false, [1, 2]],
  ["t-sub13", 5, "2026-10-10", "15:00", "União da Serra", true, [2, 1]],
  ["t-sub13", 6, "2026-10-17", "11:00", "CF Pinhal", false, [2, 2]],
  ["t-sub13", 7, "2026-10-24", "15:00", "Atlético do Castelo", true, [1, 0]],

  ["t-sub15", 1, "2026-09-13", "11:00", "Estrela do Norte", false, [0, 2]],
  ["t-sub15", 2, "2026-09-20", "11:00", "Juventude da Ponte", true, [4, 1]],
  ["t-sub15", 3, "2026-09-27", "11:00", "Desportivo de Alvarim", false, [2, 2]],
  ["t-sub15", 4, "2026-10-04", "11:00", "Académico da Vila", true, [3, 0]],
  ["t-sub15", 5, "2026-10-11", "11:00", "União da Serra", false, [1, 1]],
  ["t-sub15", 6, "2026-10-18", "11:00", "GD Vale do Rio", true, [2, 1]],

  ["t-sub11", 1, "2026-09-19", "10:00", "FC Ribeira Nova", true, [5, 3]],
  ["t-sub11", 2, "2026-10-03", "10:00", "AD Monte Alto", false, [2, 4]],
  ["t-sub11", 3, "2026-10-17", "10:00", "Sporting da Lagoa", true, [3, 3]],

  ["t-seniores", 1, "2026-09-13", "16:00", "Atlético do Castelo", true, [2, 0]],
  ["t-seniores", 2, "2026-09-20", "16:00", "CF Pinhal", false, [1, 3]],
  ["t-seniores", 3, "2026-09-27", "16:00", "Estrela do Norte", true, [1, 1]],
  ["t-seniores", 4, "2026-10-04", "16:00", "Juventude da Ponte", false, [2, 1]],
  ["t-seniores", 5, "2026-10-11", "16:00", "Desportivo de Alvarim", true, [3, 2]],
  ["t-seniores", 6, "2026-10-18", "16:00", "Académico da Vila", false, [0, 0]],
];

const TITULARES = { "t-sub11": 7, "t-sub13": 9, "t-sub15": 11, "t-seniores": 11 };
const CAMPO = { "t-sub11": "f7", "t-sub13": "f9", "t-sub15": "f11", "t-seniores": "f11" };

/** A ficha do jogo de sábado, linha a linha. */
const FICHA_DE_SABADO = [
  // nome, titular, entrou, saiu, golos, assistências, amarelos
  ["Afonso Lima", true, null, null, [], [], []],
  ["Bernardo Costa", true, null, 30, [], [], []],
  ["Daniel Pinto", true, null, null, [], [], []],
  ["Diogo Reis", true, null, 40, [], [], [38]],
  ["Francisco Sá", true, null, null, [], [], []],
  ["Tomás Ferreira", true, null, null, [23], [], []],
  ["Gabriel Nunes", true, null, 45, [], [23], []],
  ["João Brito", true, null, 55, [], [51], []],
  ["Henrique Melo", true, null, 55, [51], [], []],
  ["Duarte Matos", false, 30, null, [], [], []],
  ["Rodrigo Leal", false, 40, null, [], [], []],
  ["Vicente Maia", false, 45, null, [], [], []],
  ["Gonçalo Vaz", false, 55, null, [], [], []],
  ["Simão Alves", false, 55, null, [], [], []],
];

export function criarJogos(ctx) {
  const { equipas, daEquipa, porId, passou, agora } = ctx;
  const equipa = (id) => equipas.find((e) => e.id === id);

  const jogos = CALENDARIO.map(([teamId, jornada, dia, hora, adversario, casa, resultado]) => {
    const e = equipa(teamId);
    const id = `jg-${teamId.slice(2)}-j${jornada}`;
    const inicio = em(dia, hora);
    const fim = new Date(inicio.getTime() + (e.matchMinutes + 15) * 60_000);
    const r = sorte(id);
    const sabado = id === JOGO_DE_SABADO;

    // O resultado e a ficha entram uma hora e meia depois do apito final.
    const jogado = passou(new Date(fim.getTime() + 90 * 60_000));
    // A convocatória sai na antevéspera, às 18:30.
    const saida = new Date(inicio.getTime() - 2 * 86_400_000);
    const enviadaEm = em(saida.toLocaleDateString("sv-SE", { timeZone: "Europe/Lisbon" }), "18:30");
    const enviada = passou(enviadaEm);

    /* ---- Convocados ------------------------------------------------------- */
    const deBaixa = (a) =>
      (a.clinical ?? []).some((c) => c.impact === "out" && c.date.slice(0, 10) <= dia && (!c.clearedOn || c.clearedOn.slice(0, 10) > dia)) ||
      // O Salvador está de baixa desde 2/10, mesmo numa cena anterior a essa data.
      (a.name === "Salvador Cruz" && dia >= "2026-10-02");
    const plantel = daEquipa(teamId).filter((a) => !deBaixa(a)).sort((a, b) => a.squadNumber - b.squadNumber);
    let convocados = plantel.slice(0, e.maxCallUps).map((a) => ({ a, convidado: false }));
    if (sabado) convocados.push({ a: porId[idDe("Simão Alves")], convidado: true });

    const calledUp = enviada
      ? convocados.map(({ a, convidado }, i) => {
          // As respostas chegam ao longo das 20 horas seguintes.
          const quando = new Date(enviadaEm.getTime() + (10 + r() * 20 * 60) * 60_000);
          const recusa = sabado ? a.name === "Lourenço Faria" : !jogado ? false : i === 9 && jornada % 2 === 0;
          const respondeu = passou(quando) && (sabado || r() < 0.9 || jogado);
          return {
            athleteId: a.id,
            status: !respondeu ? "CALLED" : recusa ? "DECLINED" : "CONFIRMED",
            isGuest: convidado,
            ...(convidado ? { guestFromTeam: "Sub-11" } : {}),
            declineReason: respondeu && recusa ? (sabado ? "Continua com febre, o médico pediu repouso até segunda." : "Não pode ir") : null,
            respondedAt: respondeu ? quando.toISOString() : null,
          };
        })
      : [];

    /* ---- Ficha ------------------------------------------------------------ */
    let appearances = [];
    if (jogado) {
      if (sabado) {
        appearances = FICHA_DE_SABADO.map(([nome, titular, entrou, saiu, golos, assist, amarelos]) => ({
          athleteId: idDe(nome),
          minutes: (saiu ?? e.matchMinutes) - (entrou ?? 0),
          started: titular, tally: golos.length, assists: assist.length, yellowCards: amarelos.length, redCard: false,
          onMinute: entrou, offMinute: saiu, yellowAt: amarelos, redAt: null, tallyAt: golos, assistsAt: assist, rating: null,
        }));
      } else {
        const disponiveis = convocados.filter((_, i) => calledUp[i]?.status !== "DECLINED").map((c) => c.a);
        const nTit = TITULARES[teamId];
        const titulares = disponiveis.slice(0, nTit);
        const banco = disponiveis.slice(nTit);
        const linhas = titulares.map((a) => ({ a, titular: true, entrou: null, saiu: null }));
        // Quatro ou cinco trocas, do meio da segunda parte para a frente.
        const trocas = Math.min(banco.length - (teamId === "t-sub13" || teamId === "t-sub11" ? 1 : 2), 5);
        for (let k = 0; k < trocas; k++) {
          const minuto = Math.round(e.matchMinutes * (0.5 + 0.1 * k) / 5) * 5;
          // Sai um jogador de campo, nunca o guarda-redes nem o Tomás (que joga sempre o jogo todo).
          const candidatos = linhas.filter((l) => l.titular && l.saiu === null && l.a.position !== "Guarda-redes" && l.a.name !== "Tomás Ferreira");
          const sai = candidatos[Math.floor(r() * candidatos.length)];
          const entra = banco.filter((a) => a.position !== "Guarda-redes")[k];
          if (!sai || !entra) break;
          sai.saiu = minuto;
          linhas.push({ a: entra, titular: false, entrou: minuto, saiu: null });
        }
        const emCampo = (min) => linhas.filter((l) => (l.entrou ?? 0) <= min && (l.saiu ?? 999) > min && l.a.position !== "Guarda-redes");
        const golos = {}, assist = {};
        for (let g = 0; g < resultado[0]; g++) {
          const min = 3 + Math.floor(r() * (e.matchMinutes - 5));
          const quem = emCampo(min);
          const ofensivos = quem.filter((l) => /Avançado|Extremo|ofensivo|centro/.test(l.a.position));
          const marca = (ofensivos.length ? ofensivos : quem)[Math.floor(r() * (ofensivos.length || quem.length))];
          (golos[marca.a.id] ??= []).push(min);
          if (r() < 0.7) {
            const outros = quem.filter((l) => l !== marca);
            const passe = outros[Math.floor(r() * outros.length)];
            (assist[passe.a.id] ??= []).push(min);
          }
        }
        const amarelado = r() < 0.5 ? linhas[1 + Math.floor(r() * (linhas.length - 1))] : null;
        appearances = linhas.map((l) => {
          const am = l === amarelado ? [Math.min((l.saiu ?? e.matchMinutes) - 1, (l.entrou ?? 0) + 8 + Math.floor(r() * 20))] : [];
          return {
            athleteId: l.a.id,
            minutes: (l.saiu ?? e.matchMinutes) - (l.entrou ?? 0),
            started: l.titular,
            tally: golos[l.a.id]?.length ?? 0,
            assists: assist[l.a.id]?.length ?? 0,
            yellowCards: am.length, redCard: false,
            onMinute: l.entrou, offMinute: l.saiu,
            yellowAt: am, redAt: null,
            tallyAt: (golos[l.a.id] ?? []).sort((x, y) => x - y),
            assistsAt: (assist[l.a.id] ?? []).sort((x, y) => x - y),
            rating: null,
          };
        });
      }
    }

    const treinador = e.headCoach;
    const encontro = new Date(inicio.getTime() - 45 * 60_000);
    return {
      id, teamId, teamName: e.name, maxCallUps: e.maxCallUps, maxAge: e.maxAge, matchMinutes: e.matchMinutes,
      startsAt: inicio.toISOString(), endsAt: fim.toISOString(),
      venue: casa ? "Campo 1" : `Campo de jogos · ${adversario}`,
      opponent: adversario, isHome: casa,
      status: jogado ? "PLAYED" : "SCHEDULED",
      ourScore: jogado ? resultado[0] : null, theirScore: jogado ? resultado[1] : null,
      coachId: treinador?.id ?? null, coachName: treinador?.name ?? null,
      competition: e.competitions[0] ?? null,
      submitted: enviada, submittedAt: enviada ? enviadaEm.toISOString() : null,
      roundLabel: `Jornada ${jornada}`,
      meetingPoint: enviada ? (casa ? "Campo 1" : "Sede do clube") : null,
      meetingAt: enviada ? (casa ? encontro : new Date(inicio.getTime() - 90 * 60_000)).toISOString() : null,
      arrivalAt: null,
      callUpNotes: enviada ? (sabado ? "Equipamento principal. Trazer garrafa de água e caneleiras." : "Equipamento principal.") : null,
      confirmationRequired: true, respondBy: "GUARDIAN",
      mine: true, myStaffRole: null,
      calledUp, appearances,
      _jornada: jornada, _dia: dia, _campo: CAMPO[teamId], _resultado: resultado, _convocados: convocados,
    };
  });

  /* ---- O jogo de sábado, por inteiro --------------------------------------- */
  const POSICOES_3_2_3 = [["GR", 5, 25], ["DD", 16, 10], ["DC", 13, 25], ["DE", 16, 40], ["MC", 33, 18], ["MC", 33, 32], ["ED", 50, 9], ["PL", 55, 25], ["EE", 50, 41]];
  const ONZE = ["Afonso Lima", "Bernardo Costa", "Daniel Pinto", "Diogo Reis", "Francisco Sá", "Tomás Ferreira", "Gabriel Nunes", "Henrique Melo", "João Brito"];
  const BANCO = ["Martim Rocha", "Duarte Matos", "Rodrigo Leal", "Vicente Maia", "Gonçalo Vaz", "Simão Alves"];
  const analisado = passou(em("2026-10-11", "10:30"));
  const sabado = {
    plan: passou(em("2026-10-08", "21:00"))
      ? {
          pitch: "f9", system: "3-2-3", gameModelId: null,
          slots: POSICOES_3_2_3.map(([label, x, y], i) => ({ id: `pos-${i + 1}`, label, x, y, athleteId: idDe(ONZE[i]) })),
          bench: BANCO.map(idDe), captainId: idDe("Daniel Pinto"), viceCaptainId: idDe("Tomás Ferreira"),
          notes: "Sair a três pelo guarda-redes. O Francisco fica à frente dos centrais, o Tomás solta-se para chegar à área.",
          objectives: [
            { id: "obj-1", text: "Sair a jogar a três sempre que o guarda-redes tiver tempo", met: analisado ? true : null },
            { id: "obj-2", text: "Pressionar logo a seguir à perda, nos primeiros cinco segundos", met: analisado ? true : null },
            { id: "obj-3", text: "Não sofrer golos de bola parada", met: analisado ? false : null },
          ],
          updatedAt: em("2026-10-08", "21:00").toISOString(), authorName: "Miguel Antunes",
        }
      : null,
    report: analisado
      ? {
          summary: "Entrámos bem e com bola. O primeiro golo nasce de uma saída a três limpa, como treinámos na quarta. Depois do 2-0 recuámos e sofremos de canto, mas segurámos o resultado com calma.",
          positives: "Saída a três com o guarda-redes. Chegada do Tomás à área. Reação à perda no meio-campo adversário.",
          negatives: "Marcação nos cantos defensivos. Últimos dez minutos demasiado recuados.",
          toImprove: "Cantos defensivos, marcação à zona no primeiro poste. Gerir o jogo com bola quando estamos a ganhar.",
          difficulties: "O número 10 deles entre as nossas linhas na segunda parte.",
          videos: [], updatedAt: em("2026-10-11", "10:30").toISOString(), authorName: "Miguel Antunes",
        }
      : null,
    opponentReport: passou(em("2026-10-08", "20:40"))
      ? {
          formation: "3-3-2", style: "Bloco médio, saem em transição pelos dois avançados. Batem longo a partir do guarda-redes.",
          strengths: "Bolas paradas ofensivas. O 10 organiza e remata de fora da área.",
          weaknesses: "Espaço nas costas dos defesas laterais. Sofrem quando são pressionados na saída.",
          keyPlayers: "O 10 (médio centro) e o 9, rápido em profundidade.",
          setPieces: "Cantos batidos ao primeiro poste, com três jogadores a atacar a bola.",
          notes: null, updatedAt: em("2026-10-08", "20:40").toISOString(), authorName: "Rui Tavares",
        }
      : null,
    opponentHistory: [
      { matchId: "jg-antigo-1", startsAt: "2026-02-14T15:00:00.000Z", teamName: "Sub-13", competition: "Campeonato Distrital Sub-13", isHome: false, ourScore: 1, theirScore: 1, report: null },
      { matchId: "jg-antigo-2", startsAt: "2025-10-18T14:00:00.000Z", teamName: "Sub-13", competition: "Campeonato Distrital Sub-13", isHome: true, ourScore: 3, theirScore: 2, report: null },
    ],
    staff: [
      ["st-miguel-antunes", "Miguel Antunes", "Treinador principal"], ["st-rui-tavares", "Rui Tavares", "Treinador adjunto"],
      ["st-tiago-pires", "Tiago Pires", "Treinador de guarda-redes"], ["st-ines-carvalho", "Inês Carvalho", "Fisioterapeuta"],
      ["st-marta-silva", "Marta Silva", "Delegado ao jogo"],
    ].map(([membershipId, name, role], i) => ({ id: `ms-${i + 1}`, membershipId, name, role })),
  };

  /** A página de um jogo: `MatchDetail`. */
  function detalhe(id) {
    const jg = jogos.find((x) => x.id === id);
    if (!jg) return undefined;
    const e = equipa(jg.teamId);
    const rico = id === JOGO_DE_SABADO ? sabado : { plan: null, report: null, opponentReport: null, opponentHistory: [], staff: [] };
    const squad = jg.calledUp.map((c) => {
      const a = porId[c.athleteId];
      const f = jg.appearances.find((x) => x.athleteId === c.athleteId);
      return {
        athleteId: a.id, name: a.name, position: a.position, callUpStatus: c.status, isGuest: c.isGuest,
        ...(c.isGuest ? { guestFromTeam: c.guestFromTeam } : {}),
        played: Boolean(f), minutes: f?.minutes ?? 0, started: f?.started ?? false, tally: f?.tally ?? 0, assists: f?.assists ?? 0,
        yellowCards: f?.yellowCards ?? 0, redCard: false, onMinute: f?.onMinute ?? null, offMinute: f?.offMinute ?? null,
        yellowAt: f?.yellowAt ?? [], redAt: null, tallyAt: f?.tallyAt ?? [], assistsAt: f?.assistsAt ?? [],
      };
    });
    // Depois de jogado: titulares primeiro, a seguir quem entrou (pela ordem em
    // que entrou), e no fim quem ficou de fora. É a ordem de uma ficha de jogo.
    if (jg.status === "PLAYED") {
      const grupo = (s) => (s.started ? 0 : s.played ? 1 : 2);
      const ordem = new Map(squad.map((s, i) => [s, i]));
      squad.sort((x, y) => grupo(x) - grupo(y) || (x.onMinute ?? 0) - (y.onMinute ?? 0) || ordem.get(x) - ordem.get(y));
    }
    return {
      id: jg.id, teamId: jg.teamId, teamName: jg.teamName, maxAge: jg.maxAge, sportId: e.sportId, maxCallUps: jg.maxCallUps,
      // Sem tempo adicional: com ele a ficha soma-o aos minutos (64′ em vez de 60′)
      // e deixa de bater certo com o que foi gravado.
      matchMinutes: jg.matchMinutes, addedMinutes: [],
      startsAt: jg.startsAt, endsAt: jg.endsAt, venue: jg.venue, opponent: jg.opponent, isHome: jg.isHome, competition: jg.competition,
      status: jg.status, ourScore: jg.ourScore, theirScore: jg.theirScore, coachName: jg.coachName,
      submitted: jg.submitted, submittedAt: jg.submittedAt, roundLabel: jg.roundLabel, meetingPoint: jg.meetingPoint, meetingAt: jg.meetingAt,
      arrivalAt: jg.arrivalAt, callUpNotes: jg.callUpNotes, confirmationRequired: jg.confirmationRequired,
      statsEnteredAt: jg.status === "PLAYED" ? new Date(new Date(jg.endsAt).getTime() + 85 * 60_000).toISOString() : null,
      source: null, squad, staff: rico.staff,
      teamStaff: e.coaches.map((c) => ({ name: c.name, role: c.title })),
      report: rico.report, plan: rico.plan, opponentReport: rico.opponentReport, opponentHistory: rico.opponentHistory,
    };
  }

  /** A lista: serve o arranque (`ApiMatch`) e a página Jogos (`MatchListRow`), que pedem o mesmo endereço. */
  const lista = jogos.map((jg) => ({
    ...Object.fromEntries(Object.entries(jg).filter(([k]) => !k.startsWith("_") && k !== "maxAge" && k !== "matchMinutes")),
    prep: jg.id === JOGO_DE_SABADO && sabado.plan ? { slots: 9, starters: 9, bench: 6 } : { slots: 0, starters: 0, bench: 0 },
    analysed: jg.id === JOGO_DE_SABADO ? Boolean(sabado.report) : jg.status === "PLAYED" && jg._jornada % 2 === 1,
    opponentKnown: jg.id === JOGO_DE_SABADO ? Boolean(sabado.opponentReport) : false,
  }));

  return { jogos, lista, detalhe, agora };
}
