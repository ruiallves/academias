/**
 * A certificação FPF: o manual transcrito, e o motor que decide o nível.
 *
 * O que este teste prova:
 *
 *  - o catálogo soma o que o manual diz: 100 pontos, 12 do avaliador, e o
 *    total de cada critério;
 *  - as obrigatórias por patamar são as contadas no manual;
 *  - o nível é o mais baixo dos três tetos — acesso, obrigatórias e pontos —,
 *    caso a caso pelo fluxograma da página 31;
 *  - os pontos que mudam com o perfil mudam como o manual escreve;
 *  - as regras que leem os dados do clube dizem o que os números dizem;
 *  - o serviço verdadeiro, sobre um clube de mentira (`certificacao-mundo.ts`):
 *    quem lê e quem escreve, a resposta do clube a ganhar ao cálculo, e o
 *    perfil a mudar o acesso.
 *
 * Nada aqui toca numa base de dados nem na rede.
 *
 * Uso: npm run test:certificacao
 */
import { FPF_F11M_2026 as CAT } from "../src/certification/catalogo-fpf-f11m-2026";
import {
  PERFIL_VAZIO,
  acessoDe,
  aplicaSe,
  avaliar,
  caminhoPara,
  escalaoDe,
  faltaNoAcesso,
  pontosMaximos,
  tetos,
  type Perfil,
  type Plantel,
  type Valores,
} from "../src/certification/motor";
import { REGRAS, semAtletas, type Factos } from "../src/certification/regras";
import { CLUBE, mundo, pessoa } from "./certificacao-mundo";

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
const perto = (a: number, b: number) => Math.abs(a - b) < 1e-9;

const TUDO: Perfil = { ...PERFIL_VAZIO, hasSenior: true, recruits: true, hasDre: true, nonNationals: true };
const maximo = (r: (typeof CAT.requirements)[number]) => (r.tiers ? Math.max(...r.tiers.map((t) => t.points)) : (r.points ?? 0));

/** Tudo cumprido ao mais alto nível. */
const pleno = (): Valores => Object.fromEntries(CAT.requirements.map((r) => [r.code, r.tiers ? r.tiers.length - 1 : 1]));

/** Cumpre as obrigatórias até um patamar, e mais nada. */
function ate(patamares: string[]): Valores {
  const v: Valores = {};
  for (const r of CAT.requirements) {
    if (r.tiers) {
      let i = -1;
      r.tiers.forEach((t, j) => {
        if (t.mandatory && patamares.includes(t.mandatory)) i = j;
      });
      if (i >= 0) v[r.code] = i;
    } else if (r.mandatory && patamares.includes(r.mandatory)) v[r.code] = 1;
  }
  return v;
}

console.log("\nO manual transcrito");
{
  const total = CAT.requirements.reduce((n, r) => n + maximo(r), 0);
  check("soma 100 pontos", perto(total, 100), String(total));
  const avaliador = CAT.requirements.filter((r) => r.assessor).reduce((n, r) => n + maximo(r), 0);
  check("12 são do avaliador", perto(avaliador, 12), String(avaliador));
  for (const c of CAT.criteria) {
    const soma = CAT.requirements.filter((r) => r.criterion === c.criterion).reduce((n, r) => n + maximo(r), 0);
    check(`critério ${c.criterion} soma ${c.max}`, perto(soma, c.max), String(soma));
  }
  const codigos = new Set(CAT.requirements.map((r) => r.code));
  check("nenhum código repetido", codigos.size === CAT.requirements.length);
  check("todos os grupos têm nome", CAT.requirements.every((r) => CAT.groups[r.group]));

  const conta = { C: 0, E: 0, T: 0, Q: 0 } as Record<string, number>;
  for (const r of CAT.requirements) {
    if (r.mandatory) conta[r.mandatory]++;
    for (const t of r.tiers ?? []) if (t.mandatory) conta[t.mandatory]++;
  }
  check("38 obrigatórias desde o CBFF", conta.C === 38, String(conta.C));
  check("mais 21 para as escolas", conta.E === 21, String(conta.E));
  check("mais 24 para as 3 estrelas", conta.T === 24, String(conta.T));
  check("mais 15 para as 4 e 5", conta.Q === 15, String(conta.Q));
  check("as 12 declarações não têm pontos e são todas obrigatórias", CAT.requirements.filter((r) => r.criterion === 0).every((r) => r.points === 0 && r.mandatory === "C"));
  check("os pontos do avaliador nunca são obrigatórios", CAT.requirements.filter((r) => r.assessor).every((r) => !r.mandatory));
}

console.log("\nOs escalões e o acesso");
{
  check("um Sub-12 conta como Infantis", escalaoDe(12) === 13);
  check("um Sub-7 é Petizes e um Sub-6 também", escalaoDe(7) === 7 && escalaoDe(6) === 7);
  check("sem limite de idade é sénior", escalaoDe(99) === "senior");
  check("um Sub-23 não conta para o acesso", escalaoDe(23) === null);

  const todos: Plantel = { squads: { 7: 9, 9: 14, 11: 24, 13: 24, 15: 21, 17: 19, 19: 18 }, senior: 24, womenTeams: 0, womenPlayers: 0 };
  const comSenior = { ...PERFIL_VAZIO, hasSenior: true };
  check("sénior e sete escalões dá acesso às 4 estrelas", acessoDe(todos, comSenior) === 4);
  check("sem sénior fica nas 3", acessoDe(todos, PERFIL_VAZIO) === 3);
  check("com equipa feminina e provas nacionais chega às 5", acessoDe({ ...todos, womenTeams: 1 }, { ...comSenior, nationalLast5: true }) === 5);
  check("20 praticantes femininas valem como equipa", acessoDe({ ...todos, womenPlayers: 20 }, { ...comSenior, nationalLast5: true }) === 5);
  check("19 não chegam", acessoDe({ ...todos, womenPlayers: 19 }, { ...comSenior, nationalLast5: true }) === 4);
  check("nas ilhas as provas nacionais não se pedem", acessoDe({ ...todos, womenTeams: 1 }, { ...comSenior, islands: true }) === 5);
  check("um Sub-13 com 10 atletas não é equipa", acessoDe({ ...todos, squads: { ...todos.squads, 13: 10 } }, comSenior) === 3);
  check("um Sub-11 com 7 é", acessoDe({ ...todos, squads: { ...todos.squads, 11: 7 } }, comSenior) === 4);

  const tres: Plantel = { squads: { 9: 10, 11: 12, 13: 15 }, senior: 0, womenTeams: 0, womenPlayers: 0 };
  check("três escalões dão acesso a escola", acessoDe(tres, PERFIL_VAZIO) === 1);
  check("em baixa densidade, três escalões dão as 3 estrelas", acessoDe(tres, { ...PERFIL_VAZIO, lowDensity: true }) === 3);
  check("dois escalões só dão CBFF", acessoDe({ ...tres, squads: { 9: 10, 11: 12 } }, PERFIL_VAZIO) === 0);
  check("em baixa densidade, dois dão escola", acessoDe({ ...tres, squads: { 9: 10, 11: 12 } }, { ...PERFIL_VAZIO, lowDensity: true }) === 1);

  check("com tudo, não falta nada no acesso", faltaNoAcesso({ ...todos, womenTeams: 1 }, { ...comSenior, nationalLast5: true }).length === 0);
  check("das 4 para as 5 faltam o feminino e as provas nacionais", faltaNoAcesso(todos, comSenior).length === 2);
  check("e a frase diz quantas praticantes a plataforma conta", faltaNoAcesso({ ...todos, womenPlayers: 6 }, comSenior)[0].includes("conta 6"));
  check("das 3 para as 4 falta a equipa sénior", faltaNoAcesso(todos, PERFIL_VAZIO).some((f) => f.includes("sénior")));
}

console.log("\nO nível é o mais baixo dos três tetos");
{
  const cheio = avaliar(CAT, pleno(), TUDO, 5);
  check("tudo cumprido, com acesso às 5: 5 estrelas e 100 pontos", cheio.level === 5 && perto(cheio.points, 100) && perto(cheio.max, 100));
  check("o mesmo com acesso às 4 fica nas 4", avaliar(CAT, pleno(), TUDO, 4).level === 4);
  check("com acesso às 3 fica nas 3", avaliar(CAT, pleno(), TUDO, 3).level === 3);
  check("com acesso a escola fica nas 2", avaliar(CAT, pleno(), TUDO, 1).level === 2);
  check("sem acesso nenhum é CBFF", avaliar(CAT, pleno(), TUDO, 0).level === 0);

  const semUma = { ...pleno(), "5.2.4": 0 };
  const a = avaliar(CAT, semUma, TUDO, 5);
  check("uma obrigatória das 4 e 5 em falta desce para as 3, com 99,75 pontos", a.level === 3 && perto(a.points, 99.75));
  check("e os tetos dizem que é ela que trava", tetos(a).mandatory === 3 && tetos(a).points === 5 && tetos(a).access === 5);

  const semDeclaracao = { ...pleno(), D12: 0 };
  check("uma declaração por assinar tira a certificação toda", avaliar(CAT, semDeclaracao, TUDO, 5).level === -1);

  const cbff = avaliar(CAT, ate(["C"]), TUDO, 5);
  check("só as do CBFF: reconhecido como CBFF", cbff.level === 0 && cbff.mandatory === 1);
  const escola = avaliar(CAT, ate(["C", "E"]), TUDO, 5);
  check("até às escolas, com poucos pontos: 1 estrela", escola.level === 1 && escola.points < 50, String(escola.points));
  const tres = avaliar(CAT, ate(["C", "E", "T"]), TUDO, 5);
  check("até às 3 estrelas mas abaixo dos 50 pontos: desce para escola de 2", tres.points < 50 && tres.level === 2, String(tres.points));
  check("e o teto dos pontos diz 2", tetos(tres).points === 2);

  const caminho = caminhoPara(3, escola);
  check("o caminho para as 3 estrelas lista as 24 obrigatórias em falta", caminho.mandatory.length === 24, String(caminho.mandatory.length));
  check("e os pontos que faltam para os 50", perto(caminho.points, 50 - escola.points));
  check("o caminho das 4 não repete um requisito com dois patamares em falta", new Set(caminhoPara(4, escola).mandatory.map((m) => m.requirement.code)).size === caminhoPara(4, escola).mandatory.length);
}

console.log("\nOs pontos que mudam com o perfil");
{
  const r = (code: string) => CAT.requirements.find((x) => x.code === code)!;
  const semDre = { ...TUDO, hasDre: false };
  check("sem D.R.E., as normas escolares do manual valem 1", pontosMaximos(r("2.2.3.3"), semDre) === 1 && pontosMaximos(r("2.2.3.3"), TUDO) === 0.5);
  check("e o gestor de carreira dual exclusivo vale 1,5", pontosMaximos(r("6.2.1"), semDre) === 1.5 && pontosMaximos(r("6.2.1"), TUDO) === 0.5);
  check("as questões de D.R.E. deixam de se aplicar", !aplicaSe(r("8.7.1"), semDre) && !aplicaSe(r("6.3.1"), semDre));
  const semRec = { ...TUDO, recruits: false };
  check("sem recrutamento, a política vale 2 e a angariação 4", pontosMaximos(r("3.2.1.1"), semRec) === 2 && pontosMaximos(r("3.2.3.1"), semRec) === 4);
  check("e o critério 3 continua a somar 12 sem não-nacionais", perto(avaliar(CAT, pleno(), { ...semRec, nonNationals: false }, 5).byCriterion[3].max, 12));
  check("sem sénior, as reuniões da formação valem 1", pontosMaximos(r("4.3.2.1"), { ...TUDO, hasSenior: false }) === 1);

  const pequeno = avaliar(CAT, pleno(), { ...PERFIL_VAZIO, hasSenior: true, recruits: true }, 4);
  check("sem D.R.E. nem não-nacionais ficam 2,75 pontos fora do alcance", perto(100 - pequeno.max, 2.75), String(100 - pequeno.max));
  check("e uma obrigatória que não se aplica não trava ninguém", pequeno.mandatory === 4 && pequeno.level === 4);
}

console.log("\nAs regras que leem os dados do clube");
{
  const equipa = (name: string, maxAge: number, mais: Partial<Factos["teams"][number]> = {}) => ({
    id: name, name, maxAge, women: false, athletes: 16, sessions: 20, sessionsWithBlocks: 18, mesos: 2, micros: 8, microsWithObjective: 6, ...mais,
  });
  const base: Factos = {
    teams: [equipa("Sub-11", 11), equipa("Sub-13", 13), equipa("Sub-15", 15), equipa("Seniores", 99)],
    athletesByAge: { ...semAtletas(), 11: 30, 13: 20, 15: 18, 17: 16, 19: 14 },
    formationAthletes: 98,
    coaches: 3,
    womenPlayers: 0,
    recentSessions: 30, recentSessionsPlanned: 27,
    plannedSessions: 54, plannedSessionsWithMaterial: 50,
    matchesPlayed: 10, matchesWithCallUp: 10, matchesWithReport: 9,
    athletesEvaluated: 90, clinicalEntries: 12, athletesWithValidExam: 95, nutritionAgeGroups: 2, athletesWithGrades: 80,
    prospects: 14, observations: 30,
  };
  const de = (code: string, f: Factos = base) => REGRAS[code](f);

  check("todas as regras são de requisitos que existem", Object.keys(REGRAS).every((c) => CAT.requirements.some((r) => r.code === c)));
  check("e nenhuma é de pontos do avaliador", Object.keys(REGRAS).every((c) => !CAT.requirements.find((r) => r.code === c)!.assessor));

  check("a pirâmide: 30 nos mais novos contra 38 a seguir falha", de("3.4.1").value === 0);
  check("38 em Infantis e Iniciados contra 16 em Juvenis passa", de("3.4.2").value === 1);
  check("16 Juvenis contra 14 Juniores passa", de("3.4.3").value === 1);
  check("empate não é pirâmide", de("3.4.3", { ...base, athletesByAge: { ...base.athletesByAge, 17: 14 } }).value === 0);

  check("o Scouting com prospects e observações é aplicação de recrutamento", de("3.2.2.5").value === 1);
  check("sem observações nesta época, não é nada", de("3.2.2.5", { ...base, observations: 0 }).value === -1);

  check("todas as equipas de formação planeiam: dossier padronizado", de("4.2.1").value === 1);
  const umaSemPlano = { ...base, teams: [equipa("Sub-11", 11, { sessionsWithBlocks: 0 }), ...base.teams.slice(1)] };
  check("uma equipa sem planos chega para falhar", de("4.2.1", umaSemPlano).value === 0);
  check("e a frase diz qual", de("4.2.1", umaSemPlano).detail.includes("Sub-11"));
  check("os seniores não entram na conta da formação", de("4.2.1", { ...base, teams: [...base.teams.slice(0, 3), equipa("Seniores", 99, { sessionsWithBlocks: 0 })] }).value === 1);
  check("nem as equipas femininas", de("4.2.1", { ...base, teams: [...base.teams, equipa("Sub-15 F", 15, { women: true, sessionsWithBlocks: 0 })] }).value === 1);
  check("sem equipas de formação não se cumpre por omissão", de("4.2.6", { ...base, teams: [] }).value === 0);

  check("27 de 30 treinos recentes com plano chega", de("4.2.3").value === 1);
  check("20 de 30 não chega", de("4.2.3", { ...base, recentSessionsPlanned: 20 }).value === 0);
  check("sem treinos recentes não se cumpre por omissão", de("4.2.3", { ...base, recentSessions: 0, recentSessionsPlanned: 0 }).value === 0);
  check("jogos: conta o menor entre convocatórias e relatórios", de("4.2.8").progress?.got === 9 && de("4.2.8").value === 1);

  check("o boletim clínico com registos é o patamar das escolas, nunca o de cima", de("5.4.2.1").value === 0);
  check("95 de 98 exames válidos chega aos 90%", de("5.4.3.1").value === 1);
  check("80 de 98 não", de("5.4.3.1", { ...base, athletesWithValidExam: 80 }).value === 0);
  check("nutrição num escalão só não chega", de("5.4.3.4", { ...base, nutritionAgeGroups: 1 }).value === 0);

  check("3 treinadores para 3 equipas: 1 por equipa", de("7.2.2.4").value === 1);
  check("2 para 3 chega ao patamar das 4 estrelas", de("7.2.2.4", { ...base, coaches: 2 }).value === 0);
  check("1 para 3 não chega a nenhum", de("7.2.2.4", { ...base, coaches: 1 }).value === -1);
  check("6 para 3 são 2 por equipa, e 7 já são mais de 2", de("7.2.2.4", { ...base, coaches: 6 }).value === 2 && de("7.2.2.4", { ...base, coaches: 7 }).value === 3);
}

type Linha = Record<string, any>;
const estadoDe = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e) {
    return (e as { getStatus?: () => number }).getStatus?.() ?? 500;
  }
};
const requisito = (resumo: Linha, code: string): Linha => resumo.requirements.find((x: Linha) => x.code === code);
const direcao = pessoa("DIRECTOR");
const coordenador = pessoa("COORDINATOR");
const treinador = pessoa("COACH");

console.log("\nQuem lê e quem escreve");
{
  const m = mundo();
  const r = (await m.servico.resumo(direcao)) as Linha;
  check("a direção lê a certificação", r.available === true && r.requirements.length === CAT.requirements.length);
  check("e pode escrever", r.canWrite === true);
  const c = (await m.servico.resumo(coordenador)) as Linha;
  check("o coordenador lê e não escreve", c.available === true && c.canWrite === false);
  check("responder é recusado ao coordenador", (await estadoDe(m.servico.responder(coordenador, "1.1.1", { value: 1 }))) === 403);
  check("e o perfil também", (await estadoDe(m.servico.guardarPerfil(coordenador, r.profile))) === 403);
  check("um treinador nem lê", (await estadoDe(m.servico.resumo(treinador))) === 403);
  check("a quem a direção tirou a leitura, também não", (await estadoDe(m.servico.resumo(pessoa("DIRECTOR", [], ["certification:read"])))) === 403);
  check("nada disto criou uma candidatura", m.estado.processo === null);

  const natacao = mundo({ ...CLUBE, modalidades: [{ id: "n", name: "Natação", code: null }] });
  const semFutebol = (await natacao.servico.resumo(direcao)) as Linha;
  check("um clube sem futebol não tem candidatura", semFutebol.available === false && typeof semFutebol.reason === "string");
  const peloNome = mundo({ ...CLUBE, modalidades: [{ id: "futebol", name: "Futebol 11", code: null }] });
  check("o futebol reconhece-se pelo nome, sem código gravado", ((await peloNome.servico.resumo(direcao)) as Linha).available === true);
}

console.log("\nO que sai do clube de mentira");
{
  const m = mundo();
  const r = (await m.servico.resumo(direcao)) as Linha;

  check("sem perfil confirmado propõe-se o que os dados dizem: há equipa sénior", r.profileSet === false && r.profile.hasSenior === true && r.profile.recruits === false);
  check("sénior e sete escalões: o acesso chega às 4 estrelas", r.ceilings.access === 4);
  check("os sete escalões têm equipa", r.access.squads.length === 7 && r.access.squads.every((s: Linha) => s.ok));
  check("sem declarações assinadas não há certificação nenhuma", r.level.id === -1 && r.ceilings.mandatory === -1);
  check("e o caminho aponta para o CBFF", r.next.target.id === 0 && r.next.mandatory.length > 0);

  check("o dossier padronizado sai calculado e cumprido", requisito(r, "4.2.1").origin === "auto" && requisito(r, "4.2.1").status === "met");
  check("uma equipa sem ciclos chega para falhar o planeamento", requisito(r, "4.2.6").status === "missing" && requisito(r, "4.2.6").auto.detail.includes("Juvenis"));
  check("e por ser obrigatório só das 3 estrelas não trava o CBFF", requisito(r, "4.2.6").blocking === false);
  check("9 treinadores para 7 equipas: a feminina não entra na conta do masculino", requisito(r, "7.2.2.4").value === 1 && requisito(r, "7.2.2.4").auto.detail.includes("7 equipas"), requisito(r, "7.2.2.4").auto.detail);
  check("a equipa feminina é reconhecida sem ninguém a marcar", r.access.women.teams === 1 && r.access.women.ok === true);
  check("e as 13 atletas dela contam como praticantes femininas", r.access.women.players === 13, String(r.access.women.players));
  check("as questões de D.R.E. não se aplicam", requisito(r, "8.7.1").status === "na" && requisito(r, "8.7.1").earned === 0);
  check("os pontos do avaliador não têm origem", requisito(r, "4.4.2").status === "assessor" && requisito(r, "4.4.2").origin === "none");
  check("um requisito sem regra nem resposta está em falta", requisito(r, "1.1.1").status === "missing" && requisito(r, "1.1.1").origin === "none");
  // Sem recrutamento, os pontos dos não-nacionais têm destino no manual; os do
  // alojamento e da nutrição de D.R.E. não têm, e são esses 2 que ficam de fora.
  check("sem D.R.E. nem recrutamento ficam 2 pontos fora do alcance", perto(r.points.notApplicable, 2), String(r.points.notApplicable));
  check("os pontos somam o que cada requisito ganhou", perto(r.points.got, r.requirements.reduce((n: number, x: Linha) => n + x.earned, 0)));
  check("os atalhos vêm por ordem de ganho", r.quickWins.length === 8 && r.quickWins.every((w: Linha, i: number) => i === 0 || r.quickWins[i - 1].gain >= w.gain));
}

console.log("\nA resposta do clube ganha ao cálculo");
{
  const m = mundo();
  const antes = (await m.servico.resumo(direcao)) as Linha;
  const r = (await m.servico.responder(direcao, "1.1.1", { value: 1 })) as Linha;
  check("responder cria a candidatura, com o perfil proposto", m.estado.processo !== null && m.estado.processo.profile.hasSenior === true);
  check("e devolve o resumo já recalculado: mais 3 pontos", perto(r.points.got - antes.points.got, 3), String(r.points.got - antes.points.got));
  check("fica registado quem respondeu", requisito(r, "1.1.1").origin === "answer" && requisito(r, "1.1.1").answer.by === "Diretora Teste");

  const porCima = (await m.servico.responder(direcao, "4.2.6", { value: 1 })) as Linha;
  check("uma resposta por cima do cálculo passa a valer", requisito(porCima, "4.2.6").status === "met" && requisito(porCima, "4.2.6").origin === "answer");
  check("e o cálculo continua à vista", requisito(porCima, "4.2.6").auto.value === 0);
  const devolvido = (await m.servico.apagarResposta(direcao, "4.2.6")) as Linha;
  check("apagar a resposta devolve o requisito ao cálculo", requisito(devolvido, "4.2.6").status === "missing" && requisito(devolvido, "4.2.6").origin === "auto");

  await m.servico.responder(direcao, "5.2.1", { value: 2 });
  await m.servico.responder(direcao, "5.2.1", { value: 3 });
  check("responder duas vezes corrige, não duplica", m.estado.respostas.filter((a) => a.code === "5.2.1").length === 1 && m.estado.respostas.find((a) => a.code === "5.2.1")!.value === 3);
  check("um requisito que não existe dá 404", (await estadoDe(m.servico.responder(direcao, "9.9.9", { value: 1 }))) === 404);
  check("os pontos do avaliador não se respondem", (await estadoDe(m.servico.responder(direcao, "4.4.2", { value: 1 }))) === 400);
  check("um patamar que não existe é recusado", (await estadoDe(m.servico.responder(direcao, "5.2.1", { value: 9 }))) === 400);
  check("num requisito de sim ou não, -1 é recusado", (await estadoDe(m.servico.responder(direcao, "1.1.1", { value: -1 }))) === 400);

  for (const q of CAT.requirements) if (q.criterion === 0) await m.servico.responder(direcao, q.code, { value: 1 });
  const comDeclaracoes = (await m.servico.resumo(direcao)) as Linha;
  check("só as declarações não chegam: faltam as outras obrigatórias do CBFF", comDeclaracoes.level.id === -1 && comDeclaracoes.mandatory.C.missing > 0);
}

console.log("\nO perfil muda o acesso e as questões");
{
  const m = mundo();
  const antes = (await m.servico.resumo(direcao)) as Linha;
  const r = (await m.servico.guardarPerfil(direcao, { ...antes.profile, nationalLast5: true, hasDre: true })) as Linha;
  check("o perfil fica confirmado", r.profileSet === true);
  check("com equipa feminina e provas nacionais o acesso chega às 5", r.ceilings.access === 5 && r.access.women.ok === true);
  m.estado.processo!.profile = { ...m.estado.processo!.profile, womenTeamIds: ["x"], womenPlayers: 40 };
  const antigo = (await m.servico.resumo(direcao)) as Linha;
  check("um perfil antigo, com o feminino marcado à mão, lê-se sem partir e ignora-o", antigo.profile.womenTeamIds === undefined && antigo.access.women.players === 13);
  check("com D.R.E. as questões de alojamento passam a contar", requisito(r, "8.7.1").status === "missing");
  check("e as obrigatórias do CBFF passam a ser mais", r.mandatory.C.total > antes.mandatory.C.total, `${antes.mandatory.C.total} → ${r.mandatory.C.total}`);
}

console.log("\nO futebol feminino sai dos dados, não de uma pergunta");
{
  const semFeminina = CLUBE.equipas.filter((t) => t.id !== "f15");
  const sem = (await mundo({ ...CLUBE, equipas: semFeminina }).servico.resumo(direcao)) as Linha;
  check("sem equipa feminina nem atletas marcadas, não há futebol feminino", sem.access.women.teams === 0 && sem.access.women.players === 0 && sem.access.women.ok === false);

  const comRaparigas = semFeminina.map((t) => (t.id === "s11" ? { ...t, raparigas: 12 } : t.id === "s13" ? { ...t, raparigas: 8 } : t));
  const vinte = (await mundo({ ...CLUBE, equipas: comRaparigas }).servico.resumo(direcao)) as Linha;
  check("20 raparigas em equipas mistas valem como uma equipa", vinte.access.women.players === 20 && vinte.access.women.ok === true);
  check("e essas equipas continuam a contar no masculino", vinte.access.squads.every((s: Linha) => s.ok));

  const naSenior = semFeminina.map((t) => (t.id === "sen" ? { ...t, raparigas: 24 } : t));
  const senior = (await mundo({ ...CLUBE, equipas: naSenior }).servico.resumo(direcao)) as Linha;
  check("as seniores não contam: o manual pede praticantes da formação", senior.access.women.players === 0);

  const pequena = CLUBE.equipas.map((t) => (t.id === "f15" ? { ...t, atletas: 9 } : t));
  const nove = (await mundo({ ...CLUBE, equipas: pequena }).servico.resumo(direcao)) as Linha;
  check("uma equipa feminina de Sub-15 com 9 atletas não é equipa", nove.access.women.teams === 0 && nove.access.women.players === 9 && nove.access.women.ok === false);
}

console.log("\nOs patamares de cada requisito");
{
  const m = mundo();
  await m.servico.responder(direcao, "5.2.1", { value: 2 });
  const r = (await m.servico.resumo(direcao)) as Linha;
  const clinica = requisito(r, "5.2.1").levels as Linha[];
  check("a coordenação clínica é obrigatória em quatro patamares", clinica.map((l) => l.tier).join("") === "CETQ");
  check("com um médico cumpre até às 3 estrelas e falha as 4", clinica.map((l) => (l.met ? "s" : "n")).join("") === "sssn");
  check("um requisito simples tem um patamar só", requisito(r, "1.1.1").levels.length === 1 && requisito(r, "1.1.1").levels[0].tier === "E");
  check("um requisito que não é obrigatório não tem nenhum", requisito(r, "2.1.1").levels.length === 0);
  check("nem um que não se aplica ao clube", requisito(r, "8.7.1").levels.length === 0);
}

console.log(`\n${ok} verificações certas, ${bad} falhadas.`);
process.exit(bad ? 1 : 0);
