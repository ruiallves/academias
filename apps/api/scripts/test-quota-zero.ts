/**
 * Uma quota de sócio de 0 € nasce paga.
 *
 * Corre a geração das quotas do mês (`gerarQuotas`) contra uma base fingida,
 * sem servidor nem Postgres, com três sócios: um de categoria mensal a 0 €, um
 * a 5 € e um de categoria anual a 0 €. Prova que as de 0 € ficam pagas e
 * carimbadas como avisadas (a passagem de avisos não lhes pega), e que a de
 * 5 € fica por pagar, como sempre.
 *
 * Uso: npm run test:quota-zero --workspace @academia/api
 */
import { gerarQuotas } from "../src/members/member-fees.service";
import { nasceIsenta } from "../src/billing/minimos";

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

const criadas: Record<string, unknown>[] = [];
const socios = [
  { id: "zero", annualStartDay: null, annualStartMonth: null, tier: { feeCents: 0, billing: "MONTHLY" } },
  { id: "cinco", annualStartDay: null, annualStartMonth: null, tier: { feeCents: 500, billing: "MONTHLY" } },
  { id: "anual-zero", annualStartDay: 1, annualStartMonth: 8, tier: { feeCents: 0, billing: "ANNUAL" } },
];
const db = {
  member: { findMany: async () => socios },
  academy: { findFirst: async () => ({ memberAnnualStartMonth: 8, memberAnnualStartDay: 1 }) },
  memberFee: {
    findMany: async () => [],
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      criadas.push(...data);
      return { count: data.length };
    },
  },
  memberFeeSkip: { findMany: async () => [] },
};

console.log("\nQuotas de 0 €");
const agora = new Date("2026-11-01T10:00:00Z");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const r = await gerarQuotas(db as any, "clube", "2026-11", agora);
const de = (id: string) => criadas.find((c) => c.memberId === id);

check("criou as três", r.criadas === 3, r);
check("0 € mensal nasce paga", de("zero")?.status === "SETTLED");
check("0 € mensal fica com a data em que nasceu", (de("zero")?.settledAt as Date)?.getTime() === agora.getTime());
check("0 € mensal fica carimbada como avisada", (de("zero")?.noticedAt as Date)?.getTime() === agora.getTime());
check("0 € anual nasce paga", de("anual-zero")?.status === "SETTLED");
check("0 € anual fica carimbada como avisada", Boolean(de("anual-zero")?.noticedAt));
check("5 € fica por pagar (sem estado = OPEN)", de("cinco")?.status === undefined && de("cinco")?.settledAt === undefined);
check("5 € tem o valor da categoria", de("cinco")?.amountCents === 500);
check("a regra é 0 € e só 0 €", nasceIsenta(0) && !nasceIsenta(50) && !nasceIsenta(1));

console.log(`\n${ok} certos, ${falhas} errados\n`);
process.exit(falhas ? 1 : 0);
