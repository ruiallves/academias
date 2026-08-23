import { useSyncExternalStore } from "react";

/**
 * A sessão do pai.
 *
 * ## O que mudou, e porquê
 *
 * Isto era um atalho de desenvolvimento: a app entrava sozinha com uma conta de
 * teste para o push poder subscrever autenticado. Agora há contas a sério — o pai
 * chega pelo link do clube, cria a conta e identifica o educando (ver
 * `screens/Entrar.tsx`) — e o atalho desapareceu. Uma app que entra sozinha é uma
 * app onde nunca se testa o ecrã de entrada, e o ecrã de entrada é o primeiro que
 * qualquer pai vê.
 *
 * ## `localStorage` e não `sessionStorage`
 *
 * Porque isto é uma app instalada, não um separador. Um pai que abre o ícone de
 * manhã para ver se há treino não vai escrever a password outra vez; fazê-lo
 * escrever seria garantir que desinstala a app ao fim de uma semana.
 *
 * O que se guarda é o token do Supabase — o mesmo que a consola guarda, com o
 * mesmo alcance: sem ele não se lê nada, e o servidor continua a decidir tudo.
 */

const KEY = "academia.family.session";

type Stored = {
  accessToken: string;
  refreshToken?: string | null;
  /** Só para saudar quem entra. A autoridade sobre a identidade é sempre o token. */
  name?: string;
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

let snapshot: Stored | null = readStored();

function read(): Stored | null {
  return snapshot;
}

export function readToken(): string | null {
  return read()?.accessToken ?? null;
}

/**
 * O token para os pedidos.
 *
 * Continua assíncrono para não obrigar `http.ts` e `push.ts` a mudar — e porque a
 * renovação do token, quando existir, entra aqui sem tocar em mais lado nenhum.
 */
export async function getAccessToken(): Promise<string | null> {
  return readToken();
}

export function saveSession(session: { accessToken: string; refreshToken?: string | null; name?: string }): void {
  snapshot = session;
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* modo privado sem armazenamento: a sessão vive só até fechar */
  }
  emit();
}

export function signOut(): void {
  snapshot = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada a fazer — o passo seguinte é o ecrã de entrada na mesma */
  }
  emit();
}

/** Re-renderiza quem depende de haver sessão. É o que faz a app trocar de ecrã ao entrar. */
export function useSession(): Stored | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    () => null,
  );
}

/**
 * Entrar com email e palavra-passe.
 *
 * Fala directamente com o Supabase, como a consola e a landing — a nossa API não
 * intermedeia logins, e não deve: cada intermediário é mais um sítio por onde uma
 * password passa.
 */
export async function signIn(email: string, password: string): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) throw new Error("A app não está configurada para entrar.");

  const res = await fetch(`${url.replace(/\/$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
  });

  if (!res.ok) throw new Error("Email ou palavra-passe errados.");

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    user?: { user_metadata?: { name?: string } };
  };
  saveSession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    name: data.user?.user_metadata?.name,
  });
}
