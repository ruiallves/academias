/**
 * "Preço por atleta" para vários atletas de uma vez.
 *
 * Corre `BillingService.setAthleteFees` e `getAthleteFees` contra uma base
 * fingida em memória, sem servidor nem Postgres. Três atletas: um no basquete
 * e no futsal, um só no basquete, e um sem equipa. Prova que cada valor fica na
 * modalidade certa, que gravar outra vez actualiza em vez de duplicar, que um
 * valor vazio volta ao preço da equipa, e que o lote recusa o que não faz
 * sentido (modalidade que o atleta não pratica, valor sem modalidade, o mesmo
 * atleta duas vezes, valores fora das regras, quem não pode configurar).
 *
 * Uso: npm run test:precos-em-lote --workspace @academia/api
 */
import { BillingService } from "../src/billing/billing.service";

let ok = 0;
let falhas = 0;
function check(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) {
    ok++;
    console.log(`  ✓ ${nome}`);
  } else {
    falhas++;
    console.log(`  ✗ ${nome}`, detalhe ?? "");
  }
}

/* ------------------------------------------------------------ base fingida */

type Plano = { id: string; teamId: string | null; sportId: string | null; amountCents: number; isActive: boolean; name: string };
type Inscricao = { id: string; athleteId: string; planId: string; startsOn: Date; endsOn: Date | null; discountCents: number };

const atletas = [
  { id: "ana", name: "Ana" },
  { id: "rui", name: "Rui" },
  { id: "eva", name: "Eva" },
];
const equipas = [
  { teamId: "sub14", athleteId: "ana", sportId: "basq", sport: "Basquetebol", name: "Sub-14" },
  { teamId: "futsal", athleteId: "ana", sportId: "fut", sport: "Futsal", name: "Futsal Inf." },
  { teamId: "sub14", athleteId: "rui", sportId: "basq", sport: "Basquetebol", name: "Sub-14" },
];
const planos: Plano[] = [
  { id: "p-sub14", teamId: "sub14", sportId: null, amountCents: 2000, isActive: true, name: "Sub-14" },
  { id: "p-futsal", teamId: "futsal", sportId: null, amountCents: 1500, isActive: true, name: "Futsal" },
];
const inscricoes: Inscricao[] = [];
let seq = 0;

const ids = (w: unknown): string[] | null =>
  w == null ? null : typeof w === "string" ? [w] : ((w as { in?: string[] }).in ?? null);

function planoBate(p: Plano, w: Record<string, unknown> | undefined) {
  if (!w) return true;
  if ("teamId" in w && w.teamId === null && p.teamId !== null) return false;
  if ("isActive" in w && w.isActive !== p.isActive) return false;
  if ("sportId" in w && w.sportId !== p.sportId) return false;
  return true;
}

const vazio = new Proxy(
  {},
  {
    get: (_t, metodo) =>
      metodo === "findMany" ? async () => [] : metodo === "count" ? async () => 0 : metodo.toString().endsWith("Many") ? async () => ({ count: 0 }) : async () => null,
  },
);

const tabelas: Record<string, unknown> = {
  athlete: {
    findMany: async ({ where }: { where?: { id?: unknown } } = {}) => {
      const so = ids(where?.id);
      return atletas.filter((a) => !so || so.includes(a.id));
    },
  },
  teamMembership: {
    findMany: async ({ where }: { where: { athleteId: unknown } }) => {
      const so = ids(where.athleteId) ?? [];
      return equipas
        .filter((e) => so.includes(e.athleteId))
        .map((e) => ({
          athleteId: e.athleteId,
          teamId: e.teamId,
          team: { name: e.name, sportId: e.sportId, sport: { name: e.sport } },
        }));
    },
  },
  subscriptionPlan: {
    findMany: async ({ where }: { where: { teamId?: unknown } }) =>
      planos.filter((p) => p.isActive && (where.teamId ? p.teamId !== null : true)).sort((a, b) => b.id.localeCompare(a.id)),
    create: async ({ data }: { data: Omit<Plano, "id" | "isActive"> }) => {
      const p = { ...data, id: `plano-${++seq}`, isActive: true };
      planos.push(p);
      return p;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<Plano> }) => {
      const p = planos.find((x) => x.id === where.id)!;
      Object.assign(p, data);
      return p;
    },
  },
  enrollment: {
    findMany: async ({ where }: { where: { athleteId: unknown; plan?: Record<string, unknown> } }) => {
      const so = ids(where.athleteId) ?? [];
      return inscricoes
        .filter((e) => so.includes(e.athleteId))
        .map((e) => ({ ...e, plan: planos.find((p) => p.id === e.planId)! }))
        .filter((e) => planoBate(e.plan, where.plan))
        .sort((a, b) => b.startsOn.getTime() - a.startsOn.getTime() || b.id.localeCompare(a.id));
    },
    create: async ({ data }: { data: { athleteId: string; planId: string; startsOn: Date } }) => {
      const e = { ...data, id: `insc-${++seq}`, endsOn: null, discountCents: 0 };
      inscricoes.push(e);
      return e;
    },
    updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: { endsOn: Date } }) => {
      for (const e of inscricoes) if (where.id.in.includes(e.id)) e.endsOn = data.endsOn;
      return { count: where.id.in.length };
    },
  },
};
const db = new Proxy(tabelas, {
  get: (t, nome: string) => (nome in t ? t[nome] : nome.startsWith("$") ? async () => [] : vazio),
});

/* ----------------------------------------------------------------- serviço */

const servico = Object.create(BillingService.prototype) as BillingService;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(servico as any).prisma = { runAs: (_academia: string, fn: (d: unknown) => unknown) => fn(db) };

const dono = { academyId: "clube", userId: "u", role: "OWNER", grants: [], revokes: [] };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = dono as any;

/** O preço que vale hoje numa modalidade (o individual activo mais recente). */
const individual = (athleteId: string, sportId: string | null) => {
  const vivas = inscricoes
    .filter((e) => e.athleteId === athleteId && (e.endsOn === null || e.endsOn >= new Date()))
    .map((e) => planos.find((p) => p.id === e.planId)!)
    .filter((p) => p.teamId === null && p.sportId === sportId);
  return vivas.length ? vivas[vivas.length - 1].amountCents : null;
};

async function recusa(nome: string, fazer: () => Promise<unknown>, contem: string) {
  try {
    await fazer();
    check(nome, false, "não recusou");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    check(nome, msg.includes(contem), msg);
  }
}

/* ------------------------------------------------------------------ testes */

console.log("\nGravar em lote");
const r1 = await servico.setAthleteFees(
  ctx,
  [
    { athleteId: "ana", sportId: "basq", amountCents: 1500 },
    { athleteId: "ana", sportId: "fut", amountCents: 0 },
    { athleteId: "rui", sportId: "basq", amountCents: 1800 },
    { athleteId: "eva", amountCents: 2500 },
  ],
  "proximo",
);
check("diz quantos gravou e de quantos atletas", r1.guardados === 4 && r1.atletas === 3, r1);
check("Ana fica com 15 € no basquete", individual("ana", "basq") === 1500);
check("Ana fica isenta no futsal (0 €)", individual("ana", "fut") === 0);
check("Rui fica com 18 € no basquete", individual("rui", "basq") === 1800);
check("Eva, sem equipa, fica com o valor único de 25 €", individual("eva", null) === 2500);
check("com 'próximo mês' não emite nada agora", r1.criadas === 0);

console.log("\nGravar outra vez actualiza, não duplica");
const planosAntes = planos.length;
await servico.setAthleteFees(ctx, [{ athleteId: "rui", sportId: "basq", amountCents: 2200 }], "proximo");
check("o Rui passa a 22 €", individual("rui", "basq") === 2200);
check("não nasceu nenhum plano novo", planos.length === planosAntes, { antes: planosAntes, depois: planos.length });

console.log("\nO que a consola lê");
const lido = await servico.getAthleteFees(ctx);
const de = (id: string) => lido.atletas.find((a) => a.athleteId === id)!;
check("um registo por atleta do clube", lido.atletas.length === 3);
check("Ana paga a soma: 15 € + 0 €", de("ana").effectiveAmountCents === 1500, de("ana"));
check("Ana tem as duas modalidades", de("ana").modalidades.map((m) => m.sportId).sort().join() === "basq,fut");
check(
  "o basquete da Ana diz o preço da equipa e o dela",
  de("ana").modalidades.some((m) => m.sportId === "basq" && m.teamAmountCents === 2000 && m.individualAmountCents === 1500),
);
check("Eva vem com o valor único", de("eva").valorUnicoCents === 2500 && de("eva").modalidades.length === 0);

console.log("\nValor vazio volta ao preço da equipa");
await servico.setAthleteFees(ctx, [{ athleteId: "ana", sportId: "basq", amountCents: null }], "proximo");
check("Ana deixa de ter ajuste no basquete", individual("ana", "basq") === null);
check("o futsal dela fica como estava", individual("ana", "fut") === 0);
const depois = (await servico.getAthleteFees(ctx)).atletas.find((a) => a.athleteId === "ana")!;
check("Ana paga agora 20 € (equipa) + 0 €", depois.effectiveAmountCents === 2000, depois);

console.log("\nO que se recusa");
await recusa(
  "modalidade que o atleta não pratica",
  () => servico.setAthleteFees(ctx, [{ athleteId: "rui", sportId: "fut", amountCents: 1000 }], "proximo"),
  "não tem equipa nessa modalidade",
);
await recusa(
  "valor sem modalidade a quem tem equipa",
  () => servico.setAthleteFees(ctx, [{ athleteId: "rui", amountCents: 1000 }], "proximo"),
  "Falta a modalidade",
);
await recusa(
  "o mesmo atleta duas vezes na mesma modalidade",
  () =>
    servico.setAthleteFees(
      ctx,
      [
        { athleteId: "rui", sportId: "basq", amountCents: 1000 },
        { athleteId: "rui", sportId: "basq", amountCents: 1200 },
      ],
      "proximo",
    ),
  "duas vezes",
);
await recusa("lote vazio", () => servico.setAthleteFees(ctx, [], "proximo"), "Não há preços");
await recusa(
  "30 cêntimos (abaixo do mínimo)",
  () => servico.setAthleteFees(ctx, [{ athleteId: "rui", sportId: "basq", amountCents: 30 }], "proximo"),
  "",
);
await recusa(
  "atleta que não existe",
  () => servico.setAthleteFees(ctx, [{ athleteId: "ninguem", sportId: "basq", amountCents: 1000 }], "proximo"),
  "já não existe",
);
check("nada mudou com as recusas (Rui continua a 22 €)", individual("rui", "basq") === 2200);

const semPermissao = { ...dono, revokes: ["billing:write"] };
await recusa(
  "quem não pode configurar mensalidades não grava",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  () => servico.setAthleteFees(semPermissao as any, [{ athleteId: "rui", sportId: "basq", amountCents: 1000 }], "proximo"),
  "Sem permissão",
);
await recusa(
  "nem lê os preços de todos",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  () => servico.getAthleteFees(semPermissao as any),
  "Sem permissão",
);

console.log(`\n${ok} certos, ${falhas} errados\n`);
process.exit(falhas ? 1 : 0);
