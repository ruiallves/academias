import { getAccessToken, refreshSession, signOut } from "@/lib/session";
import { academySlug } from "@/lib/invite";

/**
 * O cliente HTTP da app da família.
 *
 * Em produção a app e a API vivem na mesma origem e `API` fica vazio; em
 * desenvolvimento o Vite faz proxy de `/api` para a API local (ver
 * `vite.config.ts`), o que também deixa a app funcionar atrás de um túnel HTTPS
 * sem mixed content nem CORS.
 *
 * A academia vai no cabeçalho e não no caminho: é o mesmo `x-academy-slug` que a
 * consola usa, e o servidor resolve o tenant a partir dele mais a sessão.
 */
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(path: string, method: string, token: string | null, body?: unknown): Promise<Response> {
  return fetch(`${API}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      // Já não é uma constante do build: um pai que chegou pelo link de um clube
      // ficou com o slug desse clube guardado (ver `lib/invite.ts`). Em produção o
      // subdomínio diz o mesmo, e continua a ser o servidor que verifica se esta
      // pessoa tem alguma coisa lá dentro.
      "x-academy-slug": academySlug(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = await getAccessToken();
  let res = await send(path, method, token, body);

  /*
   * Um 401 merece uma segunda tentativa antes de mandar o pai para o ecrã de
   * entrada.
   *
   * O `getAccessToken()` já renova o que está a expirar, mas há um caso que a
   * validade não apanha: o relógio do telemóvel adiantado, um token revogado do
   * outro lado, uma sessão trocada noutro dispositivo. Nesses, o token parece bom
   * daqui e o servidor recusa-o na mesma. Renovar e repetir **uma** vez resolve-os
   * todos sem que ninguém dê por nada.
   *
   * Uma vez só, de propósito: se o pedido repetido também levar 401, o problema
   * não é o token estar velho, e insistir era um ciclo.
   */
  if (res.status === 401 && token) {
    const renewed = await refreshSession();
    if (renewed && renewed !== token) res = await send(path, method, renewed, body);
  }

  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    const msg = Array.isArray(parsed?.message) ? parsed.message.join("; ") : parsed?.message;
    // Depois da renovação ter falhado, aí sim: a sessão acabou mesmo.
    if (res.status === 401) signOut();
    throw new ApiError(res.status, msg ?? mensagem(res.status));
  }

  // 204 e afins não trazem corpo — devolver `undefined` é melhor do que rebentar
  // no `json()`.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {});
export const apiPatch = <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {});

/**
 * Um pedido que pode ser recusado sem ser uma avaria.
 *
 * Um 403 aqui é o âmbito a funcionar — uma família que não tenha determinada
 * leitura recebe lista vazia, e a app continua a abrir em vez de morrer num ecrã
 * de erro por causa de uma secção secundária.
 */
export async function soft<T>(path: string): Promise<T[]> {
  try {
    return (await apiGet<T[]>(path)) ?? [];
  } catch {
    return [];
  }
}

function mensagem(status: number): string {
  if (status === 401) return "A sessão expirou. Volta a entrar pela página da academia.";
  if (status === 403) return "Sem acesso a esta informação.";
  if (status === 404) return "Não encontrado.";
  if (status >= 500) return "O servidor não respondeu como devia. Tenta daqui a pouco.";
  return "Não foi possível concluir.";
}
