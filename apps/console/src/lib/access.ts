import { useSyncExternalStore } from "react";
import { apiPatch } from "@/lib/http";
import { reloadAcademy } from "@/lib/store";
import { ROLE_PERMISSIONS, type Permission, type Role } from "@/lib/permissions";

/**
 * Excepções de acesso, pessoa a pessoa — persistidas no servidor.
 *
 * O papel decide o que uma pessoa pode fazer; isto guarda as excepções que a
 * direção abriu ou fechou para **uma** pessoa em concreto:
 *
 *  - **conceder** — dar `billing:read` a um treinador que também trata de
 *    inscrições, sem o promover a coordenador;
 *  - **retirar** — tirar `athlete:write` a um treinador a quem a direção não queira
 *    dar poder de inscrever atletas, embora o papel o dê por omissão.
 *
 * ## Onde vive a verdade
 *
 * Em `Membership.grants` e `Membership.revokes`, no servidor. Este ficheiro é uma
 * cópia local **optimista**: ao mexer num interruptor, a UI reage já, e a mudança
 * é gravada por baixo (`PATCH /api/staff/:id/access`). Se a gravação falhar,
 * relê-se a academia e a verdade do servidor prevalece — a UI nunca fica a mentir
 * por muito tempo.
 *
 * As guardas contra escalada (não delegar `access:write`, só dar o que se tem)
 * estão no servidor. Aqui é só a experiência.
 */

export type Overrides = { grants: Permission[]; revokes: Permission[] };

/** Três estados por área, que é como um diretor pensa nisto. */
export type Level = "none" | "read" | "write";

type State = Record<string, Overrides>;

let state: State = {};
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useAccessOverrides(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function overridesFor(staffId: string): Overrides {
  return state[staffId] ?? { grants: [], revokes: [] };
}

/**
 * Semeia a cópia local com o que o servidor já sabe desta pessoa.
 *
 * Chamado pela ficha ao abrir: sem isto, o painel começava vazio e mostrava a
 * pessoa "sem excepções" mesmo quando as tem gravadas. Só semeia se ainda não
 * houver estado local — para não sobrepor uma edição em curso.
 */
export function seedOverrides(staffId: string, grants: string[] = [], revokes: string[] = []): void {
  if (state[staffId]) return;
  state = { ...state, [staffId]: { grants: grants as Permission[], revokes: revokes as Permission[] } };
  emit();
}

/** Verdadeiro quando esta pessoa tem alguma excepção — para a ficha o poder dizer. */
export function hasOverrides(staffId: string): boolean {
  const o = overridesFor(staffId);
  return o.grants.length > 0 || o.revokes.length > 0;
}

/**
 * Define uma permissão para uma pessoa.
 *
 * Guarda-se a **diferença** para o papel, não o valor absoluto: se o papel já
 * concede aquilo, não fica excepção nenhuma. O painel chama isto duas vezes para
 * um nível "editar" (o ver e o escrever); o `persist` é adiado por um instante
 * para os dois updates seguirem numa só gravação, em vez de duas idas ao servidor
 * a correrem uma contra a outra.
 */
export function setPermission(staffId: string, role: Role, permission: Permission, allowed: boolean): void {
  const base = ROLE_PERMISSIONS[role].includes(permission);
  const current = overridesFor(staffId);

  const grants = current.grants.filter((p) => p !== permission);
  const revokes = current.revokes.filter((p) => p !== permission);

  if (allowed && !base) grants.push(permission);
  if (!allowed && base) revokes.push(permission);

  state = { ...state, [staffId]: { grants, revokes } };
  emit();
  schedulePersist(staffId);
}

/** Devolve a pessoa ao que o papel dela dá. */
export function resetAccess(staffId: string): void {
  state = { ...state, [staffId]: { grants: [], revokes: [] } };
  emit();
  schedulePersist(staffId);
}

/* -------------------------------------------------------------------------- */
/* Persistência                                                                */
/* -------------------------------------------------------------------------- */

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** Coalesce as edições rápidas de uma pessoa numa só gravação. */
function schedulePersist(staffId: string): void {
  const existing = pending.get(staffId);
  if (existing) clearTimeout(existing);
  pending.set(
    staffId,
    setTimeout(() => {
      pending.delete(staffId);
      void persist(staffId);
    }, 250),
  );
}

async function persist(staffId: string): Promise<void> {
  const { grants, revokes } = overridesFor(staffId);
  try {
    await apiPatch(`/api/staff/${staffId}/access`, { grants, revokes });
    // O servidor pode ter limado o que não é delegável; relê para a UI mostrar
    // exactamente o que ficou gravado, não o que se pediu.
    await reloadAcademy();
  } catch {
    // A gravação falhou — a verdade é a do servidor. Relê e deixa a próxima
    // seedagem repor o estado real; a UI não deve continuar a mostrar uma
    // alteração que não pegou.
    delete state[staffId];
    emit();
    await reloadAcademy().catch(() => {});
  }
}

/** O que a pessoa pode, mesmo — papel mais excepções. */
export function effectivePermissions(role: Role, staffId: string): Set<Permission> {
  const { grants, revokes } = overridesFor(staffId);
  const allowed = new Set<Permission>([...ROLE_PERMISSIONS[role], ...grants]);
  for (const p of revokes) allowed.delete(p);
  return allowed;
}

/**
 * As áreas do produto, como um diretor as vê.
 *
 * Uma linha por área e não uma por permissão: "Mensalidades" diz mais do que
 * `billing:read` + `billing:write`, e é sobre áreas que uma direção discute
 * acessos. As permissões continuam a ser a verdade por baixo.
 */
export type Area = {
  label: string;
  hint: string;
  read: Permission;
  write?: Permission;
};

export const AREAS: Area[] = [
  { label: "Atletas", hint: "fichas, plantéis e inscrições", read: "athlete:read", write: "athlete:write" },
  { label: "Famílias", hint: "encarregados e contactos", read: "family:read", write: "family:write" },
  { label: "Equipas", hint: "escalões, horários e plantéis", read: "team:read", write: "team:write" },
  { label: "Calendário", hint: "treinos, jogos e eventos", read: "calendar:read", write: "calendar:write" },
  { label: "Presenças", hint: "registo de faltas nos treinos", read: "attendance:read", write: "attendance:write" },
  { label: "Avaliações", hint: "notas por competência", read: "evaluation:read", write: "evaluation:write" },
  { label: "Relatórios", hint: "o que a família recebe", read: "report:read", write: "report:write" },
  { label: "Mensalidades", hint: "valores, dívida e pagamentos", read: "billing:read", write: "billing:write" },
  /*
   * Sócios — a linha que faltava, e a falta era do género pior.
   *
   * `member:read` existe, comanda o menu *Sócios* e é o que abre a lista de
   * sócios do clube com quotas e contactos. Mas não estava aqui, e este catálogo
   * é o que desenha os três sítios onde se mexe em acessos: o editor de cargos,
   * o de departamentos e o painel de acesso de cada pessoa.
   *
   * O efeito não era só "não se pode dar". Era **não se pode tirar**: um cargo
   * que tivesse ficado com a permissão — por exemplo um "Treinador Principal"
   * criado sem departamento, no tempo em que a base `STAFF` ainda trazia
   * `member:read` — mostrava Sócios a um treinador para sempre, sem ninguém
   * conseguir ver de onde vinha nem desligá-lo. Uma permissão invisível não é
   * uma permissão por omissão: é uma permissão sem dono.
   */
  { label: "Sócios", hint: "lista de sócios, quotas e contactos", read: "member:read", write: "member:write" },
  { label: "Comunicação", hint: "avisos às famílias", read: "comms:read", write: "comms:write" },
  { label: "Staff", hint: "pessoas da academia", read: "staff:read", write: "staff:write" },
];

/**
 * Dados clínicos, à parte de propósito.
 *
 * São categoria especial no RGPD e não se resumem a "ver/editar": há uma diferença
 * real entre saber que um atleta está parado e ler o diagnóstico dele. Metê-los na
 * grelha das outras áreas convidava a tratá-los como mais uma linha.
 */
export const CLINICAL_AREAS: Area[] = [
  { label: "Disponibilidade clínica", hint: "se está apto e até quando", read: "clinical:status" },
  { label: "Boletim clínico", hint: "diagnóstico, notas e exames", read: "clinical:read" },
  { label: "Registo clínico", hint: "dar baixa e alta — só o departamento clínico", read: "clinical:write" },
];

/**
 * Scouting, à parte das outras áreas.
 *
 * Pela mesma razão do clínico: o vídeo é imagem de menores que **não são da
 * academia**, e há uma diferença real entre ler o dossiê e poder ver as
 * gravações. Numa linha só, "Scouting: ver/editar", essa distinção desaparecia.
 */
export const SCOUTING_AREAS: Area[] = [
  { label: "Scouting", hint: "prospectos, observações e shortlists", read: "scouting:read", write: "scouting:write" },
  { label: "Vídeo de scouting", hint: "ver e carregar gravações de prospectos", read: "scouting:video:read", write: "scouting:video:write" },
];

/**
 * O que muda o produto para os outros.
 *
 * Só aparece no editor de papéis, e não no painel de acesso de uma pessoa: dar
 * isto a alguém é uma decisão que se toma a olhar para a lista toda de papéis, não
 * a meio da ficha de um treinador.
 */
export const ADMIN_AREAS: Area[] = [
  { label: "Papéis", hint: "criar papéis e escolher-lhes as permissões", read: "role:write" },
  { label: "Menus", hint: "escolher o que cada papel vê na navegação", read: "role:menu" },
  { label: "Acessos", hint: "mudar o acesso de cada pessoa", read: "access:write" },
  { label: "Definições", hint: "configuração da academia", read: "settings:write" },
];

/** O nível de uma área para um dado conjunto de permissões. */
export function levelOf(area: Area, permissions: Set<Permission>): Level {
  if (area.write && permissions.has(area.write)) return "write";
  if (permissions.has(area.read)) return "read";
  return "none";
}
