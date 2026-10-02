/**
 * Um clube de mentira para os testes da certificação.
 *
 * Responde às consultas que o `CertificationService` faz, com dados em memória.
 * Não imita o Prisma: imita **este serviço** — cada método devolve o que a
 * consulta correspondente devolveria num clube com oito equipas de futebol
 * masculino e uma feminina (a única com género indicado, como num clube real). Se o serviço passar a perguntar de outra maneira,
 * é aqui que se acerta.
 *
 * Nada toca numa base de dados nem na rede.
 */
import { CertificationService } from "../src/certification/certification.service";

type Linha = Record<string, any>;

export type Clube = {
  modalidades: { id: string; name: string; code: string | null }[];
  equipas: {
    id: string; name: string; maxAge: number; atletas: number; comPlano: boolean; ciclos: boolean;
    genero?: "MALE" | "FEMALE" | "MIXED";
    /** Quantas das atletas desta equipa têm o sexo indicado como feminino. */
    raparigas?: number;
  }[];
  /** Quantos atletas, do total, têm o exame médico fora da validade. */
  semExame: number;
  treinadores: number;
  contagens: {
    treinosRecentes: number;
    treinosRecentesComPlano: number;
    treinosComMaterial: number;
    jogos: number;
    comConvocatoria: number;
    comRelatorio: number;
    atletasAvaliados: number;
    registosClinicos: number;
    atletasComNotas: number;
    prospects: number;
    observacoes: number;
  };
  /** Os atletas com plano de nutrição publicado, por equipa. */
  nutricaoEm: string[];
};

export const CLUBE: Clube = {
  modalidades: [{ id: "futebol", name: "Futebol", code: "football" }],
  equipas: [
    { id: "s7", name: "Petizes", maxAge: 7, atletas: 9, comPlano: true, ciclos: true },
    { id: "s9", name: "Traquinas", maxAge: 9, atletas: 14, comPlano: true, ciclos: true },
    { id: "s11", name: "Benjamins", maxAge: 11, atletas: 24, comPlano: true, ciclos: true },
    { id: "s13", name: "Infantis", maxAge: 13, atletas: 24, comPlano: true, ciclos: true },
    { id: "s15", name: "Iniciados", maxAge: 15, atletas: 21, comPlano: true, ciclos: true },
    { id: "s17", name: "Juvenis", maxAge: 17, atletas: 19, comPlano: true, ciclos: false },
    { id: "s19", name: "Juniores", maxAge: 19, atletas: 18, comPlano: true, ciclos: true },
    { id: "sen", name: "Seniores", maxAge: 99, atletas: 24, comPlano: false, ciclos: false },
    { id: "f15", name: "Sub-15 Feminino", maxAge: 15, atletas: 13, comPlano: true, ciclos: true, genero: "FEMALE" },
  ],
  semExame: 4,
  treinadores: 9,
  contagens: {
    treinosRecentes: 84,
    treinosRecentesComPlano: 76,
    treinosComMaterial: 150,
    jogos: 22,
    comConvocatoria: 22,
    comRelatorio: 19,
    atletasAvaliados: 20,
    registosClinicos: 31,
    atletasComNotas: 118,
    prospects: 26,
    observacoes: 41,
  },
  nutricaoEm: ["s15", "s17", "s19"],
};

export function mundo(clube: Clube = CLUBE) {
  const estado = {
    processo: null as Linha | null,
    respostas: [] as Linha[],
  };

  const membros = (t: Clube["equipas"][number], desde: number) =>
    Array.from({ length: t.atletas }, (_, i) => ({
      athleteId: `${t.id}-${i}`,
      athlete: {
        medicalValidUntil: desde + i < clube.semExame ? new Date("2025-06-30") : new Date("2099-06-30"),
        sex: i < (t.raparigas ?? 0) ? "FEMALE" : null,
      },
    }));

  const emLista = (where: Linha, id: string) => !where?.teamId?.in || where.teamId.in.includes(id);
  const linhasPorEquipa = (where: Linha) =>
    clube.equipas
      .filter((t) => emLista(where, t.id) && (!where.blocks || t.comPlano))
      .map((t) => ({ teamId: t.id, _count: { _all: where.blocks ? 20 : 24 } }));

  const db = {
    sport: { findMany: async () => clube.modalidades },
    season: {
      findFirst: async () => ({ id: "epoca", label: "2026/27", startsOn: new Date("2026-08-01"), endsOn: new Date("2027-07-31"), isCurrent: false }),
    },
    membership: { findFirst: async () => ({ user: { name: "Diretora Teste" } }) },

    team: {
      findMany: async ({ select }: Linha) => {
        let desde = 0;
        return clube.equipas.map((t) => {
          const athletes = membros(t, desde);
          desde += t.atletas;
          return { id: t.id, name: t.name, maxAge: t.maxAge, gender: t.genero ?? null, athletes };
        });
      },
    },
    trainingSession: {
      groupBy: async ({ where }: Linha) => linhasPorEquipa(where),
      count: async ({ where }: Linha) =>
        where.OR ? clube.contagens.treinosComMaterial : where.blocks ? clube.contagens.treinosRecentesComPlano : clube.contagens.treinosRecentes,
    },
    trainingCycle: {
      findMany: async ({ where }: Linha) =>
        clube.equipas
          .filter((t) => t.ciclos && emLista(where, t.id))
          .flatMap((t) => [
            { teamId: t.id, level: "MESO", objective: "Consolidar o jogo posicional" },
            { teamId: t.id, level: "MICRO", objective: "Saída de bola sob pressão" },
            { teamId: t.id, level: "MICRO", objective: null },
          ]),
    },
    teamStaff: { findMany: async () => Array.from({ length: clube.treinadores }, (_, i) => ({ membershipId: `t${i}` })) },
    nutritionPlan: { findMany: async () => clube.nutricaoEm.map((id) => ({ athleteId: `${id}-0` })) },
    match: {
      count: async ({ where }: Linha) =>
        where.callUpsClosedAt ? clube.contagens.comConvocatoria : where.report ? clube.contagens.comRelatorio : clube.contagens.jogos,
    },
    evaluation: { findMany: async () => Array.from({ length: clube.contagens.atletasAvaliados }, (_, i) => ({ athleteId: `x${i}` })) },
    clinicalEntry: { count: async () => clube.contagens.registosClinicos },
    schoolGrade: { findMany: async () => Array.from({ length: clube.contagens.atletasComNotas }, (_, i) => ({ athleteId: `x${i}` })) },
    prospect: { count: async () => clube.contagens.prospects },
    observation: { count: async () => clube.contagens.observacoes },

    certificationProcess: {
      findUnique: async ({ select }: Linha) => {
        if (!estado.processo) return null;
        return select?.answers ? { ...estado.processo, answers: estado.respostas } : estado.processo;
      },
      create: async ({ data }: Linha) => (estado.processo = { id: "processo", ...data }),
      upsert: async ({ create, update }: Linha) => (estado.processo = estado.processo ? { ...estado.processo, ...update } : { id: "processo", ...create }),
    },
    certificationAnswer: {
      upsert: async ({ where, create, update }: Linha) => {
        const antes = estado.respostas.find((a) => a.code === where.processId_code.code);
        if (antes) return Object.assign(antes, update, { updatedAt: new Date() });
        const nova = { ...create, updatedAt: new Date() };
        estado.respostas.push(nova);
        return nova;
      },
      deleteMany: async ({ where }: Linha) => {
        estado.respostas = estado.respostas.filter((a) => a.code !== where.code);
      },
    },
  };

  const prisma = { runAs: async (_academia: string, work: (d: typeof db) => Promise<unknown>) => work(db) };
  return { estado, servico: new CertificationService(prisma as never) };
}

/** Uma pessoa do clube, com o papel e as excepções dadas. */
export const pessoa = (role: string, grants: string[] = [], revokes: string[] = []) =>
  ({
    userId: "u", academyId: "clubeA", membershipId: "m", role,
    grants, revokes, rolePermissions: null, roleId: null, roleName: null, extraRoles: [], navKeys: [], scope: {},
  }) as never;
