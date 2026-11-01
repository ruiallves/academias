/**
 * As regras da área comercial, sem base de dados.
 *
 * Duas coisas vivem aqui porque são as que mais facilmente ficam erradas sem
 * ninguém dar por isso: o que acontece a um clube depois de cada chamada (quando
 * se volta a ligar, quando se desiste) e quanto se paga ao comercial num mês
 * (horas e comissões). Estão separadas do serviço para se poderem testar à mão,
 * com datas escolhidas. Ver `scripts/test-comercial.ts`.
 *
 * As datas contam no relógio de Lisboa: a API corre em UTC em produção, e um
 * "amanhã às 10h" ou um "mês de novembro" são horas de parede.
 */
import { instanteNoFuso, partesNoFuso, somarDias } from "../common/fuso";

export type EstadoDoContacto = "NOVO" | "CONTACTADO" | "SEM_RESPOSTA" | "REUNIAO" | "PROPOSTA" | "CLIENTE" | "PERDIDO";
export type MotivoDePerda =
  | "PRECO"
  | "JA_USA_OUTRO"
  | "NAO_E_ALTURA"
  | "SEM_DECISAO"
  | "CLUBE_PEQUENO"
  | "SEM_INTERESSE"
  | "OUTRO";

export const RESULTADOS = ["NAO_ATENDEU", "LIGAR_MAIS_TARDE", "PEDIU_INFO", "SEM_INTERESSE", "REUNIAO", "NUMERO_ERRADO"] as const;
export type Resultado = (typeof RESULTADOS)[number];

/** À quarta chamada sem resposta o clube passa a "Sem resposta". */
export const MAX_TENTATIVAS = 4;

/** Depois de desistir por falta de resposta, volta-se a tentar daqui a tantos dias. */
export const DIAS_DEPOIS_DE_DESISTIR = 14;

/** Depois de mandar informação, liga-se a saber se a viram. */
export const DIAS_DEPOIS_DA_INFORMACAO = 3;

const ROTULO_DO_RESULTADO: Record<Resultado, string> = {
  NAO_ATENDEU: "Não atendeu",
  LIGAR_MAIS_TARDE: "Pediu para ligar mais tarde",
  PEDIU_INFO: "Pediu informação",
  SEM_INTERESSE: "Sem interesse",
  REUNIAO: "Reunião marcada",
  NUMERO_ERRADO: "Número errado",
};

export const ROTULO_DO_MOTIVO: Record<MotivoDePerda, string> = {
  PRECO: "Preço",
  JA_USA_OUTRO: "Já usa outro programa",
  NAO_E_ALTURA: "Não é altura",
  SEM_DECISAO: "Não decide / direção nova",
  CLUBE_PEQUENO: "Clube pequeno",
  SEM_INTERESSE: "Não vê necessidade",
  OUTRO: "Outro motivo",
};

/** Atendeu (falou-se com alguém). É o que conta para a taxa de atendimento. */
export function atendeu(resultado: string | null | undefined): boolean {
  return Boolean(resultado) && resultado !== "NAO_ATENDEU" && resultado !== "NUMERO_ERRADO";
}

/* -------------------------------------------------------------------------- */
/* Dias úteis                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Daqui a `dias` dias, à mesma hora de parede, saltando o fim de semana.
 *
 * O comercial trabalha de segunda a sexta: um seguimento que caísse num sábado
 * ficava atrasado na segunda sem ninguém ter falhado nada.
 */
export function proximoDiaUtil(base: Date, dias: number): Date {
  const p = partesNoFuso(base);
  let d = somarDias(p.ano, p.mes, p.dia, dias);
  for (let i = 0; i < 3; i++) {
    const semana = new Date(Date.UTC(d.ano, d.mes - 1, d.dia)).getUTCDay();
    if (semana === 6) d = somarDias(d.ano, d.mes, d.dia, 2);
    else if (semana === 0) d = somarDias(d.ano, d.mes, d.dia, 1);
    else break;
  }
  return instanteNoFuso(d.ano, d.mes, d.dia, p.hora, p.minuto);
}

/* -------------------------------------------------------------------------- */
/* O que uma chamada faz ao clube                                              */
/* -------------------------------------------------------------------------- */

export type Efeito = {
  status: EstadoDoContacto;
  tentativas: number;
  nextActionAt: Date | null;
  nextActionNote: string | null;
  /** `undefined` = não mexer; `null` = limpar. */
  lostReason: MotivoDePerda | null | undefined;
  /** A linha do histórico, escrita para se ler antes de voltar a ligar. */
  nota: string;
};

export function efeitoDaChamada(input: {
  resultado: Resultado;
  agora: Date;
  estado: EstadoDoContacto;
  tentativas: number;
  nota?: string | null;
  voltarEm?: Date | null;
  motivo?: MotivoDePerda | null;
}): Efeito {
  const { resultado, agora, estado } = input;
  const extra = input.nota?.trim() || null;
  const juntar = (base: string) => (extra ? `${base}: ${extra}` : base);
  // Um cliente continua cliente: registar uma chamada não o faz recuar.
  const manter = (novo: EstadoDoContacto): EstadoDoContacto => (estado === "CLIENTE" ? "CLIENTE" : novo);
  // Depois de alguém atender, "por contactar" e "sem resposta" já não são verdade.
  const falou = (): EstadoDoContacto =>
    estado === "NOVO" || estado === "SEM_RESPOSTA" || estado === "PERDIDO" ? "CONTACTADO" : estado;

  switch (resultado) {
    case "NAO_ATENDEU": {
      const tentativas = input.tentativas + 1;
      if (tentativas >= MAX_TENTATIVAS) {
        return {
          status: manter("SEM_RESPOSTA"),
          tentativas,
          nextActionAt: proximoDiaUtil(agora, DIAS_DEPOIS_DE_DESISTIR),
          nextActionNote: `Voltar a tentar (${tentativas} chamadas sem resposta)`,
          lostReason: undefined,
          nota: juntar(`Não atendeu (${tentativas}.ª tentativa, passa a sem resposta)`),
        };
      }
      return {
        status: estado,
        tentativas,
        // 1, 2, 3 dias: cada vez mais espaço, para não parecer insistência.
        nextActionAt: proximoDiaUtil(agora, tentativas),
        nextActionNote: `${tentativas + 1}.ª tentativa`,
        lostReason: undefined,
        nota: juntar(`Não atendeu (${tentativas}.ª tentativa)`),
      };
    }

    case "LIGAR_MAIS_TARDE": {
      if (!input.voltarEm) throw new Error("Falta a data para voltar a ligar");
      return {
        status: manter(falou()),
        tentativas: 0,
        nextActionAt: input.voltarEm,
        nextActionNote: extra ?? "Voltar a ligar, como combinado",
        lostReason: null,
        nota: juntar(ROTULO_DO_RESULTADO.LIGAR_MAIS_TARDE),
      };
    }

    case "PEDIU_INFO":
      return {
        status: manter(falou()),
        tentativas: 0,
        nextActionAt: input.voltarEm ?? proximoDiaUtil(agora, DIAS_DEPOIS_DA_INFORMACAO),
        nextActionNote: "Saber se viram a informação",
        lostReason: null,
        nota: juntar(ROTULO_DO_RESULTADO.PEDIU_INFO),
      };

    case "SEM_INTERESSE": {
      const motivo = input.motivo ?? "SEM_INTERESSE";
      return {
        status: manter("PERDIDO"),
        tentativas: 0,
        nextActionAt: input.voltarEm ?? null,
        nextActionNote: input.voltarEm ? "Voltar a tentar" : null,
        lostReason: estado === "CLIENTE" ? undefined : motivo,
        nota: juntar(`Sem interesse (${ROTULO_DO_MOTIVO[motivo].toLowerCase()})`),
      };
    }

    case "REUNIAO":
      return {
        status: manter("REUNIAO"),
        tentativas: 0,
        // A reunião tem a data dela; o seguimento fica livre.
        nextActionAt: null,
        nextActionNote: null,
        lostReason: null,
        nota: juntar(ROTULO_DO_RESULTADO.REUNIAO),
      };

    case "NUMERO_ERRADO":
      return {
        status: manter(estado === "NOVO" ? "SEM_RESPOSTA" : estado),
        tentativas: 0,
        nextActionAt: null,
        nextActionNote: null,
        lostReason: undefined,
        nota: juntar("Número errado"),
      };
  }
}

/* -------------------------------------------------------------------------- */
/* O mês                                                                       */
/* -------------------------------------------------------------------------- */

/** `2026-11` do instante, no relógio de Lisboa. */
export function mesDe(instante: Date): string {
  const p = partesNoFuso(instante);
  return `${p.ano}-${String(p.mes).padStart(2, "0")}`;
}

export function mesValido(ym: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(ym);
}

/** Do primeiro instante do mês ao primeiro instante do seguinte, em Lisboa. */
export function limitesDoMes(ym: string): { inicio: Date; fim: Date } {
  const ano = Number(ym.slice(0, 4));
  const mes = Number(ym.slice(5, 7));
  const seguinte = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
  return {
    inicio: instanteNoFuso(ano, mes, 1, 0, 0),
    fim: instanteNoFuso(seguinte.ano, seguinte.mes, 1, 0, 0),
  };
}

/** O início do dia e o início da semana (segunda-feira), em Lisboa. */
export function inicioDoDiaEDaSemana(agora: Date): { dia: Date; semana: Date } {
  const p = partesNoFuso(agora);
  const recuo = (p.diaDaSemana + 6) % 7; // segunda = 0
  const s = somarDias(p.ano, p.mes, p.dia, -recuo);
  return {
    dia: instanteNoFuso(p.ano, p.mes, p.dia, 0, 0),
    semana: instanteNoFuso(s.ano, s.mes, s.dia, 0, 0),
  };
}

/** Minutos de um turno. Um turno aberto conta até agora. */
export function minutosDoTurno(t: { startedAt: Date; endedAt: Date | null }, agora: Date): number {
  const fim = t.endedAt ?? agora;
  return Math.max(0, Math.floor((fim.getTime() - t.startedAt.getTime()) / 60_000));
}

/**
 * As comissões do mês, por blocos de reuniões marcadas.
 *
 * A conta é acumulada: com 5 por comissão, 3 reuniões em novembro e 2 em
 * dezembro fazem a primeira comissão em dezembro. `antes` são as reuniões que
 * contam marcadas antes do mês; `doMes` as do próprio mês.
 */
export function comissoes(antes: number, doMes: number, porComissao: number) {
  const x = Math.max(1, Math.floor(porComissao));
  const total = antes + doMes;
  const novas = Math.floor(total / x) - Math.floor(antes / x);
  const progresso = total % x;
  return { novas, progresso, faltam: x - progresso, porComissao: x, total };
}

/** Quanto se paga: as horas ao minuto, arredondadas ao cêntimo, mais as comissões. */
export function pagamento(minutos: number, hourlyCents: number, novasComissoes: number, commissionCents: number) {
  const hoursCents = Math.round((minutos * hourlyCents) / 60);
  const comissao = novasComissoes * commissionCents;
  return { hoursCents, commissionCents: comissao, totalCents: hoursCents + comissao };
}

/** "12h05", "0h40". */
export function horasEMinutos(minutos: number): string {
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

const NOMES_DOS_MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** `2026-11` → "novembro de 2026". */
export function nomeDoMes(ym: string): string {
  return `${NOMES_DOS_MESES[Number(ym.slice(5, 7)) - 1]} de ${ym.slice(0, 4)}`;
}
