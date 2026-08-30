import { getAccessToken, readSession, refreshSession, signOut } from "@/lib/session";

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

/* -------------------------------------------------------------------------- */
/* Um pedido                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * O endereço de um pedido.
 *
 * `new URL` com o segundo argumento é o que faz isto sobreviver a `BASE` vazio:
 * em produção `BASE` é `""` (mesma origem — ver o cabeçalho acima) e
 * `${BASE}${path}` sai como um caminho relativo, que o construtor recusa sem uma
 * base. Um primeiro argumento absoluto ignora a base por completo, por isso em
 * desenvolvimento nada muda.
 */
function endereco(path: string, params?: Record<string, string | undefined>): URL {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  return url;
}

function enviar(url: URL, method: string, token: string | null, body?: unknown): Promise<Response> {
  return fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      "x-academy-slug": academySlug(),
      // O par do `x-app` da app da família: quem é treinador **e** pai entra
      // aqui como treinador. Ver `escolherMembership` na API.
      "x-app": "console",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/**
 * Um pedido à API, com a sessão tratada.
 *
 * ## Porque é que as cinco funções passaram a ser uma
 *
 * Eram cinco cópias do mesmo bloco — cabeçalhos, tratamento de erro, leitura do
 * corpo — e a renovação do token teria de entrar nas cinco. Cinco sítios para a
 * mesma regra é a garantia de que um deles fica para trás; e foi exactamente
 * isso que aconteceu com o `Content-Type`, que o `apiGet` e o `apiDelete` não
 * punham e os outros três punham.
 *
 * ## O 401, e a segunda tentativa
 *
 * O `getAccessToken()` já renova o que está a expirar, mas há um caso que a
 * validade não apanha: o relógio da máquina adiantado, um token revogado do
 * outro lado, uma sessão trocada noutro dispositivo. Nesses, o token parece bom
 * daqui e o servidor recusa-o na mesma. Renovar e repetir **uma** vez resolve-os
 * todos sem que ninguém dê por nada.
 *
 * Uma vez só, de propósito: se o pedido repetido também levar 401, o problema
 * não é o token estar velho, e insistir era um ciclo.
 */
async function pedir<T>(
  method: string,
  path: string,
  opts: { params?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<T> {
  const url = endereco(path, opts.params);
  const token = await getAccessToken();
  let res = await enviar(url, method, token, opts.body);

  if (res.status === 401 && token) {
    const renovado = await refreshSession();
    if (renovado && renovado !== token) res = await enviar(url, method, renovado, opts.body);
  }

  if (!res.ok) {
    const parsed = await res.json().catch(() => null);
    // `message` pode ser um array (validação do class-validator) — a mensagem do
    // servidor é a que interessa, porque diz o campo em falta ou a regra falhada.
    const msg = Array.isArray(parsed?.message) ? parsed.message.join("; ") : parsed?.message;

    /*
     * Depois de a renovação ter falhado, aí sim: a sessão acabou mesmo.
     *
     * E diz-se, em vez de deixar a consola às escuras. Era este o buraco: o
     * arranque engolia os 401 (ver `soft` em `lib/store.ts`), os ecrãs ficavam
     * vazios sem explicação nenhuma, e a pessoa recarregava a página a tentar
     * perceber. Agora quem já não tem sessão volta à porta do clube, que é onde
     * se entra.
     *
     * **Só quando havia token.** Nem todos os 401 são de sessão — o guard
     * também os devolve quando não consegue determinar a academia — e sem
     * sessão quem manda entrar é o `LoginGate`, à entrada. Sair daqui nesse
     * caso era um segundo reencaminhamento a competir com o primeiro, e o par
     * dava voltas.
     */
    if (res.status === 401 && token) signOut();

    throw new ApiError(res.status, msg ?? mensagem(res.status));
  }

  return readBody<T>(res);
}

export const apiGet = <T,>(path: string, params?: Record<string, string | undefined>) =>
  pedir<T>("GET", path, { params });

/** Escrita. A academia vem do mesmo sítio que na leitura — do subdomínio ou da sessão. */
export const apiPost = <T,>(path: string, body: unknown) => pedir<T>("POST", path, { body });

/** Alteração parcial. Mesma forma que `apiPost`, verbo diferente. */
export const apiPatch = <T,>(path: string, body: unknown) => pedir<T>("PATCH", path, { body });

/** Substituição do estado de um recurso. Mesma forma que `apiPost`, verbo diferente. */
export const apiPut = <T,>(path: string, body: unknown) => pedir<T>("PUT", path, { body });

/**
 * Eliminação. O recurso vai no caminho — e, quando é preciso, uma confirmação
 * no corpo.
 *
 * O corpo é a excepção e não a regra: serve o punhado de apagamentos que exigem
 * prova de intenção (escrever o nome da equipa para a apagar). Um DELETE com
 * corpo é legal em HTTP e é preferível a pendurar a confirmação na query, onde
 * ficaria escrita nos registos do servidor.
 */
export const apiDelete = <T,>(path: string, body?: unknown) => pedir<T>("DELETE", path, { body });

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
