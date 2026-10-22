import { apiOrigin } from "@/lib/http";

/**
 * O leitor dos seguranças a falar com a API.
 *
 * ## Porque é que não passa pelo `http.ts`
 *
 * O segurança não tem conta. O `http.ts` existe para tratar da sessão de quem
 * tem: põe o token, renova-o no 401 e, quando a renovação falha, manda a
 * pessoa entrar na página do clube. Aqui nada disso serve, e uma parte
 * estragava: no telemóvel de alguém da direção, com a consola aberta, o 401 de
 * um PIN errado ia renovar a sessão da direção e trocar a frase do servidor
 * por "Não foi possível confirmar a sessão". O caso é o da recuperação da
 * palavra-passe na app do clube: endpoints públicos, de quem não tem conta.
 * Está na lista de excepções de `scripts/check-http-clients.mjs`.
 *
 * A "sessão" daqui é outra coisa: a que `POST /porta/entrar` devolve ao PIN
 * certo, assinada pelo servidor, que só serve para ler bilhetes daquele jogo
 * naquela porta. Ver `docs/09-bilheteira.md`, "Leitor dos seguranças".
 */

export type PortaEstado = {
  jogo: { startsAt: string; nome: string } | null;
  porta: { nome: string; bancadas: string[] };
  entradas: number;
};

export type PortaEntrada = PortaEstado & { sessao: string };

export type Resultado = "OK" | "ALREADY_USED" | "WRONG_GATE" | "WRONG_MATCH" | "VOID" | "INVALID" | "QUOTA_EM_ATRASO";

export type Leitura = {
  resultado: Resultado;
  ok: boolean;
  mensagem: string;
  bilhete: { tipo: string; bancada: string | null; lugar: string | null } | null;
};

/** A API respondeu com um erro. `status` 401 é a sessão da porta que acabou. */
export class PortaErro extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PortaErro";
  }
}

/** O pedido não chegou ao servidor, ou não voltou a tempo. Nada foi marcado. */
export class SemLigacao extends Error {
  constructor() {
    super("Sem ligação, tenta outra vez.");
    this.name = "SemLigacao";
  }
}

/**
 * O clube é o do endereço, e só o do endereço.
 *
 * A mesma regra do `academySlug` de `http.ts`, sem o primeiro passo: lá o slug
 * guardado na sessão vem antes, e aqui essa sessão é de outra pessoa (a de
 * quem tiver a consola aberta neste browser), possivelmente noutro clube. O
 * link do segurança abre em `{slug}.academias.pt`, e é esse o clube.
 */
function slugDoClube(): string {
  if (!import.meta.env.DEV) {
    const partes = window.location.hostname.split(".");
    if (partes.length >= 3 && partes[0] !== "www") return partes[0];
  }
  return (import.meta.env.VITE_ACADEMY_SLUG as string | undefined) ?? "life-club";
}

/**
 * Quanto se espera por uma resposta.
 *
 * À porta, uma rede que não responde é igual a não haver rede: o segurança não
 * pode ficar a olhar para um ecrã parado com uma fila à frente. Passado isto
 * diz-se "sem ligação" e ele tenta outra vez.
 */
const ESPERA_MS = 8000;

async function pedir<T>(caminho: string, corpo: unknown): Promise<T> {
  const controlo = new AbortController();
  const relogio = window.setTimeout(() => controlo.abort(), ESPERA_MS);
  let res: Response;
  try {
    res = await fetch(`${apiOrigin()}/api/clubes/${encodeURIComponent(slugDoClube())}/porta/${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      cache: "no-store",
      signal: controlo.signal,
    });
  } catch {
    throw new SemLigacao();
  } finally {
    window.clearTimeout(relogio);
  }

  const texto = await res.text().catch(() => "");
  let dados: unknown = null;
  try {
    dados = texto ? JSON.parse(texto) : null;
  } catch {
    /* Uma página de erro de um intermediário, não JSON: fica a mensagem por estado. */
  }

  if (!res.ok) {
    const m = (dados as { message?: unknown } | null)?.message;
    // A validação manda uma lista ("O PIN tem seis algarismos"); o resto, uma frase.
    const frase = Array.isArray(m) ? m.join("; ") : typeof m === "string" ? m : null;
    throw new PortaErro(res.status, mensagemDoErro(res.status, frase));
  }
  return dados as T;
}

function mensagemDoErro(status: number, frase: string | null): string {
  // O limite de pedidos responde em inglês ("Too Many Requests").
  if (status === 429) return "Demasiadas tentativas. Espera um minuto e tenta outra vez.";
  if (status >= 500) return "O servidor não respondeu. Tenta outra vez.";
  if (status === 404) return "Este clube não foi encontrado. Confirma o link.";
  return frase ?? "Não foi possível. Tenta outra vez.";
}

export const entrarNaPorta = (token: string, pin: string) => pedir<PortaEntrada>("entrar", { token, pin });
export const estadoDaPorta = (sessao: string) => pedir<PortaEstado>("estado", { sessao });
export const lerBilhete = (sessao: string, codigo: string) => pedir<Leitura>("ler", { sessao, codigo });

/* -------------------------------------------------------------------------- */
/* A sessão da porta, guardada no separador                                     */
/* -------------------------------------------------------------------------- */

/**
 * No `sessionStorage`, e presa ao link.
 *
 * Recarregar a página (ou a consola recarregar-se sozinha numa versão nova, ver
 * `vigiarVersao`) não pode obrigar a escrever o PIN outra vez a meio da
 * entrada do público. Fica presa ao token para que outro link aberto no mesmo
 * separador, de outra porta ou de outro jogo, não herde a sessão deste.
 */
const CHAVE = "academias.porta";

type Guardada = PortaEntrada & { token: string };

export function lerGuardada(token: string): PortaEntrada | null {
  try {
    const bruto = sessionStorage.getItem(CHAVE);
    if (!bruto) return null;
    const g = JSON.parse(bruto) as Guardada;
    return g.token === token && typeof g.sessao === "string" ? g : null;
  } catch {
    return null;
  }
}

export function guardar(token: string, entrada: PortaEntrada): void {
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ ...entrada, token } satisfies Guardada));
  } catch {
    /* Janela privada ou armazenamento cheio: ao recarregar pede-se o PIN outra vez. */
  }
}

export function esquecer(): void {
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    /* nada a limpar */
  }
}
