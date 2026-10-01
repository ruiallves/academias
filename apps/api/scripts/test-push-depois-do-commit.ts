/**
 * Um push só sai de uma escrita que valeu.
 *
 * ## O que aconteceu
 *
 * A 1 de Outubro de 2026, as famílias de um clube receberam "a mensalidade de
 * Outubro já está disponível", abriram a app, e Outubro não existia. A emissão
 * do mês criava as mensalidades e avisava as famílias **dentro da mesma
 * transacção**; os avisos demoraram mais do que a transacção aguentava, o
 * Postgres desfez tudo — e os pushes já estavam nos telemóveis. Como a emissão
 * volta a tentar de hora a hora, o aviso repetiu-se a cada hora.
 *
 * ## O que este teste prova
 *
 * Não que o push "funciona", mas a ordem: **nada sai antes do commit, e nada sai
 * de um rollback**. Corre o `NotificationsService` verdadeiro contra uma base de
 * mentira que distingue o que uma transacção escreveu do que já tem commit — que
 * é a única coisa que interessa aqui.
 *
 * Uso: npm run test:push-commit
 */
import { NotificationsService, type NotificationInput } from "../src/notifications/notifications.service";

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
/* Uma base de mentira com commit e rollback a sério                           */
/* -------------------------------------------------------------------------- */

type Linha = { id: string; userId: string; title: string; body: string; payload: unknown; deliveredAt: Date | null };

function baseDeMentira() {
  const comCommit = new Map<string, Linha>();
  let seq = 0;

  /** Um cliente de transacção: escreve num rascunho que só o `commit` torna visível. */
  const abrir = () => {
    const rascunho = new Map<string, Linha>();
    const db = {
      notification: {
        create: async ({ data }: { data: Omit<Linha, "id" | "deliveredAt"> }) => {
          const linha: Linha = { ...data, id: "n" + ++seq, deliveredAt: null };
          rascunho.set(linha.id, linha);
          return linha;
        },
        /* Só vê o que tem commit — e o seu próprio rascunho, como no Postgres. */
        findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => rascunho.get(id) ?? comCommit.get(id)).filter((l): l is Linha => Boolean(l)),
        updateMany: async ({ where, data }: { where: { id: string }; data: Partial<Linha> }) => {
          const l = rascunho.get(where.id) ?? comCommit.get(where.id);
          if (l) rascunho.set(l.id, { ...l, ...data });
          return { count: l ? 1 : 0 };
        },
      },
    };
    return {
      db,
      commit: () => rascunho.forEach((l, id) => comCommit.set(id, l)),
      rollback: () => rascunho.clear(),
    };
  };

  /** O `runAs` do serviço: uma transacção curta que faz commit ao acabar. */
  const prisma = {
    runAs: async <T,>(_academyId: string, work: (db: unknown) => Promise<T>): Promise<T> => {
      const tx = abrir();
      const r = await work(tx.db);
      tx.commit();
      return r;
    },
  };

  return { prisma, abrir, comCommit };
}

function montar() {
  const base = baseDeMentira();
  const servico = new NotificationsService(base.prisma as never);
  const entregues: string[] = [];
  servico.register({ name: "push", deliver: async (n) => void entregues.push(n.title) });
  /* Sem relógio: o teste chama a varredura à mão. */
  servico.intervaloMs = 60 * 60_000;
  return { ...base, servico, entregues };
}

const aviso = (title: string): NotificationInput => ({
  academyId: "clube",
  userId: "mae",
  type: "PAYMENT_PENDING" as NotificationInput["type"],
  title,
  body: "A mensalidade de Outubro já está disponível.",
});

/* -------------------------------------------------------------------------- */
console.log("=== 1. O caso de 1 de Outubro: a transacção é desfeita ===");
{
  const { servico, entregues, abrir, comCommit } = montar();
  const tx = abrir();

  await servico.enqueue(aviso("Nova mensalidade"), tx.db as never);
  check("dentro da transacção, o push NÃO sai", entregues.length === 0, entregues.join());

  await servico.varrerPendentes();
  check("a varredura não entrega o que ainda não tem commit", entregues.length === 0, entregues.join());

  /* A transacção expira e o Postgres desfaz tudo. */
  tx.rollback();
  await servico.varrerPendentes();
  check("depois do rollback, continua sem sair", entregues.length === 0, entregues.join());

  /* Passa o tempo de espera: a entrega é esquecida, e não fica a tentar para sempre. */
  await servico.varrerPendentes(Date.now() + servico.idadeMaximaMs + 1);
  check("e nunca sai, por muito que se espere", entregues.length === 0, entregues.join());
  check("nem ficou notificação nenhuma na base", comCommit.size === 0, String(comCommit.size));

  /* A fila ficou limpa: uma varredura seguinte não tem nada para espreitar. */
  let espreitou = false;
  (servico as unknown as { prisma: { runAs: unknown } }).prisma.runAs = async () => {
    espreitou = true;
    return [];
  };
  await servico.varrerPendentes(Date.now() + servico.idadeMaximaMs + 2);
  check("a entrega desistida sai da fila", !espreitou);
}

/* -------------------------------------------------------------------------- */
console.log("\n=== 2. A transacção vale: o push sai, uma vez, depois do commit ===");
{
  const { servico, entregues, abrir, comCommit } = montar();
  const tx = abrir();

  await servico.enqueue(aviso("Nova mensalidade"), tx.db as never);
  await servico.varrerPendentes();
  check("antes do commit, nada", entregues.length === 0);

  tx.commit();
  await servico.varrerPendentes();
  check("depois do commit, sai", entregues.length === 1, String(entregues.length));
  check("e fica marcada como entregue", [...comCommit.values()][0]?.deliveredAt instanceof Date);

  await servico.varrerPendentes();
  await servico.varrerPendentes();
  check("varrer outra vez não repete o push", entregues.length === 1, String(entregues.length));
}

/* -------------------------------------------------------------------------- */
console.log("\n=== 3. Uma emissão inteira: dezanove famílias, uma transacção ===");
{
  const { servico, entregues, abrir } = montar();
  const tx = abrir();
  for (let i = 1; i <= 19; i++) await servico.enqueue(aviso("Família " + i), tx.db as never);
  check("dezanove avisos gravados, nenhum push", entregues.length === 0, String(entregues.length));

  tx.commit();
  await servico.varrerPendentes();
  check("com o commit, saem os dezanove", entregues.length === 19, String(entregues.length));
  check("cada família uma vez", new Set(entregues).size === 19);
}

/* -------------------------------------------------------------------------- */
console.log("\n=== 4. Sem transacção de quem chama ===");
{
  const { servico, entregues, comCommit } = montar();
  await servico.enqueue(aviso("Aviso solto"));
  check("grava e entrega logo, já com commit", entregues.length === 1 && comCommit.size === 1);
  await servico.varrerPendentes();
  check("e não entra na fila de espera (não repete)", entregues.length === 1, String(entregues.length));
}

/* -------------------------------------------------------------------------- */
console.log("\n=== 5. Um canal que falha não leva a notificação ===");
{
  const base = baseDeMentira();
  const servico = new NotificationsService(base.prisma as never);
  servico.intervaloMs = 60 * 60_000;
  servico.register({
    name: "push",
    deliver: async () => {
      throw new Error("o fornecedor de push não respondeu");
    },
  });
  let rebentou = false;
  try {
    await servico.enqueue(aviso("Aviso"));
  } catch {
    rebentou = true;
  }
  check("o erro do canal não rebenta com quem avisou", !rebentou);
  check("e a notificação fica na app", base.comCommit.size === 1);
}

console.log("");
console.log(`${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);
