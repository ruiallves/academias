import type { Permission } from "./permissions";

/**
 * As chaves de menu que existem.
 *
 * Gémea de `apps/console/src/lib/nav.ts`, e de propósito magra: o cliente é dono
 * dos rótulos, dos ícones e da ordem — são decisões de interface. O servidor só
 * precisa de saber **que chaves existem**, para recusar uma lista de menus com
 * lixo lá dentro em vez de a guardar em silêncio.
 *
 * A permissão ao lado de cada chave não é uma segunda fronteira de segurança: é o
 * que permite ao servidor recusar guardar "mostra Mensalidades" num papel que não
 * tem `billing:read`, e assim impedir que a configuração fique a prometer um menu
 * que nunca apareceria. A fronteira a sério continua a ser `can()` em cada
 * serviço.
 */
export const NAV_KEYS: Record<string, Permission> = {
  overview: "academy:read",
  athletes: "athlete:read",
  families: "family:read",
  teams: "team:read",
  staff: "staff:read",
  members: "member:read",
  clinical: "clinical:read",
  consultations: "clinical:read",
  calendar: "calendar:read",
  attendance: "attendance:read",
  callups: "attendance:read",
  fees: "billing:read",
  comms: "comms:read",
  evaluations: "evaluation:read",
  reports: "report:read",
  "scouting-prospects": "scouting:read",
  "scouting-observations": "scouting:read",
  "scouting-shortlists": "scouting:read",
  // Os pedidos são a porta do treinador para o scouting — e por isso não pedem
  // `scouting:read`, que abriria os dossiês todos.
  "scouting-requests": "scouting:request",
  settings: "settings:write",
};

export function isNavKey(key: string): boolean {
  return Object.hasOwn(NAV_KEYS, key);
}
