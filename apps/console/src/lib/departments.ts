import { useSyncExternalStore } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/http";
import type { Permission, Role } from "@/lib/permissions";

/**
 * Os departamentos da academia.
 *
 * ## O que mudou, e porquê
 *
 * Um departamento era um de cinco valores fixos em código, e servia só para
 * agrupar staff nas listas. Passou a ser uma linha na base, com permissões e
 * âmbito próprios, porque a pergunta "quem vê o quê" estava a ser feita no sítio
 * errado: o ecrã de criar um cargo perguntava **Âmbito**, e essa não é uma
 * pergunta sobre o cargo. "A equipa técnica vê só as equipas dela" decide-se uma
 * vez, sobre o departamento.
 *
 * Agora são duas perguntas separadas e cada uma tem resposta:
 *
 *  - **Departamento** — o que é que esta área do clube vê e faz?
 *  - **Cargo** — e esta pessoa, dentro dela, tem alguma coisa a mais ou a menos?
 *
 * Sem actualização optimista, pela mesma razão que `lib/roles.ts`: um
 * departamento mostrado com permissões que o servidor recusou gravar deixa quem o
 * lê a acreditar que a academia está configurada de uma maneira que não está.
 */

export type DepartmentRole = { id: string; name: string; people: number };

export type Department = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  /** O âmbito de quem trabalha aqui. Não se muda depois de criado. */
  baseRole: Role;
  permissions: Permission[];
  navKeys: string[];
  /** Veio de origem. Não o torna indestrutível — só o põe primeiro na lista. */
  isSystem: boolean;
  order: number;
  /** Os cargos lá dentro, já resolvidos pelo servidor. */
  roles: DepartmentRole[];
  people: number;
  /** Se **este** utilizador pode editar. Vem do servidor, não se recalcula. */
  editable: boolean;
};

type State = { departments: Department[]; loaded: boolean; error: string | null };

let state: State = { departments: [], loaded: false, error: null };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function useDepartments(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Lê do servidor. A primeira leitura semeia os quatro de origem, lá do lado. */
export async function loadDepartments(): Promise<void> {
  try {
    const departments = await apiGet<Department[]>("/api/departments");
    state = { departments, loaded: true, error: null };
  } catch (e) {
    state = {
      ...state,
      loaded: true,
      error: e instanceof Error ? e.message : "Não foi possível carregar os departamentos.",
    };
  }
  emit();
}

export async function createDepartment(input: {
  name: string;
  description?: string;
  baseRole: Role;
  permissions: Permission[];
  navKeys?: string[];
}): Promise<void> {
  await apiPost("/api/departments", input);
  await loadDepartments();
}

export async function updateDepartment(
  id: string,
  input: {
    name?: string;
    description?: string;
    permissions?: Permission[];
    navKeys?: string[];
    /**
     * Levar as permissões novas aos cargos que herdaram deste departamento.
     *
     * Nunca por omissão: um departamento editado que mudasse calado o que dezenas
     * de pessoas podem fazer é um efeito à distância que uma tabela de permissões
     * não deve ter. Quem edita escolhe, e vê quantos cargos vão mudar.
     */
    applyToRoles?: boolean;
  },
): Promise<{ updatedRoles: number }> {
  const r = await apiPatch<{ updatedRoles: number }>(`/api/departments/${id}`, input);
  await loadDepartments();
  return r;
}

/**
 * Apagar um departamento.
 *
 * Os cargos lá dentro ficam sem departamento, mas ficam — e com as permissões que
 * tinham. Apagar "Departamento Clínico" não pode ser uma forma acidental de tirar
 * o acesso a quem lá trabalhava.
 */
export async function removeDepartment(id: string): Promise<{ orphanedRoles: number }> {
  const r = await apiDelete<{ orphanedRoles: number }>(`/api/departments/${id}`);
  await loadDepartments();
  return r;
}

/**
 * O que o âmbito decide — por palavras, porque era esta a escolha que ninguém
 * entendia. Não é "que permissões tem"; é "de onde vem o alcance".
 */
export const SCOPE_HINT: Record<string, string> = {
  DIRECTOR: "Vê a academia toda.",
  COORDINATOR: "Vê a academia toda.",
  COACH: "Vê apenas as equipas que lhe forem atribuídas.",
  STAFF: "Vê apenas as equipas que lhe forem atribuídas.",
  MEDICAL: "Vê a academia toda — uma lesão não conhece escalões.",
  SCOUT: "Vê a academia toda — um prospecto não pertence a escalão nenhum.",
};

/** Uma etiqueta curta para o âmbito, para caber numa lista. */
export const SCOPE_LABEL: Record<string, string> = {
  DIRECTOR: "Todo o clube",
  COORDINATOR: "Todo o clube",
  COACH: "Só as suas equipas",
  STAFF: "Só as suas equipas",
  MEDICAL: "Todo o clube",
  SCOUT: "Todo o clube",
};

/** Os âmbitos que se podem escolher. `OWNER` fica de fora de propósito. */
export const SCOPES: Role[] = ["DIRECTOR", "COORDINATOR", "COACH", "MEDICAL", "SCOUT", "STAFF"];
