import { readSession, signOut } from "@/lib/session";

/**
 * O cliente HTTP do painel.
 *
 * Sem cabeçalho de academia — de propósito. Os pedidos daqui não pertencem a
 * nenhum tenant, e é o `PlatformGuard` do servidor que decide se quem pergunta é
 * dono disto. Ver `docs/04-plataforma.md`.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = readSession()?.accessToken;
  const res = await fetch(`${BASE}/api/platform${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  // Token expirado: cair para o login é a única saída útil. Repetir o pedido com
  // o mesmo token daria o mesmo erro para sempre.
  if (res.status === 401) {
    signOut();
    throw new ApiError(401, "A sessão expirou.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.message ?? mensagem(res.status));
  }
  return res.json() as Promise<T>;
}

export const apiGet = <T,>(path: string) => request<T>(path);
export const apiPost = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

function mensagem(status: number): string {
  if (status === 403) return "O teu papel não permite esta operação.";
  if (status === 409) return "Já existe.";
  if (status >= 500) return "O servidor não respondeu.";
  return "Não foi possível completar.";
}
