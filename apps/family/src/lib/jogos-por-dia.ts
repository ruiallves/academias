/**
 * Os jogos do sócio, dia a dia.
 *
 * ## Porquê
 *
 * O separador Jogos agrupava por equipa e cada cartão dizia só "Domingo · 15:00".
 * Quatro domingos seguidos da mesma equipa liam-se como o mesmo jogo, e um
 * treinador do clube queixou-se: "domingo de que semana?". Agora o ecrã é um dia
 * de cada vez, com a data inteira, e passa-se ao dia seguinte com o dedo.
 *
 * ## A ordem dentro do dia
 *
 * A mesma da lista do servidor: dos escalões mais velhos para os mais novos
 * (`teamMaxAge` desc), depois o nome da equipa, depois a hora. O primeiro do dia
 * é o destaque. Não se confia na ordem de chegada: ordena-se aqui outra vez,
 * porque agrupar por dia é exactamente o que a desfaz se o servidor mudar.
 *
 * Sem React nem `Date.now()` escondido: tudo recebe o "agora" de fora, para o
 * teste (`scripts/test-jogos-por-dia.mjs`) poder fixar o dia.
 */

export type JogoComData = {
  startsAt: string;
  teamMaxAge: number;
  teamName: string;
};

export type DiaDeJogos<T extends JogoComData> = {
  /** `AAAA-MM-DD` no relógio do telemóvel. */
  chave: string;
  /** Meia-noite desse dia, no relógio do telemóvel. */
  dia: Date;
  jogos: T[];
};

const DIA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const DIA_CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const dois = (n: number) => String(n).padStart(2, "0");

/** O dia de uma data, no relógio de quem lê. */
export function chaveDoDia(d: Date): string {
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

/** Quantos dias vão de `de` a `ate`, contando dias de calendário e não horas. */
export function diasEntre(de: Date, ate: Date): number {
  const a = Date.UTC(de.getFullYear(), de.getMonth(), de.getDate());
  const b = Date.UTC(ate.getFullYear(), ate.getMonth(), ate.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Mais velhos primeiro, depois a equipa, depois a hora. */
export function porPrioridade(a: JogoComData, b: JogoComData): number {
  return (
    b.teamMaxAge - a.teamMaxAge ||
    a.teamName.localeCompare(b.teamName, "pt") ||
    new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
  );
}

/** Os jogos partidos por dia: os dias por ordem, e dentro de cada um o escalão mais velho primeiro. */
export function jogosPorDia<T extends JogoComData>(jogos: T[]): DiaDeJogos<T>[] {
  const dias = new Map<string, DiaDeJogos<T>>();
  for (const jogo of jogos) {
    const inicio = new Date(jogo.startsAt);
    const chave = chaveDoDia(inicio);
    let dia = dias.get(chave);
    if (!dia) {
      dia = { chave, dia: new Date(inicio.getFullYear(), inicio.getMonth(), inicio.getDate()), jogos: [] };
      dias.set(chave, dia);
    }
    dia.jogos.push(jogo);
  }
  return [...dias.values()]
    .sort((a, b) => a.dia.getTime() - b.dia.getTime())
    .map((d) => ({ ...d, jogos: [...d.jogos].sort(porPrioridade) }));
}

/**
 * O dia escrito por inteiro, para o título do dia: "Hoje", "Amanhã" ou
 * "Domingo, 19 de outubro". O ano só aparece quando não é o deste ano.
 */
export function tituloDoDia(dia: Date, agora: Date): string {
  const n = diasEntre(agora, dia);
  if (n === 0) return "Hoje";
  if (n === 1) return "Amanhã";
  const nome = DIA[dia.getDay()];
  const ano = dia.getFullYear() === agora.getFullYear() ? "" : ` de ${dia.getFullYear()}`;
  return `${nome[0].toUpperCase()}${nome.slice(1)}, ${dia.getDate()} de ${MES_LONGO[dia.getMonth()]}${ano}`;
}

/**
 * Quando é um jogo, numa linha curta e sem ambiguidade: "Hoje", "Amanhã" ou
 * "Domingo, 19 out". Nunca o dia da semana sozinho, que foi o que deu origem
 * à queixa.
 */
export function quandoDoJogo(inicio: Date, agora: Date): string {
  const n = diasEntre(agora, inicio);
  if (n === 0) return "Hoje";
  if (n === 1) return "Amanhã";
  const nome = DIA[inicio.getDay()];
  return `${nome[0].toUpperCase()}${nome.slice(1)}, ${inicio.getDate()} ${MES[inicio.getMonth()]}`;
}

/** As três linhas da pílula do dia: "Dom" / "19" / "out", e "Hoje" no lugar do dia da semana. */
export function pilulaDoDia(dia: Date, agora: Date): { semana: string; numero: string; mes: string } {
  return {
    semana: diasEntre(agora, dia) === 0 ? "Hoje" : DIA_CURTO[dia.getDay()],
    numero: String(dia.getDate()),
    mes: MES[dia.getMonth()],
  };
}

/**
 * O sítio do jogo, sem repetir o "fora".
 *
 * A consola sugere "Fora · <adversário>" como local de um jogo fora, e o
 * cartão acrescentava " · fora" por cima: saía "Fora · FC Tadim · fora". O
 * "fora" passa a ser uma etiqueta à parte e o local fica só com o nome.
 */
export function localDoJogo(venue: string, isHome: boolean): { lugar: string; fora: boolean } {
  const lugar = venue.replace(/^\s*fora\s*[·•\-–—:]\s*/i, "").trim();
  return { lugar: lugar || venue.trim(), fora: !isHome };
}
