import { getAccessToken, refreshSession, signOut } from "@/lib/session";

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

function enviar(path: string, token: string | null, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}/api/platform${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  let res = await enviar(path, token, init);

  /*
   * Um 401 merece uma segunda tentativa antes de mandar alguém para o login.
   *
   * O `getAccessToken()` já renova o que está a expirar; o que sobra são os
   * casos que a validade não vê — relógio adiantado, token revogado do outro
   * lado. Renovar e repetir **uma** vez resolve-os sem que ninguém dê por nada.
   * Uma vez só: se o repetido também falhar, o problema não é o token estar
   * velho, e insistir era um ciclo.
   *
   * Dizia aqui que "repetir com o mesmo token daria o mesmo erro para sempre" —
   * verdade, e é por isso que se repete com um **novo**.
   */
  if (res.status === 401 && token) {
    const renovado = await refreshSession();
    if (renovado && renovado !== token) res = await enviar(path, renovado, init);
  }

  // Depois da renovação ter falhado, aí sim: cair para o login é a saída útil.
  if (res.status === 401) {
    signOut();
    throw new ApiError(401, "A sessão expirou.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.message ?? mensagem(res.status));
  }
  // Nem toda a resposta com sucesso traz corpo: um `null` devolvido por um handler
  // do Nest sai como 200 vazio, e `res.json()` rebentaria com "Unexpected end of
  // JSON input" — uma mensagem sobre o parser, não sobre o que se passou.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const apiGet = <T,>(path: string) => request<T>(path);
export const apiPost = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });
export const apiPatch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
/**
 * Apagar.
 *
 * Aceita corpo, ao contrário do que é habitual num `DELETE`: apagar um clube
 * exige o endereço dele escrito à mão, e essa confirmação vai no corpo. Pô-la na
 * query deixava o nome do clube a apagar em todos os logs de acesso pelo
 * caminho.
 */
export const apiDelete = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: "DELETE", ...(body ? { body: JSON.stringify(body) } : {}) });

function mensagem(status: number): string {
  if (status === 403) return "O teu papel não permite esta operação.";
  if (status === 409) return "Já existe.";
  if (status >= 500) return "O servidor não respondeu.";
  return "Não foi possível completar.";
}
