/**
 * As regras da importação de calendário, sem Nest e sem Prisma.
 *
 * Aqui vive o que decide: que dias uma linha dá, o que o tipo do clube faz do
 * evento, e — sobretudo — **o que choca com o quê**. É a parte que se engana
 * sozinha e em silêncio (um intervalo comparado ao contrário, um ficheiro que
 * se pisa a si próprio), e por isso fica onde pode ser exercitada sem servidor
 * nenhum: `npm run test:calendario-import`.
 *
 * O serviço (`events-import.service.ts`) trata do resto — permissões, leituras,
 * escritas. Mesma divisão de `members/cobertura.ts`, e pela mesma razão.
 *
 * **Sem imports de execução**, também como lá: é o que deixa o teste carregar
 * este ficheiro directamente com `--experimental-strip-types`, sem agrupar nada.
 * Por isso o passo de um dia está aqui em vez de vir de `common/fuso.ts`.
 */
import type { CalendarEventKind } from "@prisma/client";

/** O tecto por série, como no diálogo de repetir (`occurrences`). */
export const MAX_POR_LINHA = 200;

export type Dia = { ano: number; mes: number; dia: number };

/** Um evento que já ocupa o horário de uma equipa, ou um balneário. */
export type JaMarcado = {
  equipaId: string | null;
  balnearios: string[];
  /** Instantes em milissegundos — as horas já foram resolvidas no fuso do clube. */
  de: number;
  ate: number;
  /** Como se chama, para a mensagem dizer com o quê é que choca. */
  quem: string;
};

/** Uma ocorrência que o ficheiro quer criar. */
export type Candidato = {
  /** Devolvido tal e qual, para quem chama voltar à linha do ficheiro. */
  ref: number;
  equipa: { id: string; nome: string } | null;
  balnearios: string[];
  de: number;
  ate: number;
  rotulo: string;
};

/** Nomes comparam-se sem acentos, sem maiúsculas e sem espaços a mais. */
export function chave(v: string): string {
  return v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * O que o evento é, a partir do tipo do clube.
 *
 * Gémea de `kindOfEventType` na consola, e pela mesma razão que as permissões
 * têm duas cópias: lá decide o que o formulário mostra, aqui decide em que
 * tabela se grava. Os quatro tipos semeados são `isSystem` e não se renomeiam,
 * por isso casar pelo rótulo é seguro.
 */
export function kindDoRotulo(rotulo: string, fallback: string): CalendarEventKind {
  const n = chave(rotulo);
  if (n === "treino") return "TRAINING";
  if (n === "jogo") return "MATCH";
  if (n === "torneio") return "TOURNAMENT";
  if (n) return "OTHER";

  const f = (fallback || "").toUpperCase();
  return f === "TRAINING" || f === "MATCH" || f === "TOURNAMENT" ? (f as CalendarEventKind) : "OTHER";
}

/** `2026-10-07` → `{ ano, mes, dia }`, ou nada se não for um dia. */
export function lerDia(v: string): Dia | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v ?? "").trim());
  if (!m) return null;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  /* 31 de Fevereiro passa no teste de cima e não existe: confirma-se reconstruindo. */
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCMonth() + 1 !== mes || d.getUTCDate() !== dia) return null;
  return { ano, mes, dia };
}

export const hhmm = (h: { hora: number; minuto: number }) =>
  `${h.hora.toString().padStart(2, "0")}:${h.minuto.toString().padStart(2, "0")}`;

/**
 * Os dias de uma linha: só o primeiro, ou a série inteira.
 *
 * Em dias de calendário e não em instantes, como a repetição do diálogo
 * (`occurrences`): um treino das 18:00 continua às 18:00 depois da mudança da
 * hora, que é o que o clube espera. A hora entra só depois, em `instanteNoFuso`.
 */
export function diasDaSerie(
  primeiro: Dia,
  repeat: { until?: string; freq?: string; weekdays?: number[] },
): Dia[] | { error: string } {
  if (!repeat.until?.trim()) return [primeiro];

  const ate = lerDia(repeat.until);
  if (!ate) return { error: "A data até quando repetir é inválida (usa AAAA-MM-DD)" };

  const fim = Date.UTC(ate.ano, ate.mes - 1, ate.dia);
  const comeca = Date.UTC(primeiro.ano, primeiro.mes - 1, primeiro.dia);
  if (fim < comeca) return { error: "A repetição tem de acabar depois do primeiro dia" };

  const freq = (repeat.freq ?? "WEEKLY").toUpperCase();
  const out: Dia[] = [];

  if (freq === "MONTHLY") {
    for (let m = 0; out.length < MAX_POR_LINHA; m++) {
      const d = new Date(Date.UTC(primeiro.ano, primeiro.mes - 1 + m, primeiro.dia));
      /* Um mês sem o dia pretendido — 31 de Fevereiro — salta-se. */
      if (d.getUTCDate() !== primeiro.dia) continue;
      if (d.getTime() > fim) break;
      out.push({ ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1, dia: d.getUTCDate() });
    }
    return out;
  }

  const dias = freq === "WEEKLY" ? new Set(repeat.weekdays?.length ? repeat.weekdays : [diaDaSemana(primeiro)]) : null;
  let cursor = primeiro;
  for (let i = 0; i < 4000 && out.length < MAX_POR_LINHA; i++) {
    const t = Date.UTC(cursor.ano, cursor.mes - 1, cursor.dia);
    if (t > fim) break;
    if (!dias || dias.has(diaDaSemana(cursor))) out.push(cursor);
    cursor = maisUmDia(cursor);
  }
  if (out.length === 0) return { error: "Nenhum dos dias da semana escolhidos cai entre as duas datas" };
  return out;
}

/** O dia seguinte, sem passar por fusos. Gémeo de `somarDias` em `common/fuso.ts`. */
function maisUmDia(d: Dia): Dia {
  const x = new Date(Date.UTC(d.ano, d.mes - 1, d.dia + 1));
  return { ano: x.getUTCFullYear(), mes: x.getUTCMonth() + 1, dia: x.getUTCDate() };
}

const diaDaSemana = (d: Dia) => new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();

/**
 * O título, quando a folha não o traz.
 *
 * Só o evento genérico o usa — um treino não tem título na base, e o de um jogo
 * é desenhado a partir do adversário. O que se escreve aqui é o que o diálogo
 * sugeriria: o tipo e a equipa.
 */
export function tituloPorOmissao(
  kind: CalendarEventKind,
  tipo: string | undefined,
  equipa: string | null,
  adversario: string | undefined,
): string {
  if (kind === "MATCH") return `Jogo${adversario ? ` · ${adversario.trim()}` : ""}`;
  if (kind === "TRAINING") return `Treino${equipa ? ` · ${equipa}` : ""}`;
  return [tipo || "Evento", equipa].filter(Boolean).join(" · ");
}

/**
 * Quais das ocorrências entram, e porque é que as outras não.
 *
 * ## O que conta como choque
 *
 * A **mesma equipa** em dois sítios ao mesmo tempo, e o **mesmo balneário**
 * por duas coisas ao mesmo tempo. O local não: dois escalões dividem um campo
 * ao meio todos os dias, e recusar isso tornava a importação inútil.
 *
 * `de < fimDoOutro && ate > inicioDoOutro` — a definição de sempre. Um treino
 * que acaba às 19:00 e outro que começa às 19:00 **não** chocam: é a troca
 * normal de duas equipas, e recusá-la tornaria a regra inútil num pavilhão
 * cheio. Ver `assertDressingRoomsFree`.
 *
 * ## O ficheiro também se pisa a si próprio
 *
 * Por isso o que é aceite passa a ocupar: a segunda linha que marque o mesmo
 * balneário à mesma hora choca com a primeira, e não com a base de dados. Sem
 * isto, uma folha com a mesma linha copiada duas vezes passava as duas e o
 * choque só aparecia semanas depois, no pavilhão.
 *
 * ## Pela ordem em que vêm
 *
 * A primeira ocorrência ganha o lugar. É o que se consegue explicar a quem lê
 * o resultado — "a linha 12 chocou com a linha 4" — e o que torna a decisão
 * repetível: correr o ensaio duas vezes dá o mesmo.
 */
export function planearOcorrencias(
  candidatos: Candidato[],
  jaMarcados: JaMarcado[],
): { aceites: number[]; conflitos: { ref: number; motivo: string }[] } {
  const porEquipa = new Map<string, JaMarcado[]>();
  const porBalneario = new Map<string, JaMarcado[]>();
  const ocupar = (mapa: Map<string, JaMarcado[]>, k: string, o: JaMarcado) => {
    const lista = mapa.get(k);
    if (lista) lista.push(o);
    else mapa.set(k, [o]);
  };

  for (const o of jaMarcados) {
    if (o.equipaId) ocupar(porEquipa, o.equipaId, o);
    for (const b of o.balnearios) ocupar(porBalneario, chave(b), o);
  }

  const choca = (lista: JaMarcado[] | undefined, de: number, ate: number) =>
    lista?.find((o) => de < o.ate && ate > o.de);

  const aceites: number[] = [];
  const conflitos: { ref: number; motivo: string }[] = [];

  for (const c of candidatos) {
    const naEquipa = c.equipa ? choca(porEquipa.get(c.equipa.id), c.de, c.ate) : undefined;
    if (naEquipa) {
      conflitos.push({ ref: c.ref, motivo: `${c.equipa!.nome} já tem ${naEquipa.quem} a esta hora` });
      continue;
    }

    const salaOcupada = c.balnearios
      .map((b) => ({ b, o: choca(porBalneario.get(chave(b)), c.de, c.ate) }))
      .find((x) => x.o);
    if (salaOcupada) {
      conflitos.push({ ref: c.ref, motivo: `O balneário ${salaOcupada.b} está ocupado (${salaOcupada.o!.quem})` });
      continue;
    }

    const meu: JaMarcado = {
      equipaId: c.equipa?.id ?? null,
      balnearios: c.balnearios,
      de: c.de,
      ate: c.ate,
      quem: c.rotulo,
    };
    if (c.equipa) ocupar(porEquipa, c.equipa.id, meu);
    for (const b of c.balnearios) ocupar(porBalneario, chave(b), meu);
    aceites.push(c.ref);
  }

  return { aceites, conflitos };
}
