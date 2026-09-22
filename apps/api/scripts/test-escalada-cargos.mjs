#!/usr/bin/env node
/**
 * Escalada por cargo — não se concede o que não se tem.
 *
 * Testa a **decisão** de segurança real, a que `roles.assign` e `invites.create`
 * passaram a exigir: `ungrantablePermissions(ctx, permissões)`. Importa o módulo
 * de permissões verdadeiro (nada de reimplementar), sem servidor, sem base, sem
 * rede — corre com `node --experimental-strip-types`.
 *
 * ## O buraco que isto fecha
 *
 * `assign` e `invite` só verificavam a **patente** do cargo. Um director sem
 * `role:write` podia atribuir (ou convidar para) um cargo de patente igual à sua
 * que carregasse `role:write` ou `academy:delete`, e escalar por um testa de
 * ferro. `setAccess`/`filterGrantable` já barravam isto à mão; faltava na
 * distribuição de cargos já criados.
 *
 * ## Validação ao contrário
 *
 * Desligar a guarda = tirar o `.filter((p) => !can(ctx, p))` de
 * `ungrantablePermissions` (em `common/permissions.ts`). Feito isso, a função
 * devolve `[]` para tudo, o teste "director NÃO pode conceder role:write" falha,
 * e o exploit passa. Ligada, o exploit é barrado. É o que um teste de regressão
 * de segurança tem de fazer.
 *
 * Uso: node --experimental-strip-types scripts/test-escalada-cargos.mjs
 */
import {
  ungrantablePermissions,
  can,
  outranks,
  rankOf,
  ROLE_PERMISSIONS,
} from "../src/common/permissions.ts";

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

/** Um contexto de pedido mínimo — só o que `can`/`ungrantablePermissions` lêem. */
const ctxOf = (role, { rolePermissions = null, grants = [], revokes = [] } = {}) => ({
  userId: "u",
  academyId: "a",
  membershipId: "m",
  role,
  grants,
  revokes,
  rolePermissions,
  roleId: null,
  roleName: null,
  extraRoles: [],
  navKeys: [],
  scope: {},
});

/* Um cargo à medida que a presidência criou, com uma permissão graúda lá dentro. */
const CARGO_COM_ROLE_WRITE = ["academy:read", "staff:read", "staff:write", "access:write", "role:write"];
const CARGO_COM_DELETE = ["academy:read", "team:read", "team:write", "academy:delete"];
const CARGO_SUBSET_DIRECTOR = ["athlete:read", "athlete:write", "team:read", "team:write", "calendar:write"];

console.log("=== 1. Um director (papel-base, sem role:write) não distribui role:write ===");
const director = ctxOf("DIRECTOR"); // rolePermissions null → ROLE_PERMISSIONS.DIRECTOR
check("o director não tem role:write", !can(director, "role:write"));
check(
  "atribuir-lhe um cargo com role:write é barrado",
  ungrantablePermissions(director, CARGO_COM_ROLE_WRITE).includes("role:write"),
  JSON.stringify(ungrantablePermissions(director, CARGO_COM_ROLE_WRITE)),
);

console.log("\n=== 2. Um cargo dentro do que o director já tem passa (não trava o legítimo) ===");
check(
  "cargo subset do director → nada por conceder",
  ungrantablePermissions(director, CARGO_SUBSET_DIRECTOR).length === 0,
  JSON.stringify(ungrantablePermissions(director, CARGO_SUBSET_DIRECTOR)),
);

console.log("\n=== 3. O presidente (OWNER) pode conceder tudo ===");
const owner = ctxOf("OWNER");
check("owner concede role:write + academy:delete", ungrantablePermissions(owner, CARGO_COM_ROLE_WRITE.concat(CARGO_COM_DELETE)).length === 0);

console.log("\n=== 4. Uma retirada por pessoa não se contorna por cargo ===");
// À direção foi retirado `academy:delete` em concreto; não pode reganhá-lo por um cargo.
const directorSemDelete = ctxOf("DIRECTOR", { revokes: ["academy:delete"] });
check("o director com revoke não tem academy:delete", !can(directorSemDelete, "academy:delete"));
check(
  "e não o distribui por um cargo que o carrega",
  ungrantablePermissions(directorSemDelete, CARGO_COM_DELETE).includes("academy:delete"),
  JSON.stringify(ungrantablePermissions(directorSemDelete, CARGO_COM_DELETE)),
);

console.log("\n=== 5. A patente do alvo mede-se pelo cargo mais alto (não pelo principal) ===");
// Uma treinadora (principal patente 40) com um secundário de patente 100.
const alvoComSecundarioOwner = {
  role: "COACH",
  customRole: { rank: 40, archivedAt: null },
  extraRoles: [{ role: { rank: 100, archivedAt: null } }],
};
check("rankOf do alvo é 100 (o secundário manda)", rankOf(alvoComSecundarioOwner) === 100);
check("o director (patente 80) NÃO manda nesse alvo", outranks(director, alvoComSecundarioOwner) === false);
const treinadorSimples = { role: "COACH", customRole: null, extraRoles: [] };
check("mas manda num treinador simples (patente 40)", outranks(director, treinadorSimples) === true);

console.log(`\n${failed === 0 ? "TUDO OK" : "HÁ FALHAS"} — ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
