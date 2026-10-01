/**
 * Pagamentos desligados, e a comissão por conta de quem paga.
 *
 * ## O que este teste prova
 *
 * Duas decisões do clube que mexem em dinheiro, e por isso provadas a tentar o
 * abuso e não a ler o código:
 *
 *  1. **Pagamentos desligados** — o `BillingService` verdadeiro recusa iniciar
 *     um pagamento (de mensalidade e de quota) e, mais importante, **não chega
 *     a falar com a euPago** nem a escrever nada. Esconder o botão na app não
 *     impede ninguém de chamar o endpoint à mão; a prova é chamar.
 *  2. **Comissão de quem paga** — o que segue para a euPago é o valor que deixa
 *     ao clube o preço inteiro; uma referência antiga com o valor antigo não se
 *     reaproveita; e um aviso de pagamento pelo valor **sem** a taxa não liquida
 *     a mensalidade.
 *
 * Corre o serviço verdadeiro contra uma base de mentira e uma euPago de
 * mentira que só toma nota do que lhe pedem. **Sem base de dados, sem rede, sem
 * chave**: nada aqui consegue criar uma referência a sério.
 *
 * Uso: npm run test:taxa-do-pagador
 */
import { BillingService } from "../src/billing/billing.service";
import { liquidoDe } from "../src/billing/eupago-fees";
import {
  brutoParaLiquido,
  cotacao,
  PAGAMENTOS_DESATIVADOS,
  valorACobrar,
  valoresDaCotacao,
  type TabelaDeTaxas,
} from "../src/billing/taxa-do-pagador";

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

/* -------------------------------------------------------------------------- */
/* 1. A conta                                                                  */
/* -------------------------------------------------------------------------- */

const TABELA: TabelaDeTaxas = {
  vatPercent: 23,
  methods: [
    { method: "MBWAY", label: "MB Way", fixedCents: 7, percent: 0.7, offered: true },
    { method: "MULTIBANCO", label: "Multibanco", fixedCents: 20, percent: 1.5, offered: true },
    { method: "DIRECT_DEBIT", label: "Débito directo", fixedCents: 45, percent: 0, offered: true },
    { method: "PAYSAFECARD", label: "PaySafeCard", fixedCents: 0, percent: 12, offered: false },
  ],
};

console.log("\nA conta: o clube recebe o valor inteiro, e ninguém paga taxa a mais");
{
  let curtos = 0;
  let largos = 0;
  let casos = 0;
  let primeiro = "";
  for (const taxa of TABELA.methods) {
    for (let v = 50; v <= 100_000; v += v < 5000 ? 1 : 37) {
      casos++;
      const bruto = brutoParaLiquido(v, taxa, TABELA.vatPercent);
      // `liquidoDe` é a função que já existia e que diz o que o clube recebe.
      if (liquidoDe(bruto, taxa, TABELA.vatPercent).netCents < v) {
        curtos++;
        primeiro ||= `${taxa.method} ${v}: cobra ${bruto}`;
      }
      if (bruto > v && liquidoDe(bruto - 1, taxa, TABELA.vatPercent).netCents >= v) largos++;
    }
  }
  check(`em ${casos} casos, ao clube chega sempre pelo menos o valor dele`, curtos === 0, primeiro);
  check("e um cêntimo a menos já não chegava (não se cobra taxa a mais)", largos === 0, `${largos} casos`);

  const mb = valorACobrar(2000, "MBWAY", { feesOnPayer: true }, TABELA);
  check("20,00 € por MB Way cobram-se 20,27 €", mb.totalCents === 2027 && mb.surchargeCents === 27, JSON.stringify(mb));
  const ingenuo = 2000 + liquidoDe(2000, TABELA.methods[0], 23).feeCents;
  check(
    "somar a comissão de 20 € aos 20 € deixava o clube com menos",
    liquidoDe(ingenuo, TABELA.methods[0], 23).netCents < 2000 || ingenuo === mb.totalCents,
  );

  const sem = valorACobrar(2000, "MBWAY", { feesOnPayer: false }, TABELA);
  check("sem a opção ligada cobra-se o valor e mais nada", sem.totalCents === 2000 && sem.surchargeCents === 0);

  let recusou = false;
  try {
    valorACobrar(2000, "BITCOIN", { feesOnPayer: true }, TABELA);
  } catch {
    recusou = true;
  }
  check("um método sem taxa conhecida recusa-se, não se adivinha", recusou);

  recusou = false;
  try {
    brutoParaLiquido(2000, { method: "X", label: "X", fixedCents: 0, percent: 90, offered: true }, 23);
  } catch {
    recusou = true;
  }
  check("uma comissão que come tudo recusa-se em vez de dar um número absurdo", recusou);
}

console.log("\nA cotação que as apps mostram");
{
  const regras = { paymentsEnabled: true, feesOnPayer: true };
  const tres = cotacao([2000, 2000, 2000], regras, TABELA).find((m) => m.method === "MBWAY")!;
  const um = cotacao([6000], regras, TABELA).find((m) => m.method === "MBWAY")!;
  check("três mensalidades são três comissões", tres.surchargeCents === 3 * 27, String(tres.surchargeCents));
  check("e isso é mais do que a comissão de um pagamento só", tres.surchargeCents > um.surchargeCents);
  check("só entram os métodos que se oferecem", !cotacao([2000], regras, TABELA).some((m) => m.method === "PAYSAFECARD"));
  const semTaxa = cotacao([2000], { paymentsEnabled: true, feesOnPayer: false }, TABELA);
  check("sem a opção, a cotação não tem taxa nenhuma", semTaxa.every((m) => m.surchargeCents === 0 && m.totalCents === 2000));
  check(
    "os valores do endereço só entram se forem inteiros positivos",
    JSON.stringify(valoresDaCotacao("2000, -5,abc,2500.5,0,1500")) === "[2000,1500]",
    JSON.stringify(valoresDaCotacao("2000, -5,abc,2500.5,0,1500")),
  );
  check("e no máximo 24 de cada vez", valoresDaCotacao(Array(60).fill("100").join(",")).length === 24);
}

/* -------------------------------------------------------------------------- */
/* 2. O serviço verdadeiro, contra uma base e uma euPago de mentira            */
/* -------------------------------------------------------------------------- */

type Pagamento = Record<string, any>;

function mundo(regras: { paymentsEnabled: boolean; feesOnPayer: boolean }) {
  const estado = {
    regras: { ...regras },
    charge: { id: "c1", athleteId: "a1", amountCents: 2000, status: "OPEN", kind: "MONTHLY", period: "2026-10", athlete: { name: "Ana Teste" } },
    fee: { id: "f1", memberId: "m1", amountCents: 500, status: "OPEN", period: "2026-10", label: null, member: { name: "Sócio Teste", email: "s@x.pt", userId: null } },
    pagamentos: [] as Pagamento[],
    pedidos: [] as { metodo: string; amountCents: number }[],
    escritas: 0,
  };

  let seq = 0;
  const db = {
    charge: {
      findFirst: async () => ({ ...estado.charge, payments: estado.pagamentos.filter((p) => p.chargeId === "c1") }),
      update: async () => {
        estado.escritas++;
        return estado.charge;
      },
    },
    academy: {
      findFirst: async () => ({ id: "ac1", slug: "teste", shortName: "Teste", eupagoApiKey: null, ...estado.regras }),
    },
    membership: { findFirst: async () => ({ user: { name: "Mãe Teste", email: "m@x.pt" } }) },
    guardianLink: { findFirst: async () => ({ relation: "Mãe" }) },
    user: { findFirst: async () => null },
    memberFee: {
      findMany: async () => [{ ...estado.fee, payments: [] }],
    },
    payment: {
      create: async ({ data }: { data: Pagamento }) => {
        estado.escritas++;
        const { memberFees, ...resto } = data;
        const p = { id: "p" + ++seq, createdAt: new Date(), expiresAt: null, provider: "eupago", ...resto, memberFees: memberFees?.create ?? [] };
        estado.pagamentos.push(p);
        return p;
      },
      update: async ({ where, data }: { where: { id: string }; data: Pagamento }) => {
        estado.escritas++;
        const p = estado.pagamentos.find((x) => x.id === where.id)!;
        Object.assign(p, data);
        return p;
      },
      findMany: async () =>
        estado.pagamentos.filter((p) => p.memberFeeId && (p.status === "PENDING" || p.status === "PROCESSING")),
      findFirst: async ({ where }: { where: { id?: string; OR?: { id?: string }[] } }) => {
        const id = where.id ?? where.OR?.find((o) => o.id)?.id;
        const p = estado.pagamentos.find((x) => x.id === id);
        return p ? { ...p, charge: null, memberFee: null, memberFees: [] } : null;
      },
    },
  };

  const prisma = {
    runAs: async (_academyId: string, work: (d: typeof db) => Promise<unknown>) => work(db),
    resolvePaymentAcademy: async () => "ac1",
  };
  const pedir = (metodo: string) => async (req: { amountCents: number; reference: string }) => {
    estado.pedidos.push({ metodo, amountCents: req.amountCents });
    return { providerRef: "ref-" + req.reference, entity: "12345", reference: "123456789" };
  };
  const eupago = { createMbWayCharge: pedir("MBWAY"), createMultibancoCharge: pedir("MULTIBANCO") };
  const config = { get: () => undefined };
  const fees = { tabela: () => ({ ...TABELA, source: "teste" }) };

  const servico = new BillingService(prisma as never, eupago as never, {} as never, config as never, fees as never);
  const ctx = {
    userId: "u1", academyId: "ac1", membershipId: "ms1", role: "GUARDIAN",
    grants: ["billing:read"], revokes: [], rolePermissions: null, roleId: null, roleName: null,
    scope: { athleteIds: ["a1"] },
  };
  return { estado, servico, ctx: ctx as never };
}

const codigoDe = (e: unknown) => (e as { getResponse?: () => { code?: string } })?.getResponse?.()?.code;
const estadoDe = (e: unknown) => (e as { getStatus?: () => number })?.getStatus?.();

console.log("\nPagamentos desligados: o servidor recusa, e a euPago nunca chega a ser chamada");
{
  const m = mundo({ paymentsEnabled: false, feesOnPayer: false });
  // Uma referência que já existia antes de o clube desligar.
  m.estado.pagamentos.push({ id: "antiga", chargeId: "c1", method: "MULTIBANCO", status: "PENDING", amountCents: 2000, createdAt: new Date(), expiresAt: null });

  let erro: unknown = null;
  try {
    await m.servico.startPayment(m.ctx, "c1", "MBWAY" as never, "912345678");
  } catch (e) {
    erro = e;
  }
  check("iniciar o pagamento de uma mensalidade é recusado com 403", estadoDe(erro) === 403, String(estadoDe(erro)));
  check("com o código que as apps reconhecem", codigoDe(erro) === PAGAMENTOS_DESATIVADOS, String(codigoDe(erro)));
  check("a euPago não recebeu pedido nenhum", m.estado.pedidos.length === 0, JSON.stringify(m.estado.pedidos));
  check("e nada foi escrito: nem pagamento novo, nem a referência antiga mexida", m.estado.escritas === 0 && m.estado.pagamentos.length === 1 && m.estado.pagamentos[0].status === "PENDING");

  erro = null;
  try {
    await m.servico.startMemberFeePayment("ac1", "m1", "f1", "MULTIBANCO" as never);
  } catch (e) {
    erro = e;
  }
  check("a quota de sócio é recusada pela mesma porta", estadoDe(erro) === 403 && codigoDe(erro) === PAGAMENTOS_DESATIVADOS);
  check("e a euPago continua sem pedidos", m.estado.pedidos.length === 0);

  const c = await m.servico.cotacaoDoClube("ac1", [2000]);
  check("a cotação diz às apps que os pagamentos estão desligados", c.enabled === false);
}

console.log("\nPor omissão nada muda: cobra-se o valor da mensalidade");
{
  const m = mundo({ paymentsEnabled: true, feesOnPayer: false });
  const p = (await m.servico.startPayment(m.ctx, "c1", "MBWAY" as never, "912345678")) as Pagamento;
  check("segue para a euPago o valor exacto", m.estado.pedidos[0]?.amountCents === 2000, JSON.stringify(m.estado.pedidos));
  check("e o pagamento fica sem taxa", p.amountCents === 2000 && p.surchargeCents === 0);
}

console.log("\nComissão de quem paga: cobra-se o valor que deixa ao clube o preço inteiro");
{
  const m = mundo({ paymentsEnabled: true, feesOnPayer: true });
  const p = (await m.servico.startPayment(m.ctx, "c1", "MBWAY" as never, "912345678")) as Pagamento;
  check("a euPago recebe 20,27 € e não 20,00 €", m.estado.pedidos[0]?.amountCents === 2027, JSON.stringify(m.estado.pedidos));
  check("o pagamento guarda o total e a taxa à parte", p.amountCents === 2027 && p.surchargeCents === 27);
  check("a mensalidade continua a valer 20,00 €", m.estado.charge.amountCents === 2000);

  const outra = (await m.servico.startPayment(m.ctx, "c1", "MBWAY" as never, "912345678")) as Pagamento;
  check("pedir outra vez devolve a mesma tentativa, sem novo pedido à euPago", outra.id === p.id && m.estado.pedidos.length === 1);

  const mb = (await m.servico.startPayment(m.ctx, "c1", "MULTIBANCO" as never)) as Pagamento;
  check("por Multibanco a taxa é outra, e maior", mb.surchargeCents > 27 && mb.amountCents === 2000 + mb.surchargeCents, JSON.stringify({ a: mb.amountCents, s: mb.surchargeCents }));

  const q = (await m.servico.startMemberFeePayment("ac1", "m1", "f1", "MBWAY" as never, "912345678")) as Pagamento;
  const esperado = valorACobrar(500, "MBWAY", { feesOnPayer: true }, TABELA);
  check("a quota de sócio leva a taxa da mesma maneira", q.amountCents === esperado.totalCents && q.surchargeCents === esperado.surchargeCents, JSON.stringify({ a: q.amountCents, s: q.surchargeCents }));
}

console.log("\nMudar a regra a meio: a referência antiga não se reaproveita");
{
  const m = mundo({ paymentsEnabled: true, feesOnPayer: false });
  const antes = (await m.servico.startPayment(m.ctx, "c1", "MULTIBANCO" as never)) as Pagamento;
  m.estado.regras.feesOnPayer = true;
  const depois = (await m.servico.startPayment(m.ctx, "c1", "MULTIBANCO" as never)) as Pagamento;
  check("nasce uma referência nova, com a taxa", depois.id !== antes.id && depois.amountCents > 2000, JSON.stringify({ antes: antes.amountCents, depois: depois.amountCents }));
  check("e a antiga, de 20,00 €, fica expirada", m.estado.pagamentos.find((p) => p.id === antes.id)?.status === "EXPIRED");
}

console.log("\nO abuso: pagar o valor sem a taxa não liquida a mensalidade");
{
  const m = mundo({ paymentsEnabled: true, feesOnPayer: true });
  const p = (await m.servico.startPayment(m.ctx, "c1", "MULTIBANCO" as never)) as Pagamento;
  const r = (await m.servico.confirmPayment([p.id], new Date(), { teste: true }, 2000)) as { amountMismatch?: boolean };
  check("um aviso de 20,00 € para um pagamento com taxa é dado como divergente", r.amountMismatch === true, JSON.stringify(r));
  check("o pagamento fica falhado, não pago", m.estado.pagamentos.find((x) => x.id === p.id)?.status === "FAILED");
  check("e a mensalidade continua por pagar", m.estado.charge.status === "OPEN");
}

console.log(`\n${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);
