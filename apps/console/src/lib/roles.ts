import { useSyncExternalStore } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";
import type { Permission, Role } from "@/lib/permissions";
import type { StaffDepartment } from "@/data/types";

/**
 * Os papéis da academia.
 *
 * Uma cópia local do que o servidor tem, e nada mais: ao contrário de
 * `lib/access.ts`, aqui **não** há actualização optimista. Uma excepção por pessoa
 * que fique um instante desalinhada corrige-se na recarga seguinte; um papel
 * mostrado com permissões que o servidor recusou gravar é outra coisa — quem o lê
 * fica a acreditar que a academia está configurada de uma maneira que não está. Em
 * permissões, esperar 200 ms pela resposta é o preço certo.
 */

export type AcademyRole = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  baseRole: Role;
  /**
   * A que departamento pertence este cargo.
   *
   * Um departamento tem vários cargos; um cargo pertence a um departamento só.
   * É o que deixa o convite perguntar primeiro o departamento e só depois o
   * cargo. `null` no presidente: quem responde por tudo não é de um departamento.
   */
  department: StaffDepartment | null;
  permissions: Permission[];
  /** Vazio significa "todos os menus que a permissão deixar". */
  navKeys: string[];
  isSystem: boolean;
  rank: number;
  people: number;
  /** Se **este** utilizador pode editar este papel. Vem do servidor, não se recalcula. */
  editable: boolean;
};

type State = { roles: AcademyRole[]; loaded: boolean; error: string | null };

let state: State = { roles: [], loaded: false, error: null };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useRoles(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Lê do servidor. A primeira leitura semeia os papéis de origem, lá do lado. */
export async function loadRoles(): Promise<void> {
  try {
    const roles = await apiGet<AcademyRole[]>("/api/roles");
    state = { roles, loaded: true, error: null };
  } catch (e) {
    state = { ...state, loaded: true, error: e instanceof Error ? e.message : "Não foi possível carregar os papéis." };
  }
  emit();
}

export async function createRole(input: {
  name: string;
  description?: string;
  baseRole: Role;
  department?: StaffDepartment | null;
  permissions: Permission[];
}): Promise<void> {
  await apiPost("/api/roles", input);
  await loadRoles();
}

export async function updateRole(
  id: string,
  input: { name?: string; description?: string; department?: StaffDepartment | null; permissions?: Permission[] },
): Promise<void> {
  await apiPatch(`/api/roles/${id}`, input);
  await loadRoles();
}

export async function setRoleNav(id: string, navKeys: string[]): Promise<void> {
  await apiPatch(`/api/roles/${id}/nav`, { navKeys });
  await loadRoles();
}

export async function archiveRole(id: string): Promise<void> {
  await apiDelete(`/api/roles/${id}`);
  await loadRoles();
}

/** Dar um papel a uma pessoa. O servidor põe o papel-base a condizer. */
export async function assignRole(membershipId: string, roleId: string | null): Promise<void> {
  await apiPatch(`/api/roles/assign/${membershipId}`, { roleId });
  await loadRoles();
}

/**
 * O que o papel-base decide — dito por palavras, porque é a escolha que mais
 * confunde quem cria um papel. Não é "que permissões tem"; é "de onde vem o
 * âmbito", e isso não se adivinha de um nome em maiúsculas.
 */
export const BASE_ROLE_HINT: Record<string, string> = {
  OWNER: "Responde por tudo. Não se cria outro.",
  DIRECTOR: "Vê a academia toda.",
  COORDINATOR: "Vê a academia toda.",
  COACH: "Vê apenas as equipas que lhe forem atribuídas.",
  STAFF: "Vê apenas as equipas que lhe forem atribuídas.",
  MEDICAL: "Vê a academia toda — uma lesão não conhece escalões.",
  SCOUT: "Vê a academia toda — um prospecto não pertence a escalão nenhum.",
};

/** Os papéis-base que se podem escolher ao criar. `OWNER` fica de fora de propósito. */
export const SELECTABLE_BASES: Role[] = ["DIRECTOR", "COORDINATOR", "COACH", "MEDICAL", "SCOUT", "STAFF"];
