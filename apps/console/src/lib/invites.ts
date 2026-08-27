import { useSyncExternalStore } from "react";
import { apiDelete, apiGet, apiPost } from "@/lib/http";
import type { Role } from "@/lib/permissions";
import type { StaffDepartment } from "@/data/types";

/**
 * Convites de staff.
 *
 * ## Isto era falso, e o link não abria
 *
 * Até aqui este ficheiro **inventava** o convite: gerava um token aleatório no
 * browser, montava um endereço com ar de verdadeiro e guardava tudo em memória.
 * Nada chegava ao servidor. O diálogo tinha um aviso a dizer que era uma
 * demonstração, mas quem copiasse o link e o mandasse a um treinador estava a
 * mandar uma página que dava 404 — e só descobria do outro lado.
 *
 * Agora fala com `POST /api/invites`, e o link que se copia é o que o servidor
 * emitiu.
 *
 * ## O token só existe uma vez
 *
 * Vem na resposta da criação e não volta a ser mostrado: na base de dados guarda-se
 * o SHA-256, e nem nós o conseguimos reconstruir. Quem perder o link revoga e emite
 * outro — é por isso que a lista de pendentes não traz endereço nenhum.
 */

/** Um convite por aceitar, como o servidor o lista. Sem o link, que já não existe. */
export type PendingInvite = {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string | null;
  department: StaffDepartment | null;
  teamIds: string[];
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
};

/** O que a criação devolve — e é a única vez que o link existe. */
export type Invite = {
  id: string;
  name: string;
  email: string;
  title: string | null;
  link: string;
  expiresAt: string;
  /** O servidor tentou mandar o convite por email. Saiu? */
  emailed: boolean;
  /** Porque é que não saiu, quando não saiu. */
  emailError?: string;
};

type State = { invites: PendingInvite[]; loaded: boolean };

let state: State = { invites: [], loaded: false };
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function usePendingInvites(): PendingInvite[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot).invites;
}

export function useInvitesState(): State {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Lê os pendentes. Silencioso a falhar: quem não tem `staff:read` não os vê. */
export async function loadInvites(): Promise<void> {
  try {
    const invites = await apiGet<PendingInvite[]>("/api/invites");
    state = { invites, loaded: true };
  } catch {
    state = { invites: [], loaded: true };
  }
  emit();
}

/**
 * Criar o convite.
 *
 * O `academyRoleId` é o cargo — e é dele que o servidor lê o papel-base, o
 * departamento e as permissões. Ver `InviteDialog`.
 */
export async function createInvite(input: {
  name: string;
  email: string;
  academyRoleId: string;
  teamIds: string[];
}): Promise<Invite> {
  const created = await apiPost<{
    id: string;
    link: string;
    expiresAt: string;
    emailed: boolean;
    emailError?: string;
  }>("/api/invites", input);
  await loadInvites();
  return {
    id: created.id,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    title: state.invites.find((i) => i.id === created.id)?.title ?? null,
    link: created.link,
    expiresAt: created.expiresAt,
    emailed: created.emailed,
    ...(created.emailError ? { emailError: created.emailError } : {}),
  };
}

/** Fechar um convite. O link deixa de valer — no servidor é `revokedAt`. */
export async function revokeInvite(id: string): Promise<void> {
  await apiDelete(`/api/invites/${id}`);
  await loadInvites();
}
