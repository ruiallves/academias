import { useSyncExternalStore } from "react";
import { academy } from "@/lib/api";
import type { Role } from "@/lib/permissions";
import type { StaffDepartment } from "@/data/types";

/**
 * Convites de staff emitidos a partir da consola.
 *
 * Mesmo padrão de `lib/roster.ts`: os dados de demonstração são estáticos, e o que
 * se cria na UI vive aqui à parte até a API entrar. A forma dos objectos é a mesma
 * que `POST /api/invites` devolve, para a troca ser só de origem.
 *
 * ## O que aqui é fingido e o que não é
 *
 * O token é gerado com `crypto.getRandomValues` — aleatório a sério, como no
 * servidor. O que falta é o outro lado: aqui fica em memória em claro, enquanto na
 * base de dados só existe o SHA-256 (ver `apps/api/src/invites/invites.service.ts`).
 * Esta cópia serve para o diretor poder copiar o link; o servidor é que decide se
 * ele vale.
 */

export type Invite = {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string;
  department: StaffDepartment;
  teamIds: string[];
  link: string;
  createdAt: string;
  expiresAt: string;
  invitedBy: string;
};

let state: Invite[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

export function usePendingInvites(): Invite[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Uma semana — o mesmo `VALID_DAYS` do servidor. */
const VALID_DAYS = 7;

let seq = 1;

export function createInvite(input: {
  name: string;
  email: string;
  role: Role;
  title: string;
  department: StaffDepartment;
  teamIds: string[];
  invitedBy: string;
}): Invite {
  const now = new Date();
  const expires = new Date(now.getTime() + VALID_DAYS * 24 * 60 * 60 * 1000);

  const invite: Invite = {
    id: `inv${seq++}`,
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    role: input.role,
    title: input.title.trim(),
    department: input.department,
    teamIds: input.teamIds,
    link: `https://${academy.slug}.academias.pt/convite/${randomToken()}`,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    invitedBy: input.invitedBy,
  };

  state = [invite, ...state];
  emit();
  return invite;
}

/** Fechar um convite. O link deixa de valer — no servidor é `revokedAt`. */
export function revokeInvite(id: string): void {
  state = state.filter((i) => i.id !== id);
  emit();
}

/**
 * 32 bytes aleatórios em base64url — o mesmo tamanho que o servidor usa.
 *
 * `crypto.getRandomValues` e não `Math.random`: um token previsível é um convite
 * que se adivinha, e adivinhar um convite é entrar na academia.
 */
function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
