/**
 * As notas da escola: só o encarregado submete, e só as dos seus.
 *
 * O que este teste prova, a tentar com o serviço verdadeiro:
 *
 *  - um pai submete e corrige as notas do filho, e **não** as do filho de outro;
 *  - o clube lê e não escreve — nem a direcção;
 *  - o próprio atleta lê e não escreve;
 *  - um treinador lê as dos atletas da equipa dele e não as de outra;
 *  - apagar a nota de outro miúdo responde como se ela não existisse;
 *  - a mesma disciplina no mesmo período corrige, não duplica.
 *
 * Base de mentira: nada aqui toca numa base de dados nem na rede.
 *
 * Uso: npm run test:notas-escolares
 */
import { SchoolGradesService } from "../src/academy/school-grades.service";
import { anoLectivoDe, chaveDaDisciplina, limparNota, negativa } from "../src/academy/notas-escolares";

let ok = 0;
let bad = 0;
const check = (label: string, cond: unknown, detalhe = "") => {
  if (cond) {
    ok++;
    console.log("  OK    " + label);
  } else {
    bad++;
    console.log("  FALHA " + label + (detalhe ? " — " + detalhe : ""));
  }
};
const lanca = (f: () => unknown) => {
  try {
    f();
    return false;
  } catch {
    return true;
  }
};
const estadoDe = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};

const BOA = { schoolYear: "2026/27", period: "1P", subject: " Matemática ", grade: 4, scale: 5 };

console.log("\nAs regras de uma nota");
{
  const n = limparNota(BOA);
  check("a disciplina fica aparada", n.subject === "Matemática");
  check("e a chave não tem acentos nem maiúsculas", n.subjectKey === "matematica");
  check("escrita de três maneiras é a mesma disciplina", chaveDaDisciplina("MATEMÁTICA ") === chaveDaDisciplina("matematica") && chaveDaDisciplina("Educação  Física") === "educacao fisica");
  check("o ano lectivo vira em Agosto", anoLectivoDe(new Date(2026, 6, 31)) === "2025/26" && anoLectivoDe(new Date(2026, 7, 1)) === "2026/27");
  check("e na viragem do século das dezenas", anoLectivoDe(new Date(2099, 9, 1)) === "2099/00");
  check("um ano lectivo que não bate certo é recusado", lanca(() => limparNota({ ...BOA, schoolYear: "2026/31" })));
  check("um período inventado é recusado", lanca(() => limparNota({ ...BOA, period: "9P" })));
  check("sem disciplina é recusado", lanca(() => limparNota({ ...BOA, subject: "  " })));
  check("uma disciplina só de símbolos é recusada", lanca(() => limparNota({ ...BOA, subject: "!!!" })));
  check("uma escala inventada é recusada", lanca(() => limparNota({ ...BOA, scale: 10 })));
  check("6 numa escala de 1 a 5 é recusado", lanca(() => limparNota({ ...BOA, grade: 6 })));
  check("0 numa escala de 1 a 5 é recusado", lanca(() => limparNota({ ...BOA, grade: 0 })));
  check("0 numa escala de 0 a 20 entra", limparNota({ ...BOA, grade: 0, scale: 20 }).grade === 0);
  check("21 em 20 é recusado", lanca(() => limparNota({ ...BOA, grade: 21, scale: 20 })));
  check("uma nota com casas decimais é recusada", lanca(() => limparNota({ ...BOA, grade: 3.5 })));
  check("uma nota em texto é recusada", lanca(() => limparNota({ ...BOA, grade: "4" })));
  check("negativa: abaixo de 3 em 5 e de 10 em 20", negativa(2, 5) && !negativa(3, 5) && negativa(9, 20) && !negativa(10, 20));
}

type Linha = Record<string, any>;

function mundo() {
  const estado = {
    atletas: [
      { id: "filho", teams: [{ teamId: "equipa1", leftAt: null }] },
      { id: "outro", teams: [{ teamId: "equipa2", leftAt: null }] },
    ] as Linha[],
    notas: [] as Linha[],
  };
  const servePara = (a: Linha, where: Linha): boolean => {
    if (a.id !== where.id) return false;
    for (const cond of where.AND ?? []) if (cond.id?.in && !cond.id.in.includes(a.id)) return false;
    const equipas = where.teams?.some?.teamId?.in as string[] | undefined;
    if (equipas && !a.teams.some((t: Linha) => equipas.includes(t.teamId))) return false;
    return true;
  };
  let seq = 0;
  const db = {
    athlete: { findFirst: async ({ where }: Linha) => estado.atletas.find((a) => servePara(a, where)) ?? null },
    membership: { findFirst: async () => ({ user: { name: "Mãe Teste" } }) },
    schoolGrade: {
      findMany: async ({ where }: Linha) => estado.notas.filter((n) => n.athleteId === where.athleteId),
      findFirst: async ({ where }: Linha) => estado.notas.find((n) => n.id === where.id) ?? null,
      upsert: async ({ where, create, update }: Linha) => {
        const k = where.athleteId_schoolYear_period_subjectKey;
        const antes = estado.notas.find(
          (n) => n.athleteId === k.athleteId && n.schoolYear === k.schoolYear && n.period === k.period && n.subjectKey === k.subjectKey,
        );
        if (antes) return Object.assign(antes, update);
        const nova = { id: "n" + ++seq, ...create };
        estado.notas.push(nova);
        return nova;
      },
      delete: async ({ where }: Linha) => {
        estado.notas = estado.notas.filter((n) => n.id !== where.id);
      },
    },
  };
  const prisma = { runAs: async (_a: string, work: (d: typeof db) => Promise<unknown>) => work(db) };
  return { estado, servico: new SchoolGradesService(prisma as never) };
}

const pessoa = (role: string, grants: string[], scope: Linha = {}) =>
  ({
    userId: "u", academyId: "clubeA", membershipId: "m", role,
    grants, revokes: [], rolePermissions: [], roleId: null, roleName: null, scope,
  }) as never;

const mae = pessoa("GUARDIAN", ["athlete:read"], { athleteIds: ["filho"] });
const proprio = pessoa("ATHLETE", ["athlete:read"], { athleteIds: ["filho"] });
const director = pessoa("DIRECTOR", ["athlete:read", "athlete:write"]);
const treinador = pessoa("COACH", ["athlete:read", "athlete:write"], { teamIds: ["equipa1"] });
const semFicha = pessoa("STAFF", [], { teamIds: ["equipa1"] });

console.log("\nQuem submete");
{
  const m = mundo();
  const n = (await m.servico.save(mae, "filho", BOA)) as Linha;
  check("a mãe submete a nota do filho", n.grade === 4 && n.subject === "Matemática" && n.submittedByName === "Mãe Teste");
  check("não submete a do filho de outro", (await estadoDe(m.servico.save(mae, "outro", BOA))) === 403);
  check("a direcção do clube não submete", (await estadoDe(m.servico.save(director, "filho", BOA))) === 403);
  check("o treinador não submete", (await estadoDe(m.servico.save(treinador, "filho", BOA))) === 403);
  check("o próprio atleta não submete", (await estadoDe(m.servico.save(proprio, "filho", BOA))) === 403);
  check("uma nota impossível dá 400", (await estadoDe(m.servico.save(mae, "filho", { ...BOA, grade: 9 }))) === 400);
  check("nada disto criou notas a mais", m.estado.notas.length === 1, String(m.estado.notas.length));

  await m.servico.save(mae, "filho", { ...BOA, subject: "matematica", grade: 5 });
  check("a mesma disciplina no mesmo período corrige, não duplica", m.estado.notas.length === 1 && m.estado.notas[0].grade === 5);
  await m.servico.save(mae, "filho", { ...BOA, period: "2P" });
  check("noutro período é outra nota", m.estado.notas.length === 2);
}

console.log("\nQuem lê");
{
  const m = mundo();
  await m.servico.save(mae, "filho", BOA);
  const daMae = (await m.servico.list(mae, "filho")) as Linha;
  check("a mãe lê as do filho, e pode editá-las", daMae.notas.length === 1 && daMae.editable === true);
  check("não lê as do filho de outro", (await estadoDe(m.servico.list(mae, "outro"))) === 404);
  const doClube = (await m.servico.list(director, "filho")) as Linha;
  check("a direcção lê, e é-lhe dito que não edita", doClube.notas.length === 1 && doClube.editable === false);
  check("o treinador lê as de um atleta da equipa dele", (await estadoDe(m.servico.list(treinador, "filho"))) === 200);
  check("e não as de um atleta de outra equipa", (await estadoDe(m.servico.list(treinador, "outro"))) === 404);
  const doProprio = (await m.servico.list(proprio, "filho")) as Linha;
  check("o próprio atleta lê as suas, sem as poder editar", doProprio.notas.length === 1 && doProprio.editable === false);
  check("quem não vê fichas de atleta não lê", (await estadoDe(m.servico.list(semFicha, "filho"))) === 403);
}

console.log("\nQuem apaga");
{
  const m = mundo();
  const n = (await m.servico.save(mae, "filho", BOA)) as Linha;
  const outraMae = pessoa("GUARDIAN", ["athlete:read"], { athleteIds: ["outro"] });
  check("outra mãe não apaga a nota: responde como se não existisse", (await estadoDe(m.servico.remove(outraMae, n.id))) === 404);
  check("a direcção também não", (await estadoDe(m.servico.remove(director, n.id))) === 404);
  check("a nota continua lá", m.estado.notas.length === 1);
  await m.servico.remove(mae, n.id);
  check("a mãe apaga a do filho", m.estado.notas.length === 0);
}

console.log(`\n${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);
