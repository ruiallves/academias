#!/usr/bin/env node
/**
 * Quando é que a ficha de um atleta se cola a uma conta que já existe.
 *
 * Corre a função verdadeira (`src/academy/athlete-account-link.ts`), sem
 * servidor, sem base de dados, sem rede.
 *
 * ## Porque é que isto merece um teste próprio
 *
 * Porque a guarda do meio protege a ficha clínica de um menor. Muitos clubes
 * escrevem o email do pai na ficha do filho; ligar por email nu dava à conta do
 * pai uma área "Atleta" com a ficha do miúdo dentro — e o papel `ATHLETE` lê
 * `clinical:read` e `evaluation:read`. Um teste que só chamasse a API e visse
 * "ligou" não provava nada: o que tem de ficar provado é **o que não liga**.
 *
 * Uso: node --experimental-strip-types scripts/test-ligacao-atleta.mjs
 */
import { fichaUnicaComEsteEmail, razaoParaNaoLigar } from "../src/academy/athlete-account-link.ts";

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
  if (ok) {
    passed++;
    console.log(`  OK   ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
};

/** O caso que liga: ficha com email, conta do clube, e nenhuma guarda a pegar. */
const bom = {
  jaTemConta: false,
  temEmail: true,
  contaExiste: true,
  encarregadoDesteAtleta: false,
  jaEDonoDeOutraFicha: false,
  desligadaPeloClube: false,
};
const com = (over) => ({ ...bom, ...over });

/* ------------------------------------------------------------------ 1 ---- */
console.log("=== 1. O caso que deu origem a isto ===");

/*
 * A pessoa da AD Márcia Felgueiras: treinadora do clube, encarregada de um
 * filho, e jogadora nos seniores. A conta dela já existe (é staff e família),
 * a ficha de atleta dela tem o email dela, e ela não é encarregada de si
 * mesma — o `GuardianLink` que tem é para o filho, que é outro atleta.
 */
check("staff + encarregada de outro atleta + ficha própria: liga", razaoParaNaoLigar(bom) === null, String(razaoParaNaoLigar(bom)));

/* ------------------------------------------------------------------ 2 ---- */
console.log("\n=== 2. As guardas, uma a uma ===");

const semEmail = razaoParaNaoLigar(com({ temEmail: false }));
check("ficha sem email não liga", semEmail !== null, String(semEmail));

const jaTem = razaoParaNaoLigar(com({ jaTemConta: true }));
check("ficha que já tem conta não se religa", jaTem !== null, String(jaTem));

const semConta = razaoParaNaoLigar(com({ contaExiste: false }));
check("email sem conta neste clube não liga (fica o convite)", semConta !== null, String(semConta));

/*
 * A guarda que importa. `contaExiste` é verdade, o email coincide, e mesmo
 * assim não liga: aquele email é do encarregado **deste** atleta, e portanto é
 * o email do pai na ficha do filho.
 */
const doPai = razaoParaNaoLigar(com({ encarregadoDesteAtleta: true }));
check("o email do encarregado deste atleta NÃO liga", doPai !== null, String(doPai));
check("e a razão di-lo", doPai === "este email é do encarregado deste atleta", String(doPai));

const outraFicha = razaoParaNaoLigar(com({ jaEDonoDeOutraFicha: true }));
check("uma conta que já é de outro atleta não liga (uma conta, um atleta)", outraFicha !== null, String(outraFicha));

const desligada = razaoParaNaoLigar(com({ desligadaPeloClube: true }));
check("o que o clube desligou fica desligado", desligada !== null, String(desligada));

/* ------------------------------------------------------------------ 3 ---- */
console.log("\n=== 3. Desligar tem de durar ===");

/*
 * "Desligar a conta" existe para quando a ficha se colou à pessoa errada. Sem
 * a última guarda, o desligar durava até a pessoa voltar a abrir a app: o
 * `contexts` reclamava a ficha outra vez e a área reaparecia. É o caso em que
 * uma funcionalidade nova desfaz uma correcção manual, em silêncio.
 */
const depoisDeDesligar = com({ desligadaPeloClube: true });
check("nada liga uma ficha que o clube desligou", razaoParaNaoLigar(depoisDeDesligar) !== null);
check(
  "nem quando tudo o resto está perfeito",
  razaoParaNaoLigar({ ...bom, desligadaPeloClube: true }) !== null,
);

/* ------------------------------------------------------------------ 4 ---- */
console.log("\n=== 4. A ordem das razões ===");

/*
 * Uma ficha pode falhar por dois motivos ao mesmo tempo. A razão devolvida é a
 * mais certa das duas, e a ordem não é estética: "já tem conta" é uma não-acção,
 * "é do encarregado" é uma recusa. Quem lê o log tem de saber a diferença.
 */
check(
  "já tem conta ganha a não ter email",
  razaoParaNaoLigar(com({ jaTemConta: true, temEmail: false })) === "a ficha já tem conta ligada",
);
check(
  "a conta inexistente ganha às guardas que dependem dela",
  razaoParaNaoLigar(com({ contaExiste: false, encarregadoDesteAtleta: true })) ===
    "não há conta com este email neste clube",
);

/* ------------------------------------------------------------------ 5 ---- */
console.log("\n=== 5. Irmãos no email do pai ===");

/*
 * O lado da app procura fichas sem dono pelo email da conta. Duas fichas com o
 * mesmo email são dois filhos com o email do pai: escolher uma seria escolher
 * um filho.
 */
check("nenhuma ficha: nada a reclamar", fichaUnicaComEsteEmail([]) === null);
check("uma ficha: é essa", fichaUnicaComEsteEmail(["a"]) === "a");
check("duas fichas (irmãos): nenhuma", fichaUnicaComEsteEmail(["a", "b"]) === null);
check("três: também nenhuma", fichaUnicaComEsteEmail(["a", "b", "c"]) === null);

console.log("");
console.log(`${failed === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
