/**
 * A informação médica e os documentos de um atleta: quem lhes chega.
 *
 * São dados de saúde e cópias de documentos de identificação de menores. O que
 * este teste prova não é que "funciona", é que **quem não deve não chega lá** —
 * e prova-o a tentar, com o serviço verdadeiro:
 *
 *  - a família lê a informação médica do filho e não a consegue escrever;
 *  - quem não tem `clinical:read` não a lê;
 *  - a família não vê documentos, mesmo com a permissão de editar a ficha;
 *  - um treinador não chega aos documentos de um atleta de outra equipa;
 *  - uma chave de outro atleta, ou de outro clube, não entra num documento;
 *  - um ficheiro que não chegou ao armazenamento não entra;
 *  - apagar um documento apaga os ficheiros dele, e só os dele.
 *
 * Base de mentira e armazenamento de mentira: nada aqui toca numa base de dados
 * nem na rede.
 *
 * Uso: npm run test:ficha-do-atleta
 */
import { AthleteFichaService } from "../src/academy/athlete-ficha.service";
import {
  chaveDoAtleta,
  limparInfoMedica,
  nomeDoDocumento,
  nomeDoFicheiro,
  tipoDaChave,
} from "../src/academy/ficha-do-atleta";

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

/* -------------------------------------------------------------------------- */
/* 1. As regras                                                                */
/* -------------------------------------------------------------------------- */

console.log("\nA informação médica: o que se grava");
{
  const r = limparInfoMedica({ bloodType: " a+ ", allergies: "  Penicilina ", medication: "", notes: undefined });
  check("o grupo sanguíneo normaliza-se", r.bloodType === "A+", String(r.bloodType));
  check("o texto fica aparado", r.allergies === "Penicilina");
  check("um campo vazio grava-se como nulo", r.medication === null && r.notes === null);
  check("um grupo sanguíneo inventado é recusado", lanca(() => limparInfoMedica({ bloodType: "Z+" })));
  check("um texto que não é texto é recusado", lanca(() => limparInfoMedica({ allergies: { $ne: null } })));
  check("um texto enorme é recusado", lanca(() => limparInfoMedica({ notes: "x".repeat(2001) })));
}

console.log("\nOs documentos: de quem é cada ficheiro");
{
  const boa = "clubeA/atleta1/0123456789abcdef.pdf";
  check("a chave do próprio atleta entra", chaveDoAtleta(boa, "clubeA", "atleta1"));
  check("a de outro atleta não", !chaveDoAtleta(boa, "clubeA", "atleta2"));
  check("a de outro clube não", !chaveDoAtleta(boa, "clubeB", "atleta1"));
  check("subir de pasta não", !chaveDoAtleta("clubeA/atleta1/../atleta2/0123456789abcdef.pdf", "clubeA", "atleta1"));
  check("uma subpasta não", !chaveDoAtleta("clubeA/atleta1/x/0123456789abcdef.pdf", "clubeA", "atleta1"));
  check("uma extensão que não é das nossas não", !chaveDoAtleta("clubeA/atleta1/0123456789abcdef.html", "clubeA", "atleta1"));
  check("o que não é texto não", !chaveDoAtleta({ toString: () => boa }, "clubeA", "atleta1"));
  check("o tipo lê-se da extensão", tipoDaChave(boa) === "application/pdf");
  check("um documento sem nome é recusado", lanca(() => nomeDoDocumento("   ")));
  check("o nome do ficheiro perde o caminho", nomeDoFicheiro("C:\\Users\\mae\\cc.pdf", boa) === "cc.pdf");
  check("sem nome, fica um com a extensão certa", nomeDoFicheiro("", boa) === "ficheiro.pdf");
}

/* -------------------------------------------------------------------------- */
/* 2. O serviço verdadeiro                                                     */
/* -------------------------------------------------------------------------- */

type Linha = Record<string, any>;

function mundo() {
  const estado = {
    // atleta1 joga na equipa1; atleta2 na equipa2.
    atletas: [
      { id: "atleta1", teams: [{ teamId: "equipa1", leftAt: null }] },
      { id: "atleta2", teams: [{ teamId: "equipa2", leftAt: null }] },
    ] as Linha[],
    medica: new Map<string, Linha>(),
    docs: [] as Linha[],
    guardados: new Set<string>(),
    apagados: [] as string[],
    assinados: [] as string[],
  };

  /** O filtro de atletas, como o Prisma o aplicaria — só o que o serviço usa. */
  const servePara = (a: Linha, where: Linha): boolean => {
    if (where.id && typeof where.id === "string" && a.id !== where.id) return false;
    for (const cond of where.AND ?? []) if (cond.id?.in && !cond.id.in.includes(a.id)) return false;
    const equipas = where.teams?.some?.teamId?.in as string[] | undefined;
    if (equipas && !a.teams.some((t: Linha) => equipas.includes(t.teamId))) return false;
    return true;
  };

  let seq = 0;
  const db = {
    athlete: { findFirst: async ({ where }: Linha) => estado.atletas.find((a) => servePara(a, where)) ?? null },
    membership: { findFirst: async () => ({ user: { name: "Quem Escreveu" } }) },
    athleteMedicalInfo: {
      findFirst: async ({ where }: Linha) => estado.medica.get(where.athleteId) ?? null,
      upsert: async ({ where, create, update }: Linha) => {
        const antes = estado.medica.get(where.athleteId);
        const linha = { ...(antes ?? create), ...(antes ? update : {}), updatedAt: new Date() };
        estado.medica.set(where.athleteId, linha);
        return linha;
      },
    },
    athleteDocument: {
      findMany: async ({ where }: Linha) => estado.docs.filter((d) => d.athleteId === where.athleteId),
      findFirst: async ({ where }: Linha) => estado.docs.find((d) => d.id === where.id) ?? null,
      create: async ({ data }: Linha) => {
        const d = { id: "d" + ++seq, createdAt: new Date(), ...data };
        estado.docs.push(d);
        return d;
      },
      update: async ({ where, data }: Linha) => Object.assign(estado.docs.find((d) => d.id === where.id)!, data),
      delete: async ({ where }: Linha) => {
        estado.docs = estado.docs.filter((d) => d.id !== where.id);
      },
    },
  };

  const prisma = { runAs: async (_a: string, work: (d: typeof db) => Promise<unknown>) => work(db) };
  const storage = {
    ensureBucket: async () => undefined,
    signUpload: async (_b: string, key: string) => {
      estado.assinados.push(key);
      return { url: "https://armazem/" + key, token: "t" };
    },
    signDownload: async (_b: string, key: string) => "https://armazem/ler/" + key,
    exists: async (_b: string, key: string) => estado.guardados.has(key),
    remove: async (_b: string, key: string) => {
      estado.apagados.push(key);
    },
  };
  const espaco = { garantirEspaco: async () => undefined };

  const servico = new AthleteFichaService(prisma as never, storage as never, espaco as never);
  return { estado, servico };
}

const pessoa = (role: string, grants: string[], scope: Linha = {}) =>
  ({
    userId: "u", academyId: "clubeA", membershipId: "m", role,
    grants, revokes: [], rolePermissions: [], roleId: null, roleName: null, scope,
  }) as never;

const medica = pessoa("MEDICAL", ["clinical:read", "clinical:write"]);
const mae = pessoa("GUARDIAN", ["clinical:read", "clinical:write", "athlete:write"], { athleteIds: ["atleta1"] });
const secretaria = pessoa("STAFF", ["athlete:read"], { teamIds: ["equipa1"] });
const director = pessoa("DIRECTOR", ["athlete:write"]);
const treinador = pessoa("COACH", ["athlete:write", "clinical:read"], { teamIds: ["equipa1"] });

console.log("\nInformação médica: quem lê e quem escreve");
{
  const m = mundo();
  const gravado = (await m.servico.medicalSet(medica, "atleta1", { bloodType: "o-", allergies: "Amendoim" })) as Linha;
  check("o departamento clínico grava", gravado.bloodType === "O-" && gravado.allergies === "Amendoim");
  check("fica dito quem escreveu", gravado.updatedByName === "Quem Escreveu");

  const lido = (await m.servico.medicalGet(mae, "atleta1")) as Linha;
  check("a mãe lê a do filho", lido.allergies === "Amendoim");
  check("e é-lhe dito que não a pode editar", lido.editable === false);
  check("a mãe não a consegue escrever, mesmo com a permissão na mão", (await estadoDe(m.servico.medicalSet(mae, "atleta1", { allergies: "nenhuma" }))) === 403);
  check("o que estava gravado não mudou", m.estado.medica.get("atleta1")?.allergies === "Amendoim");
  check("a mãe não lê a de outro atleta", (await estadoDe(m.servico.medicalGet(mae, "atleta2"))) === 404);
  check("o treinador lê a de um atleta da equipa dele", (await estadoDe(m.servico.medicalGet(treinador, "atleta1"))) === 200);
  check("e não a de um atleta de outra equipa", (await estadoDe(m.servico.medicalGet(treinador, "atleta2"))) === 404);
  check("nem a escreve: ler não é escrever", (await estadoDe(m.servico.medicalSet(treinador, "atleta1", { notes: "x" }))) === 403);
  check("quem não tem acesso clínico não lê", (await estadoDe(m.servico.medicalGet(secretaria, "atleta1"))) === 403);
  check("um grupo sanguíneo inventado dá 400", (await estadoDe(m.servico.medicalSet(medica, "atleta1", { bloodType: "X" }))) === 400);

  const vazio = (await m.servico.medicalGet(medica, "atleta2")) as Linha;
  check("um atleta sem nada escrito lê-se vazio, sem erro", vazio.bloodType === null && vazio.updatedAt === null && vazio.editable === true);
}

console.log("\nDocumentos: quem lhes chega");
{
  const m = mundo();
  check("a família não vê documentos, mesmo com a permissão de editar a ficha", (await estadoDe(m.servico.documentsList(mae, "atleta1"))) === 403);
  check("nem pede autorização para carregar", (await estadoDe(m.servico.documentUploadUrl(mae, "atleta1", "application/pdf"))) === 403);
  check("quem só lê fichas não vê documentos", (await estadoDe(m.servico.documentsList(secretaria, "atleta1"))) === 403);
  check("o treinador vê os dos atletas da equipa dele", (await estadoDe(m.servico.documentsList(treinador, "atleta1"))) === 200);
  check("e não os de um atleta de outra equipa", (await estadoDe(m.servico.documentsList(treinador, "atleta2"))) === 404);
  check("nem carrega para ele", (await estadoDe(m.servico.documentUploadUrl(treinador, "atleta2", "application/pdf"))) === 404);
  check("nenhuma recusa chegou ao armazenamento", m.estado.assinados.length === 0, JSON.stringify(m.estado.assinados));
  check("um tipo de ficheiro fora da lista é recusado", (await estadoDe(m.servico.documentUploadUrl(director, "atleta1", "text/html"))) === 400);
}

console.log("\nDocumentos: o que entra num documento");
{
  const m = mundo();
  const a = (await m.servico.documentUploadUrl(director, "atleta1", "application/pdf")) as Linha;
  check("a chave autorizada é da pasta do atleta, no clube", String(a.key).startsWith("clubeA/atleta1/") && a.key.endsWith(".pdf"), a.key);

  check("um ficheiro que não chegou ao armazenamento não entra", (await estadoDe(m.servico.documentCreate(director, "atleta1", { name: "CC", files: [{ key: a.key }] }))) === 400);
  m.estado.guardados.add(a.key);

  // O ficheiro de outro atleta, que existe mesmo no armazenamento.
  const doOutro = "clubeA/atleta2/aaaaaaaaaaaaaaaa.pdf";
  const deOutroClube = "clubeB/atleta1/bbbbbbbbbbbbbbbb.pdf";
  m.estado.guardados.add(doOutro).add(deOutroClube);
  check("a chave de outro atleta não entra", (await estadoDe(m.servico.documentCreate(director, "atleta1", { name: "CC", files: [{ key: doOutro }] }))) === 400);
  check("nem a de outro clube", (await estadoDe(m.servico.documentCreate(director, "atleta1", { name: "CC", files: [{ key: deOutroClube }] }))) === 400);
  check("um documento sem ficheiros é recusado", (await estadoDe(m.servico.documentCreate(director, "atleta1", { name: "CC", files: [] }))) === 400);
  check("um documento sem nome é recusado", (await estadoDe(m.servico.documentCreate(director, "atleta1", { name: " ", files: [{ key: a.key }] }))) === 400);
  check("nada disto criou documento nenhum", m.estado.docs.length === 0);

  const doc = (await m.servico.documentCreate(director, "atleta1", { name: " Cartão de cidadão ", files: [{ key: a.key, name: "frente.pdf" }] })) as Linha;
  check("o documento nasce com o nome e o ficheiro", doc.name === "Cartão de cidadão" && doc.files.length === 1 && doc.files[0].name === "frente.pdf");
  check("e cada ficheiro traz o link para o abrir", String(doc.files[0].url).includes(a.key));

  check("o treinador de outra equipa não o apaga", (await estadoDe(m.servico.documentRemove(pessoa("COACH", ["athlete:write"], { teamIds: ["equipa2"] }), doc.id))) === 404);
  check("juntar-lhe o ficheiro de outro atleta é recusado", (await estadoDe(m.servico.documentUpdate(director, doc.id, { addFiles: [{ key: doOutro }] }))) === 400);
  check("o único ficheiro não se tira: apaga-se o documento", (await estadoDe(m.servico.documentRemoveFile(director, doc.id, a.key))) === 400);

  const b = (await m.servico.documentUploadUrl(director, "atleta1", "image/jpeg")) as Linha;
  m.estado.guardados.add(b.key);
  const maior = (await m.servico.documentUpdate(director, doc.id, { name: "CC", addFiles: [{ key: b.key, name: "verso.jpg" }] })) as Linha;
  check("juntar um ficheiro e mudar o nome", maior.name === "CC" && maior.files.length === 2);

  await m.servico.documentRemoveFile(director, doc.id, b.key);
  check("tirar um ficheiro apaga-o do armazenamento", m.estado.apagados.join() === b.key);

  await m.servico.documentRemove(director, doc.id);
  check("apagar o documento apaga os ficheiros dele", m.estado.apagados.includes(a.key) && m.estado.docs.length === 0);
  check("e só os dele", !m.estado.apagados.includes(doOutro) && !m.estado.apagados.includes(deOutroClube));
}

console.log(`\n${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);
