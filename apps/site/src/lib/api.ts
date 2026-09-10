/**
 * Onde está a API, para o site.
 *
 * O site é o único cliente que não tem sessão: fala com dois endpoints públicos
 * (o formulário de contacto e os documentos legais) e mais nada. Em produção
 * `VITE_API_URL` aponta para `api.academias.pt`; em desenvolvimento cai no
 * servidor local — e **só** em desenvolvimento: um build de produção sem a
 * variável apontava para o `localhost` do visitante, em silêncio.
 */
export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    throw new ApiError(res.status, parsed?.message ?? (res.status === 404 ? "Não encontrado." : "Não foi possível carregar."));
  }
  return (await res.json()) as T;
}
