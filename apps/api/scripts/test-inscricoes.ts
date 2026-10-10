/**
 * As inscrições na FPF (Modelo 2).
 *
 * O que este teste prova:
 *
 *  - as regras puras: a categoria pela idade (como a FPF a conta), o documento
 *    (CC partido em número e dígito de controlo, a sigla pelo nome do outro
 *    documento), o estatuto, o telefone e o nome partido em duas linhas;
 *  - o PDF: uma página por jogador, cada uma só com o seu jogador, e o fundo
 *    partilhado (cem folhas não pesam cem modelos);
 *  - o serviço verdadeiro, sobre um clube de mentira: quem lê e quem escreve,
 *    o âmbito por equipas, gerar (e gerar outra vez), os passos para a frente
 *    e para trás, a licença ao validar, e retirar a inscrição.
 *
 * Nada aqui toca numa base de dados nem na rede.
 *
 * Uso: npm run test:inscricoes
 */
import { PDFArray, PDFDocument, PDFName } from "pdf-lib";
import { partirNome } from "../src/inscricoes/desenho";
import { gerarFolhas } from "../src/inscricoes/folhas-pdf";
import { estatutoFpf } from "../src/inscricoes/paises";
import {
  associacaoValida,
  categoriaPelaIdade,
  documentoDoAtleta,
  emFalta,
  emFaltaNoClube,
  federacaoDaModalidade,
  montarFolha,
  normalizarCodigoDoClube,
  siglaDoNome,
  telefoneDaFolha,
  type AtletaParaFolha,
} from "../src/inscricoes/regras";
import { InscricoesService } from "../src/inscricoes/inscricoes.service";
import type { RequestContext } from "../src/common/permissions";

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

const EPOCA = { id: "e26", label: "2026/27", startsOn: new Date("2026-07-01"), endsOn: new Date("2027-06-30") };
const d = (s: string) => new Date(`${s}T00:00:00Z`);

async function main() {
  console.log("\nA categoria pela idade");
  {
    // Em 2024/25 os Juniores A eram os nascidos em 2006 e 2007.
    const e2425 = { startsOn: d("2024-07-01"), endsOn: d("2025-06-30") };
    check("2006 em 2024/25 é Júnior A", categoriaPelaIdade(d("2006-12-31"), e2425) === "03");
    check("2007 em 2024/25 é Júnior A", categoriaPelaIdade(d("2007-01-01"), e2425) === "03");
    check("2005 em 2024/25 é Sénior", categoriaPelaIdade(d("2005-06-01"), e2425) === "01");
    check("2008 em 2024/25 é Júnior B", categoriaPelaIdade(d("2008-03-01"), e2425) === "05");
    check("2014 em 2026/27 é Júnior D (Sub-13)", categoriaPelaIdade(d("2014-03-07"), EPOCA) === "09");
    check("2016 em 2026/27 é Benjamim (Sub-11)", categoriaPelaIdade(d("2016-09-01"), EPOCA) === "12");
    check("2018 em 2026/27 é Traquina (Sub-9)", categoriaPelaIdade(d("2018-09-01"), EPOCA) === "15");
    check("2021 em 2026/27 é Petiz", categoriaPelaIdade(d("2021-09-01"), EPOCA) === "17");
    // FPB: em 2024/25 os Sub 14 eram os nascidos em 2011 e 2012.
    check("FPB: 2011 em 2024/25 é Sub 14", categoriaPelaIdade(d("2011-05-01"), e2425, "FPB") === "SUB14");
    check("FPB: 2012 em 2024/25 é Sub 14", categoriaPelaIdade(d("2012-05-01"), e2425, "FPB") === "SUB14");
    check("FPB: 2013 em 2024/25 é Mini 12", categoriaPelaIdade(d("2013-05-01"), e2425, "FPB") === "MINI12");
    check("FPB: 2007 em 2024/25 é Sub 18", categoriaPelaIdade(d("2007-05-01"), e2425, "FPB") === "SUB18");
    check("FPB: 2006 em 2024/25 é Sénior", categoriaPelaIdade(d("2006-05-01"), e2425, "FPB") === "SENIOR");
    check("FPB: 2020 em 2026/27 é Baby-Basket", categoriaPelaIdade(d("2021-05-01"), EPOCA, "FPB") === "BABY");
  }

  console.log("\nO documento de identificação");
  {
    const cc = (n: string) => documentoDoAtleta({ citizenCardNumber: n, idDocLabel: null, idDocNumber: null });
    const a = cc("12345678 9 ZZ1");
    check("CC completo: NIC, número e dígito à parte", a?.sigla === "NIC" && a.numero === "12345678" && a.checkDigit === "9", JSON.stringify(a));
    const b = cc("123456789");
    check("nove algarismos são oito e o dígito", b?.numero === "12345678" && b.checkDigit === "9", JSON.stringify(b));
    const c = cc("12345678");
    check("oito algarismos não inventam dígito", c?.numero === "12345678" && c.checkDigit === null, JSON.stringify(c));
    const p = documentoDoAtleta({ citizenCardNumber: null, idDocLabel: "Passaporte", idDocNumber: "FA123456" });
    check("passaporte é PAS", p?.sigla === "PAS" && p.numero === "FA123456");
    check("título de residência é TR", siglaDoNome("Título de residência") === "TR");
    check("autorização de residência é AR", siglaDoNome("Autorização de Residência") === "AR");
    check("cartão de residência é CR", siglaDoNome("Cartão de residência") === "CR");
    check("um nome que não diz o documento fica por decidir", documentoDoAtleta({ citizenCardNumber: null, idDocLabel: "Outro", idDocNumber: "X1" }) === null);
    check("sem documento nenhum, nulo", documentoDoAtleta({ citizenCardNumber: null, idDocLabel: null, idDocNumber: null }) === null);
  }

  console.log("\nEstatuto, telefone, código do clube e nome");
  {
    check("português", estatutoFpf("PT") === "Português");
    check("espanhol é UE", estatutoFpf("ES") === "União Europeia");
    check("brasileiro é estrangeiro", estatutoFpf("BR") === "Estrangeiro");
    check("telefone sem indicativo", telefoneDaFolha("+351 912 345 678") === "912345678");
    check("telefone com 00351", telefoneDaFolha("00351912345678") === "912345678");
    check("código do clube só com algarismos", normalizarCodigoDoClube(" 1234 ") === "1234" && normalizarCodigoDoClube("") === null);
    let recusou = false;
    try {
      normalizarCodigoDoClube("AB12");
    } catch {
      recusou = true;
    }
    check("código com letras é recusado", recusou);
    const [l1, l2] = partirNome("JOÃO PEDRO DA CONCEIÇÃO GONÇALVES FERNANDES RIBEIRO");
    check("o nome parte entre palavras", l1 === "JOÃO PEDRO DA CONCEIÇÃO GONÇALVES" && l2 === "FERNANDES RIBEIRO", `${l1} | ${l2}`);
    check("nome curto fica numa linha", partirNome("ANA SILVA")[1] === "");
  }

  console.log("\nO que falta na ficha");
  const atleta: AtletaParaFolha = {
    name: "  João   Silva ",
    birthdate: d("2014-03-07"),
    sex: null,
    citizenCardNumber: "12345678 9 ZZ1",
    idDocLabel: null,
    idDocNumber: null,
    birthCountry: "PT",
    nationality: "PT",
    email: null,
    phone: null,
  };
  const clube = { name: "GD Teste", federationClubCode: "1234", association: "Braga" };
  {
    const f = montarFolha({ atleta, clube, epoca: EPOCA, disciplina: "football", generoDaEquipa: "MALE", tipo: "FIRST", categoria: "09", licenca: null, contactoDoEncarregado: { email: "mae@x.pt", phone: "912000000" } });
    check("o nome sai limpo", f.nome === "João Silva");
    check("o género vem da equipa quando o atleta não o tem", f.genero === "MALE");
    check("o contacto do encarregado preenche o email e o telefone", f.email === "mae@x.pt" && f.telefone === "912000000");
    check("com tudo, nada em falta", emFalta(f).length === 0, emFalta(f).join(", "));
    const g = montarFolha({ atleta: { ...atleta, birthCountry: null, nationality: null, citizenCardNumber: "12345678" }, clube, epoca: EPOCA, disciplina: "futsal", generoDaEquipa: null, tipo: "FIRST", categoria: "09", licenca: null });
    const falta = emFalta(g);
    check("diz o que falta", ["dígito de controlo do CC", "país de nascimento", "nacionalidade", "sexo", "email", "telefone"].every((x) => falta.includes(x)), falta.join(", "));
  }

  console.log("\nO basquetebol (FPB)");
  {
    const completo = {
      ...atleta, taxId: "123456789", idDocValidUntil: d("2030-01-31"), address: "Rua A, 1", postalCode: "4700-123",
      city: "Braga", district: "Braga", municipality: "Braga", email: "a@x.pt", phone: "912345678",
    };
    const fpb = (c: Record<string, unknown> = {}, a: typeof completo = completo) =>
      montarFolha({ atleta: a, clube: { ...clube, insuranceKind: "FPB", ...c }, epoca: EPOCA, disciplina: "basketball", generoDaEquipa: "MALE", tipo: "FIRST", categoria: "SUB14", licenca: null });
    check("o basquetebol vai para a FPB", fpb().federacao === "FPB");
    check("português é FBP", fpb().estatuto === "FBP");
    check("espanhol é sem FBP comunitário", fpb({}, { ...completo, nationality: "ES" }).estatuto === "COMUNITARIO");
    check("brasileiro é sem FBP não comunitário", fpb({}, { ...completo, nationality: "BR" }).estatuto === "NAO_COMUNITARIO");
    check("com tudo na ficha, nada em falta", emFalta(fpb()).length === 0, emFalta(fpb()).join(", "));
    const semMorada = emFalta(fpb({}, { ...completo, district: null, municipality: null, idDocValidUntil: null, taxId: null }));
    check("a FPB pede distrito, concelho, validade e NIF", ["distrito", "concelho", "validade do documento", "NIF"].every((x) => semMorada.includes(x)), semMorada.join(", "));
    check("o futebol não os pede", emFalta(montarFolha({ atleta: { ...completo, district: null, taxId: null }, clube, epoca: EPOCA, disciplina: "football", generoDaEquipa: "MALE", tipo: "FIRST", categoria: "09", licenca: null })).length === 0);
    check("seguro FPB: sem apólice nem companhia", JSON.stringify(fpb().seguro) === JSON.stringify({ tipo: "FPB", apolice: null, companhia: null }));
    const doClube = fpb({ insuranceKind: "CLUB", insurancePolicy: "AP-1", insuranceCompany: "Seguradora X" }).seguro;
    check("seguro do clube: com apólice e companhia", doClube?.tipo === "CLUB" && doClube.apolice === "AP-1" && doClube.companhia === "Seguradora X");
    check("o futebol não leva seguro", montarFolha({ atleta: completo, clube: { ...clube, insuranceKind: "CLUB" }, epoca: EPOCA, disciplina: "football", generoDaEquipa: null, tipo: "FIRST", categoria: "09", licenca: null }).seguro === null);
    check("ao clube de basquetebol falta o seguro, se não o disse", emFaltaNoClube({ ...clube }, "FPB").includes("seguro desportivo"));
    check("e a apólice, se é do clube", emFaltaNoClube({ ...clube, insuranceKind: "CLUB" }, "FPB").includes("apólice e companhia do seguro"));
    check("no basquetebol o código do clube não falta (o boletim não o tem)", !emFaltaNoClube({ ...clube, federationClubCode: null, insuranceKind: "FPB" }, "FPB").length);
    check("passar ao seguro FPB limpa a apólice", JSON.stringify(federacaoDaModalidade({ insuranceKind: "FPB", insurancePolicy: "AP-1" })) === JSON.stringify({ insuranceKind: "FPB", insurancePolicy: null, insuranceCompany: null }));
    check("associação que não existe é recusada", !associacaoValida("Marte") && associacaoValida("Braga"));
    const doc = documentoDoAtleta({ citizenCardNumber: null, idDocLabel: "Título de residência", idDocNumber: "TR123" });
    check("o «Outro» da FPB leva o nome do documento", doc?.sigla === "TR" && doc.descricao === "Título de residência" && doc.completo === "TR123");
  }

  console.log("\nO PDF");
  {
    const folhas = ["Ana", "Bruno", "Carla"].map((n) =>
      montarFolha({ atleta: { ...atleta, name: n }, clube, epoca: EPOCA, disciplina: "football", generoDaEquipa: null, tipo: "RENEWAL", categoria: "09", licenca: "12345678" }),
    );
    const um = await gerarFolhas(folhas.slice(0, 1));
    const tres = await gerarFolhas(folhas);
    const doc = await PDFDocument.load(tres);
    check("uma página por jogador", doc.getPageCount() === 3);
    check("sem campos de formulário (nomes repetidos entre folhas)", !doc.catalog.get(PDFName.of("AcroForm")));
    const listas = doc.getPages().map((p) => p.node.Contents());
    check("cada página tem a sua lista de conteúdos", listas.every((l) => l instanceof PDFArray) && new Set(listas).size === 3);
    const ultimos = listas.map((l) => String((l as PDFArray).get((l as PDFArray).size() - 1)));
    check("e o texto de cada uma é só dela", new Set(ultimos).size === 3, ultimos.join(" "));
    const primeiros = listas.map((l) => String((l as PDFArray).get(0)));
    check("o desenho do modelo é partilhado", new Set(primeiros).size === 1);
    check("três folhas não pesam três modelos", tres.length < um.length * 1.5, `${um.length} → ${tres.length}`);
    const misto = await PDFDocument.load(
      await gerarFolhas([
        folhas[0],
        montarFolha({ atleta, clube: { ...clube, insuranceKind: "FPB" }, epoca: EPOCA, disciplina: "basketball", generoDaEquipa: null, tipo: "FIRST", categoria: "SUB14", licenca: null }),
        folhas[1],
      ]),
    );
    const tamanhos = misto.getPages().map((p) => Math.round(p.getHeight()));
    check("um lote pode misturar futebol e basquetebol, pela ordem pedida", misto.getPageCount() === 3 && tamanhos[0] === 842 && tamanhos[2] === 842, tamanhos.join(","));
    const nomeEstranho = await gerarFolhas([montarFolha({ atleta: { ...atleta, name: "Łukasz Ştefan 李" }, clube, epoca: EPOCA, disciplina: "football", generoDaEquipa: null, tipo: "FIRST", categoria: "09", licenca: null })]);
    check("letras fora da fonte não rebentam a folha", nomeEstranho.length > 1000);
  }

  console.log("\nO serviço");
  await servico();

  console.log(`\n${ok} OK, ${bad} falhas\n`);
  if (bad) process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Um clube de mentira                                                         */
/* -------------------------------------------------------------------------- */

type Linha = Record<string, any>;

/**
 * Responde às consultas que o `InscricoesService` faz. Não imita o Prisma:
 * imita **este serviço**. Duas equipas de futebol (s13, s15), uma de
 * basquetebol (b13) e uma de natação, que não entra nas inscrições. A Ana
 * joga futebol e basquetebol.
 */
function mundo() {
  // A associação é do clube (`Academy.association`); a da modalidade já não se lê.
  const associacao: { valor: string | null } = { valor: "Braga" };
  const fed = { federationClubCode: "1234", association: "Lisboa", insuranceKind: null, insurancePolicy: null, insuranceCompany: null };
  const sports = [
    { id: "fut", name: "Futebol", code: "football", ...fed },
    { id: "bas", name: "Basquetebol", code: "basketball", ...fed, insuranceKind: "FPB" },
    { id: "nat", name: "Natação", code: null, ...fed },
  ];
  const teams = [
    { id: "s13", name: "Sub-13", sportId: "fut", seasonId: "e26", gender: "MALE", maxAge: 13 },
    { id: "s15", name: "Sub-15", sportId: "fut", seasonId: "e26", gender: null, maxAge: 15 },
    { id: "b13", name: "Basket Sub-13", sportId: "bas", seasonId: "e26", gender: null, maxAge: 13 },
    { id: "n1", name: "Natação", sportId: "nat", seasonId: "e26", gender: null, maxAge: 99 },
  ];
  const athletes: Linha[] = [
    { id: "a1", name: "Ana", birthdate: d("2014-02-01"), sex: "FEMALE", email: null, phone: null, citizenCardNumber: "123456789ZZ1", idDocLabel: null, idDocNumber: null, birthCountry: "PT", nationality: "PT", status: "ACTIVE" },
    { id: "a2", name: "Bruno", birthdate: d("2012-05-01"), sex: null, email: "b@x.pt", phone: "912345678", citizenCardNumber: null, idDocLabel: null, idDocNumber: null, birthCountry: null, nationality: null, status: "ACTIVE" },
    { id: "a3", name: "Carla", birthdate: d("2014-01-01"), sex: "FEMALE", email: null, phone: null, citizenCardNumber: null, idDocLabel: null, idDocNumber: null, birthCountry: null, nationality: null, status: "ACTIVE" },
  ];
  const memberships = [
    { athleteId: "a1", teamId: "s13", leftAt: null },
    { athleteId: "a2", teamId: "s15", leftAt: null },
    { athleteId: "a3", teamId: "b13", leftAt: null },
    { athleteId: "a1", teamId: "b13", leftAt: null },
    { athleteId: "a3", teamId: "n1", leftAt: null },
  ];
  const licenses: Linha[] = [{ athleteId: "a2", sportId: "fut", seasonId: "e25", number: "7654321", season: { startsOn: d("2025-07-01") } }];
  const regs: Linha[] = [];
  let seq = 0;

  const teamOf = (id: string) => teams.find((t) => t.id === id)!;
  const inTeams = (athleteId: string, filtro?: { in: string[] }) =>
    !filtro || memberships.some((m) => m.athleteId === athleteId && filtro.in.includes(m.teamId));

  const db = {
    season: {
      findMany: async () => [EPOCA],
      findFirst: async (q: Linha) => (q?.where?.id && q.where.id !== EPOCA.id ? null : { ...EPOCA, isCurrent: true }),
    },
    sport: {
      findMany: async (q?: Linha) => sports.filter((s) => !q?.where?.id?.in || q.where.id.in.includes(s.id)),
    },
    academy: {
      findFirst: async () => ({ name: "GD Teste", association: associacao.valor }),
    },
    membership: {
      findFirst: async () => ({ user: { name: "Diretora" } }),
    },
    teamMembership: {
      findMany: async (q: Linha) => {
        const w = q.where.team;
        return memberships
          .filter((m) => m.leftAt === null)
          .map((m) => ({ athleteId: m.athleteId, team: teamOf(m.teamId) }))
          .filter((m) => m.team.seasonId === w.seasonId && w.sportId.in.includes(m.team.sportId) && (!w.id || w.id.in.includes(m.team.id)));
      },
    },
    athlete: {
      findMany: async (q: Linha) =>
        athletes
          .filter((a) => q.where.id.in.includes(a.id))
          .map((a) => ({ ...a, licenses: licenses.filter((l) => l.athleteId === a.id), guardians: [] })),
    },
    playerRegistration: {
      findMany: async (q: Linha) =>
        regs.filter(
          (r) =>
            (!q.where.id || q.where.id.in.includes(r.id)) &&
            (!q.where.seasonId || r.seasonId === q.where.seasonId) &&
            (!q.where.sportId || q.where.sportId.in.includes(r.sportId)) &&
            inTeams(r.athleteId, q.where.athlete?.teams?.some?.teamId),
        ),
      findFirst: async (q: Linha) => {
        const r = regs.find((x) => x.id === q.where.id);
        return r && { season: { label: EPOCA.label }, sport: { name: "Futebol" }, athlete: { name: athletes.find((a) => a.id === r.athleteId)!.name } };
      },
      upsert: async (q: Linha) => {
        const k = q.where.athleteId_sportId_seasonId;
        const r = regs.find((x) => x.athleteId === k.athleteId && x.sportId === k.sportId && x.seasonId === k.seasonId);
        if (r) Object.assign(r, q.update);
        else regs.push({ id: `r${++seq}`, documentId: null, ...q.create });
      },
      update: async (q: Linha) => Object.assign(regs.find((x) => x.id === q.where.id)!, q.data),
      create: async (q: Linha) => regs.push({ id: `r${++seq}`, documentId: null, ...q.data }),
      deleteMany: async (q: Linha) => {
        for (const id of q.where.id.in) regs.splice(regs.findIndex((x) => x.id === id), 1);
      },
    },
    athleteLicense: {
      upsert: async (q: Linha) => {
        const k = q.where.athleteId_sportId_seasonId;
        const l = licenses.find((x) => x.athleteId === k.athleteId && x.sportId === k.sportId && x.seasonId === k.seasonId);
        if (l) Object.assign(l, q.update);
        else licenses.push({ ...q.create, season: { startsOn: EPOCA.startsOn } });
      },
    },
  };

  const prisma = { runAs: async (_: string, f: (db: unknown) => unknown) => f(db) };
  const nada = {} as never;
  const servico = new InscricoesService(prisma as never, nada, nada);
  return { servico, regs, licenses, associacao };
}

function pessoa(role: string, grants: string[] = [], revokes: string[] = [], teamIds: string[] = []): RequestContext {
  return {
    userId: "u", academyId: "ac", membershipId: "m", role, grants, revokes,
    rolePermissions: null, roleId: null, scope: { teamIds },
  } as unknown as RequestContext;
}

async function estadoDe(p: Promise<unknown>): Promise<number | "ok"> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return (e as { status?: number }).status ?? 500;
  }
}

async function servico() {
  const m = mundo();
  const direcao = pessoa("DIRECTOR");

  const lista = await m.servico.lista(direcao);
  check("futebol e basquetebol entram, a natação não", lista.rows.length === 4 && lista.sports.length === 2, String(lista.rows.length));
  check("quem joga duas modalidades aparece duas vezes", lista.rows.filter((r) => r.athleteId === "a1").map((r) => r.sportId).sort().join() === "bas,fut");
  const ana = lista.rows.find((r) => r.athleteId === "a1" && r.sportId === "fut")!;
  const anaBasket = lista.rows.find((r) => r.athleteId === "a1" && r.sportId === "bas")!;
  const bruno = lista.rows.find((r) => r.athleteId === "a2")!;
  check("a linha de basquetebol é da FPB, com o escalão da FPB", anaBasket.federation === "FPB" && anaBasket.category === "SUB14", `${anaBasket.federation} ${anaBasket.category}`);
  check("a de futebol é da FPF", ana.federation === "FPF" && ana.category === "09");
  check("cada modalidade diz o que falta ao clube nela", lista.sports.every((x) => x.missing.length === 0), JSON.stringify(lista.sports.map((x) => x.missing)));
  check("a associação vem do clube, a mesma nas duas modalidades", lista.club.association === "Braga" && lista.club.missing.length === 0);
  m.associacao.valor = null;
  const semAssociacao = await m.servico.lista(direcao);
  check("sem associação, falta uma vez ao clube e não a cada modalidade", semAssociacao.club.missing.join() === "associação" && semAssociacao.sports.every((x) => x.missing.length === 0), JSON.stringify(semAssociacao.sports.map((x) => x.missing)));
  m.associacao.valor = "Braga";
  check("quem nunca teve licença vai como primeira inscrição", ana.kind === "FIRST");
  check("quem teve licença noutra época vai como revalidação, com o número", bruno.kind === "RENEWAL" && bruno.license === "7654321");
  check("a Ana tem os dados todos menos contactos", ana.missing.join() === "email,telefone", ana.missing.join());
  check("ninguém começa com inscrição", lista.rows.every((r) => r.registration === null));

  check("o treinador sem permissão não lê", (await estadoDe(m.servico.lista(pessoa("COACH", [], [], ["s13"])))) === 403);
  const treinador = pessoa("COACH", ["registration:read", "registration:write"], [], ["s13"]);
  const dele = await m.servico.lista(treinador);
  check("com a permissão, um treinador só vê as suas equipas", dele.rows.length === 1 && dele.rows[0].athleteId === "a1");
  check("e não gera folhas de atletas de outras equipas", (await estadoDe(m.servico.gerar(treinador, { seasonId: "e26", items: [{ athleteId: "a2", sportId: "fut" }], attach: false }))) === 404);
  check("a coordenação lê e escreve por omissão", (await estadoDe(m.servico.lista(pessoa("COORDINATOR")))) === "ok");
  check("quem só lê pode pré-visualizar", (await estadoDe(m.servico.gerar(pessoa("DIRECTOR", [], ["registration:write"]), { seasonId: "e26", items: [{ athleteId: "a1", sportId: "fut" }], register: false }))) === "ok");
  check("mas não registar", (await estadoDe(m.servico.gerar(pessoa("DIRECTOR", [], ["registration:write"]), { seasonId: "e26", items: [{ athleteId: "a1", sportId: "fut" }] }))) === 403);
  check("transferência no basquetebol é recusada", (await estadoDe(m.servico.gerar(direcao, { seasonId: "e26", items: [{ athleteId: "a1", sportId: "bas", kind: "TRANSFER_NATIONAL" }] }))) === 400);
  check("um escalão da FPF no basquetebol é recusado", (await estadoDe(m.servico.gerar(direcao, { seasonId: "e26", items: [{ athleteId: "a1", sportId: "bas", category: "09" }], register: false }))) === 400);
  const duas = await m.servico.gerar(direcao, { seasonId: "e26", items: [{ athleteId: "a1", sportId: "fut" }, { athleteId: "a1", sportId: "bas" }], register: false });
  check("as duas folhas da Ana saem no mesmo PDF", duas.count === 2 && (await PDFDocument.load(Buffer.from(duas.pdf, "base64"))).getPageCount() === 2);
  check("tipo de boletim inventado é recusado", (await estadoDe(m.servico.gerar(direcao, { seasonId: "e26", items: [{ athleteId: "a1", sportId: "fut", kind: "OUTRO" }] }))) === 400);

  const ver = await m.servico.gerar(direcao, { seasonId: "e26", items: [{ athleteId: "a1", sportId: "fut" }], register: false });
  check("pré-visualizar não regista nada", m.regs.length === 0 && ver.pdf.length > 1000);

  const g = await m.servico.gerar(direcao, { seasonId: "e26", items: [{ athleteId: "a1", sportId: "fut" }, { athleteId: "a2", sportId: "fut", kind: "TRANSFER_NATIONAL" }], attach: false });
  const pdf = await PDFDocument.load(Buffer.from(g.pdf, "base64"));
  check("gerar duas dá um PDF de duas páginas", g.count === 2 && pdf.getPageCount() === 2);
  check("e duas inscrições geradas", m.regs.length === 2 && m.regs.every((r) => r.status === "GENERATED" && r.generatedByName === "Diretora"));
  const rBruno = m.regs.find((r) => r.athleteId === "a2")!;
  check("o tipo escolhido fica guardado", rBruno.kind === "TRANSFER_NATIONAL");
  check("e volta assim na lista", (await m.servico.lista(direcao)).rows.find((r) => r.athleteId === "a2")!.kind === "TRANSFER_NATIONAL");

  const muda = (quem: RequestContext, athleteIds: string[], status: string, license?: string) =>
    m.servico.mudarEstado(quem, { seasonId: "e26", items: athleteIds.map((athleteId) => ({ athleteId, sportId: "fut" })), status, license });

  await muda(direcao, ["a2"], "SUBMITTED");
  check("saltar para entregue também marca assinada", rBruno.status === "SUBMITTED" && rBruno.signedAt && rBruno.submittedAt && !rBruno.doneAt);
  await muda(direcao, ["a2"], "GENERATED");
  check("voltar atrás limpa as datas de cima", rBruno.status === "GENERATED" && !rBruno.signedAt && !rBruno.submittedAt);
  await muda(direcao, ["a2"], "DONE", " 99 88 ");
  check("validar com licença escreve-a na época da inscrição", m.licenses.some((l) => l.athleteId === "a2" && l.seasonId === "e26" && l.number === "99 88"));
  check("estado inventado é recusado", (await estadoDe(muda(direcao, ["a2"], "PERDIDA"))) === 400);
  check("licença para várias de uma vez é recusada", (await estadoDe(muda(direcao, ["a1", "a2"], "DONE", "1"))) === 400);
  check("licença fora de validar é recusada", (await estadoDe(muda(direcao, ["a2"], "SIGNED", "1"))) === 400);
  check("o treinador não mexe em inscrições de outras equipas", (await estadoDe(muda(treinador, ["a2"], "SIGNED"))) === 404);

  await m.servico.gerar(direcao, { seasonId: "e26", items: [{ athleteId: "a2", sportId: "fut" }], attach: false });
  check("gerar outra vez devolve a «gerada» e limpa os passos", rBruno.status === "GENERATED" && !rBruno.doneAt);
  check("e mantém o tipo de boletim que se tinha escolhido", rBruno.kind === "TRANSFER_NATIONAL");

  await muda(direcao, ["a2"], "PENDING");
  check("«por gerar» retira a inscrição", !m.regs.some((r) => r.athleteId === "a2") && (await m.servico.lista(direcao)).rows.find((r) => r.athleteId === "a2")!.registration === null);

  await muda(direcao, ["a1", "a2"], "SUBMITTED");
  const novas = m.regs.filter((r) => r.athleteId === "a2");
  check("quem está por gerar vai direto para qualquer passo", novas.length === 1 && novas[0].status === "SUBMITTED" && novas[0].signedAt && novas[0].submittedAt);
  check("com o tipo e a categoria propostos", novas[0].kind === "RENEWAL" && novas[0].category === "07", `${novas[0].kind} ${novas[0].category}`);
  check("e em lote, com a que já existia", m.regs.find((r) => r.athleteId === "a1")!.status === "SUBMITTED");
  await muda(direcao, ["a1", "a2"], "PENDING");
  check("e voltam todas a «por gerar» de uma vez", m.regs.length === 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
