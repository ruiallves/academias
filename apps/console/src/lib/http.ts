import { readSession } from "@/lib/session";

/**
 * O cliente HTTP da consola.
 *
 * Um sítio só para falar com a API, pela mesma razão que `lib/api.ts` era um sítio
 * só para falar com os dados: quando o token expirar, quando a academia passar a
 * vir do subdomínio, quando for preciso repetir um pedido — muda-se aqui e mais
 * lado nenhum.
 *
 * ## De que academia é o pedido
 *
 * Em produção vem do subdomínio (`{slug}.academias.pt`), e o servidor lê-o do
 * `Host`. Em desenvolvimento o host é `localhost` e vai no cabeçalho
 * `x-academy-slug`. **O cabeçalho não é uma forma de escolher academia**: quem o
 * enviar continua a precisar de uma membership lá dentro, e é o servidor que
 * verifica isso. Sem essa verificação seria uma porta aberta.
 */

/**
 * Onde está a API.
 *
 * Vazio em produção — **a mesma origem**. A consola é servida pela própria API,
 * em `{clube}.academias.pt/consola`, e os pedidos vão para `{clube}.academias.pt/api`:
 * sem CORS, sem preflight, e sem uma variável de ambiente por clube.
 *
 * O fallback para `localhost:3000` é só de desenvolvimento, e está atrás do
 * `import.meta.env.DEV` de propósito: antes era o valor por omissão em qualquer
 * build, e um deploy sem `VITE_API_URL` saía com a consola a falar para o
 * `localhost` de quem a abrisse. Falhava em produção, em silêncio, no browser
 * do cliente.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

/**
 * A origem da API, para links que o browser abre directamente.
 *
 * Páginas servidas pelo servidor — a página do clube, a inscrição de sócio — não
 * passam por `fetch`: são endereços que se abrem num separador. Em produção a API
 * e a consola partilham origem e um caminho relativo bastava; em desenvolvimento
 * estão em portas diferentes, e um `/l/clube/sersocio` relativo aterrava no Vite,
 * que devolve a própria consola. Era esse o motivo de a página de inscrição não
 * abrir.
 */
export function apiOrigin(): string {
  return BASE.replace(/\/$/, "");
}

/** Erro com o estado HTTP à vista, para a UI poder distinguir 403 de 500. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * O corpo da resposta, quando há corpo.
 *
 * Nem toda a resposta com sucesso traz JSON. Um endpoint que responde `null` — "não
 * há link de convite vivo", que é uma resposta legítima e não um erro — sai do Nest
 * como um 200 **sem corpo nenhum**, e o mesmo vale para os 204. `res.json()` nesses
 * casos rebenta com "Unexpected end of JSON input", que é uma mensagem sobre o
 * parser e não sobre o que se passou.
 *
 * Ler o texto primeiro e só depois interpretar custa nada e faz a ausência de corpo
 * ser o que é: ausência, não avaria.
 */
async function readBody<T>(res: Response): Promise<T> {
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function academySlug(): string {
  const stored = readSession()?.academySlug;
  if (stored) return stored;

  const { hostname } = window.location;
  const parts = hostname.split(".");
  if (parts.length >= 3 && parts[0] !== "www") return parts[0];

  return (import.meta.env.VITE_ACADEMY_SLUG as string | undefined) ?? "life-club";
}

export async function apiGet<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const token = readSession()?.accessToken;
  const res = await fetch(url, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": academySlug(),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.message ?? mensagem(res.status));
  }

  return readBody<T>(res);
}

/** Escrita. A academia vem do mesmo sítio que na leitura — do subdomínio ou da sessão. */
export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const token = readSession()?.accessToken;
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": academySlug(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    // A mensagem do servidor é a que interessa — diz o campo em falta ou a regra
    // que falhou. `message` pode ser um array (validação do class-validator).
    const msg = Array.isArray(parsed?.message) ? parsed.message.join("; ") : parsed?.message;
    throw new ApiError(res.status, msg ?? mensagem(res.status));
  }

  return readBody<T>(res);
}

/** Alteração parcial. Mesma forma que `apiPost`, verbo diferente. */
export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const token = readSession()?.accessToken;
  const res = await fetch(`${BASE}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": academySlug(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    const msg = Array.isArray(parsed?.message) ? parsed.message.join("; ") : parsed?.message;
    throw new ApiError(res.status, msg ?? mensagem(res.status));
  }

  return readBody<T>(res);
}

/** Substituição do estado de um recurso. Mesma forma que `apiPost`, verbo diferente. */
export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const token = readSession()?.accessToken;
  const res = await fetch(`${BASE}${path}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": academySlug(),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    const msg = Array.isArray(parsed?.message) ? parsed.message.join("; ") : parsed?.message;
    throw new ApiError(res.status, msg ?? mensagem(res.status));
  }

  return readBody<T>(res);
}

/** Eliminação. Sem corpo — o recurso vai no caminho. */
export async function apiDelete<T>(path: string): Promise<T> {
  const token = readSession()?.accessToken;
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": academySlug(),
    },
  });

  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    const msg = Array.isArray(parsed?.message) ? parsed.message.join("; ") : parsed?.message;
    throw new ApiError(res.status, msg ?? mensagem(res.status));
  }

  return readBody<T>(res);
}

/**
 * Mensagens por estado.
 *
 * Ditas na língua de quem as lê, e não "Request failed with status code 403".
 * A distinção entre 401 e 403 importa ao utilizador: uma resolve-se entrando outra
 * vez, a outra não se resolve sozinha e tem de se falar com a direção.
 */
function mensagem(status: number): string {
  if (status === 401) return "A sessão expirou. Volta a entrar.";
  if (status === 403) return "Não tens acesso a esta informação.";
  if (status === 404) return "Não encontrado.";
  if (status >= 500) return "O servidor não respondeu. Tenta outra vez daqui a pouco.";
  return "Não foi possível carregar.";
}
