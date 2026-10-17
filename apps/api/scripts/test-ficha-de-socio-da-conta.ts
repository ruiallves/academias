/**
 * Que ficha de sócio vê cada conta na app, e se as quotas são dela.
 *
 * Decisão do Rui (17/10/2026): o atleta que é sócio vê a área de sócio, mas
 * as quotas de um sócio-atleta menor são dos encarregados (área da família,
 * Pagamentos). `fichaDeSocioDaConta` decide as duas coisas, e é usada por
 * `contexts` (a área aparece) e por cada rota da área de sócio.
 *
 * Corre a função verdadeira contra uma base de mentira que avalia o `where`
 * como o Prisma (igualdade, `not`, `lte`, `NOT`, `AND` e relações). É isso que
 * apanha a armadilha que já lá esteve: `{ athleteId: id, ...FICHAS_PAGAS_PELA_FAMILIA }`
 * apagava a condição do atleta (o filtro também tem a chave `athleteId`) e o
 * atleta via a ficha de outro.
 *
 * Sem base de dados, sem rede.
 *
 * Uso: npm run test:ficha-de-socio-da-conta
 */
import { fichaDeSocioDaConta } from "../src/members/socio-menor";

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
/* Uma base de mentira que percebe o `where`                                   */
/* -------------------------------------------------------------------------- */

type Linha = Record<string, unknown>;

function cumpre(linha: Linha | null | undefined, where: Record<string, unknown>): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") {
      if (!(v as Record<string, unknown>[]).every((w) => cumpre(linha, w))) return false;
      continue;
    }
    if (k === "NOT") {
      if (cumpre(linha, v as Record<string, unknown>)) return false;
      continue;
    }
    const valor = linha?.[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if ("not" in o) {
        if (o.not === null ? valor === null || valor === undefined : valor === o.not) return false;
        continue;
      }
      if ("lte" in o) {
        if (typeof valor !== "number" || valor > (o.lte as number)) return false;
        continue;
      }
      if ("in" in o) {
        if (!(o.in as unknown[]).includes(valor)) return false;
        continue;
      }
      // Uma relação: a linha relacionada tem de cumprir o `where` de dentro.
      if (!cumpre(valor as Linha | null, o)) return false;
      continue;
    }
    if (valor !== v) return false;
  }
  return true;
}

const MENORES = { maxAge: 18 };
const ADULTOS = { maxAge: null };

/*
 * O clube de teste:
 *  - Ana, sócia adulta com a ficha ligada à conta (paga ela);
 *  - Rui e Tiago, atletas menores, cada um com conta de atleta e ficha de
 *    sócio-atleta numa categoria de menores (pagam os encarregados);
 *  - Marta, atleta adulta, sócia numa categoria de adultos, ficha ligada à conta;
 *  - Pedro, atleta com conta mas sem ficha de sócio;
 *  - Joana, atleta com a conta desligada (inactiva) e ficha de sócio-atleta.
 */
const atletas: Linha[] = [
  { id: "at-rui", account: { userId: "u-rui", isActive: true } },
  { id: "at-tiago", account: { userId: "u-tiago", isActive: true } },
  { id: "at-marta", account: { userId: "u-marta", isActive: true } },
  { id: "at-pedro", account: { userId: "u-pedro", isActive: true } },
  { id: "at-joana", account: { userId: "u-joana", isActive: false } },
];
const fichas: Linha[] = [
  { id: "m-ana", userId: "u-ana", athleteId: null, tier: ADULTOS },
  // A do Tiago vem primeiro de propósito: com a armadilha, era esta que o Rui via.
  { id: "m-tiago", userId: null, athleteId: "at-tiago", tier: MENORES },
  { id: "m-rui", userId: null, athleteId: "at-rui", tier: MENORES },
  { id: "m-marta", userId: "u-marta", athleteId: "at-marta", tier: ADULTOS },
  { id: "m-joana", userId: null, athleteId: "at-joana", tier: MENORES },
  // Uma ficha de menores que ficou ligada a uma conta por engano: continua a não ser "dela".
  { id: "m-colada", userId: "u-colada", athleteId: "at-outro", tier: MENORES },
];

const db = {
  member: { findFirst: async ({ where }: { where: Record<string, unknown> }) => fichas.find((f) => cumpre(f, where)) ?? null },
  athlete: { findFirst: async ({ where }: { where: Record<string, unknown> }) => atletas.find((a) => cumpre(a, where)) ?? null },
};

const ver = (userId: string) => fichaDeSocioDaConta(db as never, userId);

/* -------------------------------------------------------------------------- */

console.log("\nA base de mentira percebe a armadilha");
{
  const armadilha = { athleteId: "at-rui", ...{ athleteId: { not: null }, tier: { maxAge: { lte: 18 } } } };
  const errada = fichas.find((f) => cumpre(f, armadilha));
  check("espalhar o filtro por cima apaga o atleta e devolve a ficha de outro", errada?.id === "m-tiago", String(errada?.id));
}

console.log("\nSócio-atleta menor: vê a sua ficha, sem quotas");
{
  const rui = await ver("u-rui");
  check("o Rui vê a ficha dele", rui?.id === "m-rui", String(rui?.id));
  check("e não a do Tiago", rui?.id !== "m-tiago");
  check("marcada como paga pela família (sem quotas na app)", rui?.pagoPelaFamilia === true);
  const tiago = await ver("u-tiago");
  check("o Tiago vê a dele", tiago?.id === "m-tiago" && tiago.pagoPelaFamilia === true, String(tiago?.id));
}

console.log("\nOs outros casos ficam como estavam");
{
  const ana = await ver("u-ana");
  check("a sócia adulta vê a sua ficha, com quotas", ana?.id === "m-ana" && ana.pagoPelaFamilia === false, JSON.stringify(ana));
  const marta = await ver("u-marta");
  check("a atleta adulta sócia paga ela: vê a ficha com quotas", marta?.id === "m-marta" && marta.pagoPelaFamilia === false, JSON.stringify(marta));
  check("um atleta sem ficha de sócio não tem área de sócio", (await ver("u-pedro")) === null);
  check("uma conta de atleta desligada não vê a ficha", (await ver("u-joana")) === null);
  check(
    "uma ficha de menores ligada por engano a uma conta não abre a área a essa conta",
    (await ver("u-colada")) === null,
  );
  check("uma conta qualquer, sem ficha nem atleta, não tem nada", (await ver("u-ninguem")) === null);
}

console.log(`\n${bad === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${ok} ok, ${bad} falhas`);
process.exit(bad === 0 ? 0 : 1);
