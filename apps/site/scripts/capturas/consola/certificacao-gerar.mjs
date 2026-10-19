/**
 * Gera `certificacao.json`: a Certificação FPF do CD Academias.
 *
 *   node apps/site/scripts/capturas/consola/certificacao-gerar.mjs
 *
 * A página da certificação não faz contas: mostra o que a API calcula em
 * `apps/api/src/certification`. Para os números baterem certo uns com os outros
 * (os pontos do mostrador com os de cada critério, o caminho para as 4 estrelas
 * com os requisitos em falta), este gerador usa o **mesmo** motor, o mesmo
 * manual e as mesmas regras da API, compilados com o esbuild para uma pasta
 * temporária. Nada de base de dados nem de Nest: só funções puras.
 *
 * O que é inventado são os factos do clube (as contagens que a API leria da
 * base) e as respostas que a direção deu à mão. O resto é o `montar` do
 * `CertificationService`, copiado na forma: se a API mudar o que devolve, é
 * aqui que se acerta.
 *
 * O clube: formação em Sub-11, Sub-13 e Sub-15, mais os seniores, num concelho
 * de baixa densidade (Vila Nova da Serra). Com três escalões chega às 3 estrelas;
 * as 4 pedem os sete escalões, quatro obrigatórias que ainda faltam e 80 pontos.
 */
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "../../../../..");
const CERT = join(RAIZ, "apps/api/src/certification");
const SAIDA = join(AQUI, "certificacao.json");

/* -------------------------------------------------------------------------- */
/* O motor da API, compilado                                                   */
/* -------------------------------------------------------------------------- */

async function carregarMotor() {
  const esbuild = createRequire(join(RAIZ, "package.json"))("esbuild");
  const pasta = join(tmpdir(), "claude", "capturas-certificacao");
  mkdirSync(pasta, { recursive: true });
  const ficheiro = join(pasta, `motor-${Date.now()}.mjs`);
  await esbuild.build({
    stdin: {
      contents: [
        `export * from "./motor";`,
        `export { REGRAS, semAtletas } from "./regras";`,
        `export { FPF_F11M_2026 } from "./catalogo-fpf-f11m-2026";`,
      ].join("\n"),
      resolveDir: CERT,
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: ficheiro,
    logLevel: "warning",
  });
  return import(pathToFileURL(ficheiro).href);
}

/* -------------------------------------------------------------------------- */
/* O CD Academias                                                              */
/* -------------------------------------------------------------------------- */

/** A segunda de manhã das capturas da direção. */
const AGORA = "2026-10-12T09:50:00.000Z";

/** As equipas de futebol da época, como as de `clube.mjs`. */
const EQUIPAS = [
  { id: "t-sub11", name: "Sub-11", maxAge: 11, athletes: 14, gender: null },
  { id: "t-sub13", name: "Sub-13", maxAge: 13, athletes: 16, gender: null },
  { id: "t-sub15", name: "Sub-15", maxAge: 15, athletes: 18, gender: null },
  { id: "t-seniores", name: "Seniores", maxAge: 99, athletes: 20, gender: null },
];

/**
 * Concelho de baixa densidade: com três escalões de formação o acesso chega
 * às Entidades Formadoras (3 estrelas). Tem seniores e não recruta.
 */
const PERFIL = {
  hasSenior: true, recruits: false, hasDre: false, nonNationals: false,
  nationalLast5: false, islands: false, lowDensity: true,
};

/**
 * Os factos que a API leria da base, contados à mão a partir de `clube.mjs` e
 * `tecnica.mjs`: os treinos de 8/9 a 9/10, todos com plano; só os Sub-13 têm
 * microciclos com objetivo escrito; o material só vem nos planos do Miguel.
 */
function factosDo(semAtletas) {
  const treinos = { "t-sub11": 10, "t-sub13": 13, "t-sub15": 15 };
  const teams = EQUIPAS.map((t) => ({
    id: t.id, name: t.name, maxAge: t.maxAge, women: false, athletes: t.athletes,
    sessions: treinos[t.id] ?? 0, sessionsWithBlocks: treinos[t.id] ?? 0,
    mesos: t.maxAge < 99 ? 3 : 0, micros: t.maxAge < 99 ? 13 : 0, microsWithObjective: t.id === "t-sub13" ? 7 : 0,
  }));
  const athletesByAge = { ...semAtletas(), 11: 14, 13: 16, 15: 18 };
  return {
    teams, athletesByAge, formationAthletes: 48,
    // Miguel, Rui, André, Ricardo, Filipe e Tiago: seis treinadores para três equipas.
    coaches: 6, womenPlayers: 0,
    recentSessions: 32, recentSessionsPlanned: 32, plannedSessions: 38, plannedSessionsWithMaterial: 14,
    matchesPlayed: 11, matchesWithCallUp: 11, matchesWithReport: 9,
    athletesEvaluated: 41, clinicalEntries: 6, athletesWithValidExam: 46, nutritionAgeGroups: 1, athletesWithGrades: 42,
    prospects: 9, observations: 14,
  };
}

/* ---- As respostas da direção ------------------------------------------------ */

const QUEM = {
  paulo: "Paulo Rebelo", helena: "Helena Marques", sergio: "Sérgio Almeida", ines: "Inês Carvalho", marta: "Marta Silva",
};

/** Quem responde a cada critério, e quando. */
const POR_CRITERIO = {
  0: [QUEM.helena, "2026-09-18T10:20:00.000Z"],
  1: [QUEM.paulo, "2026-09-21T21:05:00.000Z"],
  2: [QUEM.paulo, "2026-09-21T21:30:00.000Z"],
  3: [QUEM.sergio, "2026-09-24T18:40:00.000Z"],
  4: [QUEM.sergio, "2026-09-29T19:10:00.000Z"],
  5: [QUEM.ines, "2026-10-01T17:45:00.000Z"],
  6: [QUEM.marta, "2026-10-02T11:15:00.000Z"],
  7: [QUEM.paulo, "2026-10-05T09:30:00.000Z"],
  8: [QUEM.paulo, "2026-10-05T10:05:00.000Z"],
  9: [QUEM.sergio, "2026-10-08T20:20:00.000Z"],
};

/**
 * O que não é cheio. Um número é o valor respondido (o índice do patamar, nas
 * questões por níveis); `null` é uma questão ainda por responder.
 */
const RESPOSTAS = {
  // 1 · A Bandeira da Ética só com a iniciativa submetida; o orçamento a meio.
  "1.2.1": 0, "1.3.1": 1,
  // 4 · O documento orientador sem o perfil do treinador; transição sem equipa B.
  "4.1.9": null, "4.3.1.3": null, "4.3.1.4": null,
  // 5 · O departamento médico: plano até ao ponto VI, sem nutricionista.
  "5.1.1": 1, "5.2.1": 3, "5.2.4": null, "5.2.6": null,
  "5.4.2.1": 1, "5.4.2.2": 1, "5.4.2.4": null, "5.4.4.2": null, "5.4.4.4": null,
  // 6 · Gestor de carreira dual acumula funções; ainda não há Sub-19.
  "6.2.1": 0, "6.5.2": 1, "6.6.1": null, "6.6.2": null,
  // 7 · O diretor não é profissional; o coordenador tem o Grau II.
  "7.1.3": null, "7.2.1.5": null, "7.2.1.6": 1, "7.2.1.7": 2, "7.2.2.3": 2,
  "7.3.3": null, "7.4.6": null,
  // 8 · Sem ginásio próprio.
  "8.4.2": null, "8.6.1": 0, "8.6.2": null,
  // 9 · Um clube pequeno: um júnior chegou aos seniores, nenhum à seleção nacional.
  "9.1.1": 0, "9.2.1": null, "9.3.2": null, "9.4.1": null, "9.5.1": 1, "9.6.1": 1,
};

/** Notas que a direção deixou em algumas respostas. */
const NOTAS = {
  "5.4.2.1": "O ficheiro clínico completo está no gabinete médico, em papel, organizado por escalão.",
  "1.2.1": "Candidatura da iniciativa \"Fair play nos Sub-11\" submetida a 15/09.",
  "7.2.1.6": "O Sérgio está a fazer o estágio do Grau III.",
};

/* -------------------------------------------------------------------------- */
/* O `montar` da API, com as respostas e os factos daqui                        */
/* -------------------------------------------------------------------------- */

const m = await carregarMotor();
const CATALOGO = m.FPF_F11M_2026;
const perfil = PERFIL;
const factos = factosDo(m.semAtletas);

const respostas = new Map();
for (const r of CATALOGO.requirements) {
  if (r.assessor || !m.aplicaSe(r, perfil)) continue;
  const temRegra = Boolean(m.REGRAS[r.code]);
  const pedida = Object.prototype.hasOwnProperty.call(RESPOSTAS, r.code) ? RESPOSTAS[r.code] : undefined;
  if (pedida === null) continue; // por responder
  // As questões com cálculo da plataforma ficam com o cálculo, salvo resposta pedida.
  if (temRegra && pedida === undefined) continue;
  const cheio = r.tiers ? r.tiers.length - 1 : 1;
  const [by, at] = POR_CRITERIO[r.criterion];
  respostas.set(r.code, { code: r.code, value: pedida ?? cheio, note: NOTAS[r.code] ?? null, answeredByName: by, updatedAt: at });
}

const calculos = new Map();
const valores = {};
for (const r of CATALOGO.requirements) {
  const calculo = m.REGRAS[r.code]?.(factos);
  if (calculo) calculos.set(r.code, calculo);
  valores[r.code] = respostas.get(r.code)?.value ?? calculo?.value;
}

const plantel = plantelDe(factos);
const acesso = m.acessoDe(plantel, perfil);
const avaliacao = m.avaliar(CATALOGO, valores, perfil, acesso);
const alvo = avaliacao.level < 5 ? avaliacao.level + 1 : null;
const caminho = alvo === null ? null : m.caminhoPara(alvo, avaliacao);
const bloqueiam = new Set(caminho?.mandatory.map((x) => x.requirement.code));

const ganho = (r) => m.pontosMaximos(r, perfil) - m.pontosGanhos(r, m.valorDe(r, valores), perfil);
const atalhos = CATALOGO.requirements
  .filter((r) => m.aplicaSe(r, perfil) && !r.assessor && !bloqueiam.has(r.code) && ganho(r) > 0)
  .sort((a, b) => ganho(b) - ganho(a))
  .slice(0, 8)
  .map((r) => ({ code: r.code, gain: ganho(r) }));

const porPatamar = (p) => ({
  total: CATALOGO.requirements.reduce(
    (n, r) => n + (m.aplicaSe(r, perfil) ? Number(r.mandatory === p) + (r.tiers?.filter((t) => t.mandatory === p).length ?? 0) : 0),
    0,
  ),
  missing: avaliacao.missing[p].length,
});

const resumo = {
  available: true,
  catalog: { key: CATALOGO.key, title: CATALOGO.title, manual: CATALOGO.manual, season: "2026/27" },
  canWrite: true,
  profile: perfil,
  profileSet: true,
  teams: EQUIPAS.map((t) => ({ id: t.id, name: t.name, maxAge: t.maxAge, athletes: t.athletes, gender: t.gender })),

  level: m.nivelDe(avaliacao.level),
  ceilings: m.tetos(avaliacao),
  points: { got: avaliacao.points, max: avaliacao.max, assessor: avaliacao.assessor, notApplicable: 100 - avaliacao.max },
  mandatory: { C: porPatamar("C"), E: porPatamar("E"), T: porPatamar("T"), Q: porPatamar("Q") },

  access: {
    squads: m.ESCALOES.map((e) => ({ age: e, athletes: plantel.squads[e] ?? 0, need: m.minimoDaEquipa(e), ok: (plantel.squads[e] ?? 0) >= m.minimoDaEquipa(e) })),
    senior: { ok: perfil.hasSenior, athletes: plantel.senior },
    women: { teams: plantel.womenTeams, players: plantel.womenPlayers, ok: plantel.womenTeams >= 1 || plantel.womenPlayers >= 20 },
    national: perfil.islands || perfil.nationalLast5,
    missing: m.faltaNoAcesso(plantel, perfil),
  },

  next: caminho && {
    target: m.nivelDe(caminho.target),
    accessOk: caminho.accessOk,
    mandatory: caminho.mandatory.map((x) => x.requirement.code),
    points: caminho.points,
    needPoints: caminho.needPoints,
  },
  quickWins: atalhos,

  criteria: CATALOGO.criteria.map((c) => ({
    ...c,
    got: avaliacao.byCriterion[c.criterion]?.got ?? 0,
    reach: avaliacao.byCriterion[c.criterion]?.max ?? 0,
    total: avaliacao.byCriterion[c.criterion]?.total ?? 0,
    missing: avaliacao.byCriterion[c.criterion]?.missing ?? 0,
    blocking: caminho?.mandatory.filter((x) => x.requirement.criterion === c.criterion).length ?? 0,
  })),
  groups: CATALOGO.groups,

  requirements: CATALOGO.requirements.map((r) => {
    const aplica = m.aplicaSe(r, perfil);
    const valor = m.valorDe(r, valores);
    const resposta = respostas.get(r.code);
    const calculo = calculos.get(r.code);
    return {
      code: r.code,
      criterion: r.criterion,
      group: r.group,
      text: r.text,
      mode: r.mode,
      source: r.source,
      evidence: r.evidence ?? null,
      note: r.note ?? null,
      condition: r.condition ?? null,
      mandatory: r.mandatory ?? r.tiers?.find((t) => t.mandatory)?.mandatory ?? null,
      tiers: r.tiers?.map((t, i) => ({ label: t.label, points: m.pontosDoNivel(r, i, perfil), mandatory: t.mandatory ?? null })) ?? null,
      points: aplica ? m.pontosMaximos(r, perfil) : (r.points ?? Math.max(...(r.tiers ?? []).map((t) => t.points))),
      earned: aplica ? m.pontosGanhos(r, valor, perfil) : 0,
      value: valor,
      status: estadoDe(r, valor, aplica),
      origin: !aplica || r.assessor ? "none" : resposta ? "answer" : calculo ? "auto" : "none",
      blocking: bloqueiam.has(r.code),
      levels: aplica ? patamaresDe(r, valor) : [],
      auto: calculo ?? null,
      answer: resposta ? { value: resposta.value, note: resposta.note, by: resposta.answeredByName, at: resposta.updatedAt } : null,
    };
  }),
};

writeFileSync(SAIDA, JSON.stringify(resumo, null, 1) + "\n");
console.log(
  `Certificação: ${resumo.level.short}, ${resumo.points.got} pontos (máx. ${resumo.points.max}), ` +
    `próximo ${resumo.next?.target.short ?? "nenhum"}: ${resumo.next?.mandatory.join(", ") || "sem obrigatórias"}, ` +
    `faltam ${resumo.next?.points ?? 0} pontos. Atalhos: ${atalhos.map((a) => `${a.code} +${a.gain}`).join(", ")}`,
);
console.log("Escrito em", SAIDA, `(agora da cena: ${AGORA})`);

/* ---- Puras, gémeas das do `certification.service.ts` ---------------------- */

function patamaresDe(r, valor) {
  if (r.tiers) return r.tiers.flatMap((t, i) => (t.mandatory ? [{ tier: t.mandatory, met: valor >= i }] : []));
  return r.mandatory ? [{ tier: r.mandatory, met: valor > 0 }] : [];
}

function estadoDe(r, valor, aplica) {
  if (!aplica) return "na";
  if (r.assessor) return "assessor";
  if (r.tiers) return valor < 0 ? "missing" : valor < r.tiers.length - 1 ? "partial" : "met";
  return valor > 0 ? "met" : "missing";
}

function plantelDe(f) {
  const squads = {};
  let senior = 0;
  let womenTeams = 0;
  for (const t of f.teams) {
    const e = m.escalaoDe(t.maxAge);
    if (e === null) continue;
    if (t.women) {
      if (t.athletes >= m.minimoDaEquipa(e)) womenTeams++;
    } else if (e === "senior") senior = Math.max(senior, t.athletes);
    else squads[e] = Math.max(squads[e] ?? 0, t.athletes);
  }
  return { squads, senior, womenTeams, womenPlayers: f.womenPlayers };
}
