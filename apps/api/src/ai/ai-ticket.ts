import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * O bilhete de ingestão — a autorização que o browser leva ao worker.
 *
 * ## Porque é que existe
 *
 * O vídeo de um jogo vai **direito ao worker**, sem passar pelo Supabase (ver
 * `ai-video.service.ts`, "O vídeo não fica guardado"). O browser fala com o
 * worker directamente, e o worker não tem sessão nem base de dados para
 * perguntar "quem é este e pode carregar isto?". A resposta vai com o pedido:
 * um bilhete assinado pela API, que o worker verifica sozinho.
 *
 * ## O que ele diz, e a quem
 *
 * Diz **que vídeo** (`v`), de que análise e academia (`a`, `ac`), com **que
 * tamanho e tipo** (`s`, `m`) e **até quando** (`e`). O tamanho vai no bilhete
 * de propósito: o worker recusa um byte a mais do que o anunciado, e um
 * bilhete de 4 GB não serve para despejar 40 num disco alheio.
 *
 * A chave é o `AI_WORKER_TOKEN` — o segredo que a API e o worker já partilham.
 * Não se inventa um segundo segredo para dizer a mesma coisa: quem tem o
 * token é worker, e é o worker que tem de acreditar no bilhete.
 *
 * ## O formato
 *
 * `base64url(JSON).base64url(HMAC-SHA256)`. Sem JWT: são cinco campos e uma
 * assinatura, e uma biblioteca de JWT traria `alg: none` e afins para uma
 * porta onde só há uma chave e um algoritmo.
 */

export type IngestTicket = {
  /** O vídeo. */
  v: string;
  /** A análise. */
  a: string;
  /** A academia. */
  ac: string;
  /** Tamanho anunciado, em bytes. */
  s: number;
  /** MIME anunciado. */
  m: string;
  /** Expiração — segundos Unix. */
  e: number;
};

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Um bilhete novo, válido `ttlSeconds` (24 h por omissão — um jogo numa ligação caseira demora). */
export function issueTicket(secret: string, ticket: Omit<IngestTicket, "e">, ttlSeconds = 24 * 3600): string {
  const payload = b64(JSON.stringify({ ...ticket, e: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${payload}.${sign(secret, payload)}`;
}

/** Lê e verifica. `null` = assinatura errada, formato errado ou caducado. */
export function verifyTicket(secret: string, token: string): IngestTicket | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = Buffer.from(sign(secret, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as IngestTicket;
    if (typeof parsed.v !== "string" || typeof parsed.e !== "number") return null;
    if (parsed.e < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}
