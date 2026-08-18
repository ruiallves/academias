/**
 * Testes da ficha de staff e das excepções de acesso.
 *
 * Corre o código verdadeiro — os mesmos módulos que a consola importa — agrupado
 * com esbuild e executado em node. Não é uma reimplementação das regras num
 * script: uma cópia das regras só testa a cópia.
 *
 * O que interessa verificar aqui é o que não se vê a olho:
 *
 *   - as excepções de acesso guardam a **diferença** para o papel, e não o valor
 *     absoluto — é isso que impede que mudar de papel arraste excepções mortas;
 *   - retirar ganha a conceder, porque em caso de engano a leitura segura é a que
 *     dá menos acesso;
 *   - o histórico junta a época a decorrer com as anteriores, sem as confundir.
 *
 * ## O que saiu daqui, e porquê
 *
 * Havia aqui testes ao histórico de equipas, à atividade de quem treina e à edição
 * de fichas. Corriam contra `data/demo.ts`, que já não existe — esses dados vivem
 * agora na base de dados, e verificá-los sem base de dados era testar um armazém
 * vazio e chamar-lhe verde. A leitura desses dados passou a ser coberta por
 * `apps/api/npm run test:academy`, contra o Postgres a sério.
 *
 * O que ficou é o que continua a ser lógica pura da consola e não depende de dados
 * nenhuns: as regras de acesso, que são a parte onde um erro custa caro.
 *
 * Uso: npm run test:staff
 */
import {
  AREAS,
  effectivePermissions,
  levelOf,
  overridesFor,
  resetAccess,
  setPermission,
} from "../src/lib/access";
import { ROLE_PERMISSIONS, permissionsOf, type Session } from "../src/lib/permissions";
import { yearsAtClub } from "../src/lib/staff";
import { deriveSteps, type Facts } from "../src/lib/onboarding";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  OK    ${label}`);
  } else {
    failed++;
    console.log(`  FALHA ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const COACH_ID = "c1"; // Rui Machado — treinador dos Sub-9 e Sub-11
const DIRECTOR_ID = "s1"; // Helena Sá Pereira

console.log("=== Excepções guardam a diferença, não o valor ===");
{
  // O papel COACH não dá `billing:read`. Conceder tem de deixar uma marca.
  setPermission(COACH_ID, "COACH", "billing:read", true);
  check("conceder o que o papel não dá fica registado", overridesFor(COACH_ID).grants.includes("billing:read"));

  // O papel COACH já dá `athlete:read`. Conceder outra vez não deve registar nada.
  setPermission(COACH_ID, "COACH", "athlete:read", true);
  check(
    "conceder o que o papel já dá não regista nada",
    !overridesFor(COACH_ID).grants.includes("athlete:read"),
    `grants: ${overridesFor(COACH_ID).grants.join(", ")}`,
  );

  // Retirar o que o papel dá tem de registar.
  setPermission(COACH_ID, "COACH", "clinical:read", false);
  check("retirar o que o papel dá fica registado", overridesFor(COACH_ID).revokes.includes("clinical:read"));

  // Retirar o que o papel não dá não regista nada — não há o que tirar.
  setPermission(COACH_ID, "COACH", "billing:write", false);
  check(
    "retirar o que o papel não dá não regista nada",
    !overridesFor(COACH_ID).revokes.includes("billing:write"),
    `revokes: ${overridesFor(COACH_ID).revokes.join(", ")}`,
  );
}

console.log("\n=== O que a pessoa pode, mesmo ===");
{
  const perms = effectivePermissions("COACH", COACH_ID);
  check("a concessão entra", perms.has("billing:read"));
  check("a retirada sai", !perms.has("clinical:read"));
  check("o resto do papel fica intacto", perms.has("attendance:write") && perms.has("athlete:read"));
  check(
    "e não ganhou nada que não fosse pedido",
    !perms.has("billing:write") && !perms.has("staff:write"),
  );
}

console.log("\n=== Voltar atrás ===");
{
  setPermission(COACH_ID, "COACH", "billing:read", false);
  check(
    "desfazer uma concessão limpa-a",
    !overridesFor(COACH_ID).grants.includes("billing:read") &&
      !effectivePermissions("COACH", COACH_ID).has("billing:read"),
  );

  setPermission(COACH_ID, "COACH", "clinical:read", true);
  check(
    "desfazer uma retirada devolve o acesso",
    effectivePermissions("COACH", COACH_ID).has("clinical:read"),
  );

  resetAccess(COACH_ID);
  const o = overridesFor(COACH_ID);
  check("repor o papel limpa tudo", o.grants.length === 0 && o.revokes.length === 0);
  check(
    "e devolve exactamente as permissões do papel",
    effectivePermissions("COACH", COACH_ID).size === new Set(ROLE_PERMISSIONS.COACH).size,
  );
}

console.log("\n=== Retirar ganha a conceder ===");
{
  // Estado impossível pela interface, possível por dados corrompidos ou por uma
  // migração mal feita. A leitura segura é a que dá menos acesso.
  const session: Session = {
    userId: "u",
    name: "Teste",
    role: "COACH",
    grants: ["billing:read"],
    revokes: ["billing:read"],
  };
  check("uma permissão nas duas listas fica de fora", !permissionsOf(session).has("billing:read"));
}

console.log("\n=== Níveis por área ===");
{
  const athletes = AREAS.find((a) => a.label === "Atletas")!;
  const billing = AREAS.find((a) => a.label === "Mensalidades")!;

  // O treinador inscreve atletas por omissão (só nas suas equipas, garantido no
  // servidor). Ao nível da área, isso lê-se como "editar".
  check("o treinador edita atletas por omissão", levelOf(athletes, effectivePermissions("COACH", COACH_ID)) === "write");
  check("e não vê mensalidades", levelOf(billing, effectivePermissions("COACH", COACH_ID)) === "none");
  check("a direção edita mensalidades", levelOf(billing, effectivePermissions("DIRECTOR", DIRECTOR_ID)) === "write");

  // Subir uma área a "editar" tem de conceder as duas permissões.
  setPermission(COACH_ID, "COACH", billing.read, true);
  setPermission(COACH_ID, "COACH", billing.write!, true);
  check("subir a editar dá ver e editar", levelOf(billing, effectivePermissions("COACH", COACH_ID)) === "write");
  resetAccess(COACH_ID);
}

console.log("\n=== Quem gere acessos ===");
{
  const director: Session = { userId: "d", name: "D", role: "DIRECTOR" };
  const coordinator: Session = { userId: "c", name: "C", role: "COORDINATOR" };
  const coach: Session = { userId: "t", name: "T", role: "COACH" };

  check("a direção pode mudar acessos", permissionsOf(director).has("access:write"));
  check("a coordenação não pode", !permissionsOf(coordinator).has("access:write"));
  check("o treinador muito menos", !permissionsOf(coach).has("access:write"));

  /*
   * A razão de `access:write` existir separada de `staff:write`.
   *
   * Agora que a direção pode abrir permissões pessoa a pessoa, é plausível dar a
   * uma secretária o acesso a editar fichas — corrigir telemóveis e cargos. Isso
   * não lhe pode dar o poder de mudar o que os outros vêem, senão qualquer pessoa
   * com acesso à ficha passava a administradora do sistema sem ninguém ter
   * decidido isso.
   */
  const secretary = "o1";
  setPermission(secretary, "STAFF", "staff:write", true);
  const perms = effectivePermissions("STAFF", secretary);
  check("dar edição de fichas a alguém funciona", perms.has("staff:write"));
  check("mas não lhe dá poder sobre acessos", !perms.has("access:write"));
  resetAccess(secretary);
}

console.log("\n=== Primeiros passos ===");
{
  const director: Session = { userId: "d", name: "D", role: "DIRECTOR" };
  const vazia: Facts = { venues: 0, teams: 0, athletes: 0, coaches: 0, invitedCoach: false, sessions: 0, guardians: 0 };
  const cheia: Facts = { venues: 2, teams: 2, athletes: 9, coaches: 2, invitedCoach: false, sessions: 20, guardians: 4 };

  const inicio = deriveSteps(director, vazia);
  check("uma academia vazia tem tudo por fazer", inicio.every((s) => !s.done));
  check("e sao seis passos", inicio.length === 6, `${inicio.length}`);

  check("uma academia montada tem tudo feito", deriveSteps(director, cheia).every((s) => s.done));

  // Derivado dos dados: criar a equipa pelo caminho normal marca o passo sozinho.
  const comEquipa = deriveSteps(director, { ...vazia, teams: 1 });
  check("criar uma equipa marca o passo sozinho", comEquipa.find((s) => s.id === "teams")?.done === true);
  check("e nao marca os outros", comEquipa.filter((s) => s.done).length === 1);

  // Convidar conta como feito — o resto depende de a pessoa abrir o link.
  check("convidar um treinador ja conta",
    deriveSteps(director, { ...vazia, invitedCoach: true }).find((s) => s.id === "coaches")?.done === true);
  check("ter treinador com conta tambem",
    deriveSteps(director, { ...vazia, coaches: 1 }).find((s) => s.id === "coaches")?.done === true);
}

console.log("\n=== Quem ve que passos ===");
{
  const coach: Session = { userId: "t", name: "T", role: "COACH" };
  const medical: Session = { userId: "m", name: "M", role: "MEDICAL" };
  const vazia: Facts = { venues: 0, teams: 0, athletes: 0, coaches: 0, invitedCoach: false, sessions: 0, guardians: 0 };

  // Um passo que a pessoa nao pode dar nao lhe deve aparecer.
  const doTreinador = deriveSteps(coach, vazia);
  check("o treinador nao ve convidar staff", !doTreinador.some((s) => s.id === "coaches"));
  check("nem definir campos", !doTreinador.some((s) => s.id === "venues"));
  check("nem criar equipas", !doTreinador.some((s) => s.id === "teams"));

  check("o departamento clinico nao tem passos de montagem",
    deriveSteps(medical, vazia).length === 0, `${deriveSteps(medical, vazia).length}`);
}

console.log("\n=== Anos de casa ===");
{
  check("conta anos completos", yearsAtClub("2022-09-01") >= 3, `${yearsAtClub("2022-09-01")}`);
  check("quem entrou hoje tem zero", yearsAtClub(new Date().toISOString()) === 0);
  check("nunca é negativo", yearsAtClub("2099-01-01") === 0);
}

console.log(`\n${passed} passaram, ${failed} falharam`);
process.exit(failed === 0 ? 0 : 1);
