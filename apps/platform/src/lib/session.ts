/**
 * A sessão do painel da plataforma.
 *
 * Chave própria no `sessionStorage` — `academias.platform` e não
 * `academia.session`. Não é detalhe: em produção o painel vive em
 * `admin.academias.pt` e uma academia em `clube.academias.pt`, origens diferentes
 * que nunca se cruzam. Mas em desenvolvimento partilham `localhost`, e uma chave
 * comum faria a sessão de um vazar para o outro — exactamente a confusão que o
 * resto da arquitectura existe para impedir.
 *
 * ## A sessão renova-se sozinha
 *
 * O token do Supabase dura **uma hora**, e o `refreshToken` era guardado aqui
 * sem nunca ser usado: ao fim de uma hora o painel caía no ecrã de entrada a
 * meio do trabalho. É o mesmo mecanismo da consola e da app das famílias — as
 * três apps a resolver isto de três maneiras seriam três maneiras de o ter
 * partido.
 *
 * `sessionStorage` mantém-se de propósito (ver acima): o painel é para uma
 * sessão de trabalho, não para ficar ligado num portátil partilhado.
 */
const KEY = "academias.platform";

export type PlatformSession = { accessToken: string; refreshToken: string };

export function readSession(): PlatformSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PlatformSession) : null;
  } catch {
    return null;
  }
}

export function writeSession(s: PlatformSession): void {
  sessionStorage.setItem(KEY, JSON.stringify(s));
}

/* -------------------------------------------------------------------------- */
/* Renovação                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Quando é que o token expira, segundo o próprio token.
 *
 * Lê-se o `exp` do JWT em vez de guardar a hora à parte: é o servidor que decide
 * a duração. Isto não valida nada — a assinatura é verificada no servidor,
 * sempre; aqui só se quer saber se vale a pena tentar.
 */
function expiresAt(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const exp = (JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Um minuto de folga: renovar no segundo exacto em que expira é chegar tarde. */
const SKEW_MS = 60_000;

/** Uma renovação de cada vez — o painel também abre vários pedidos em paralelo. */
let refreshing: Promise<string | null> | null = null;

/**
 * Porque é que o Supabase recusou a renovação — ou `null` se não recusou.
 *
 * Recusar é dizer que este refresh ou esta sessão já não valem. Um 409 (duas
 * renovações ao mesmo tempo), um 429 (pedidos a mais) ou outro 4xx qualquer não
 * dizem nada sobre a sessão — e qualquer 4xx terminava-a. O mesmo critério da
 * consola e da app do clube (ver o `lib/session.ts` delas).
 */
async function recusa(res: Response): Promise<string | null> {
  if (res.status !== 400 && res.status !== 401 && res.status !== 403) return null;
  const corpo = (await res.json().catch(() => null)) as {
    error_code?: string;
    error?: string;
    msg?: string;
    error_description?: string;
  } | null;
  const codigo = corpo?.error_code ?? corpo?.error ?? "";
  const texto = `${codigo} ${corpo?.msg ?? corpo?.error_description ?? ""}`;
  return /refresh.?token|session|invalid_grant|user_not_found|user_banned|bad_jwt/i.test(texto) ? codigo || "recusado" : null;
}

/**
 * Troca o refresh por um par novo.
 *
 * Só termina a sessão quando o Supabase **recusa** o refresh (ver `recusa`). Uma
 * falha de rede não põe ninguém na rua a meio de uma análise.
 *
 * Devolve `null` em dois casos: não havia sessão, ou acabou de ser recusada — e
 * aí já não há nada guardado, que é como o `lib/http.ts` distingue.
 */
export async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;

  const current = readSession();
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/$/, "");
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!current?.refreshToken || !url || !anon) return current?.accessToken ?? null;

  refreshing = (async () => {
    try {
      const res = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: anon, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: current.refreshToken }),
      });

      if (!res.ok) {
        // Recusado: o refresh já não vale, e aí a sessão acabou mesmo.
        if (await recusa(res)) {
          try {
            sessionStorage.removeItem(KEY);
          } catch {
            /* nada a limpar */
          }
          return null;
        }
        // 5xx, 409, 429… é avaria ou coincidência — o token velho segue enquanto durar.
        return readSession()?.accessToken ?? null;
      }

      const data = (await res.json()) as { access_token: string; refresh_token?: string };
      // O refresh roda a cada uso; guardar o novo é o que mantém a corrente viva.
      writeSession({ accessToken: data.access_token, refreshToken: data.refresh_token ?? current.refreshToken });
      return data.access_token;
    } catch {
      /* sem rede: fica como estava e tenta-se no pedido seguinte */
      return readSession()?.accessToken ?? null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/** O token para os pedidos, já renovado se estava a acabar. */
export async function getAccessToken(): Promise<string | null> {
  const current = readSession();
  if (!current) return null;

  const exp = expiresAt(current.accessToken);
  if (exp !== null && exp - SKEW_MS <= Date.now()) return refreshSession();

  return current.accessToken;
}

export function signOut(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* modo privado: já não havia nada */
  }
  window.location.reload();
}
