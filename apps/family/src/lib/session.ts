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
 *
 * ## A sessão renova-se sozinha
 *
 * O token de acesso do Supabase dura **uma hora**. O `refreshToken` já era
 * guardado aqui desde sempre e nunca era usado — resultado: ao fim de uma hora
 * todos os pedidos voltavam 401, a app fazia `signOut()` e o pai tinha de
 * escrever a password outra vez. Para quem abre a app duas vezes por semana, isso
 * era escrever a password *sempre*.
 *
 * Agora `getAccessToken()` verifica a validade antes de entregar o token e
 * troca-o por um novo quando está a acabar. O refresh do Supabase dura meses e
 * renova-se a cada uso, por isso uma app aberta de vez em quando mantém-se ligada
 * indefinidamente. Só se volta a pedir a password quando o próprio refresh for
 * recusado — palavra-passe mudada noutro sítio, conta apagada, ou meses sem abrir
 * a app.
 *
 * ## Uma sessão viva nunca se deita fora
 *
 * A renovação existia e as pessoas continuavam a cair no ecrã de entrada sem
 * terem saído. O Supabase não matava a sessão: éramos nós que a largávamos, em
 * três situações em que ela continuava boa. É o mesmo texto, e a mesma
 * correcção, do `lib/session.ts` da consola.
 *
 *  1. **Uma cópia velha do refresh.** A sessão guardava-se em memória ao abrir
 *     e nunca mais se olhava para o armazenamento: se outra janela desta app
 *     (a instalada e a do browser, por exemplo) ou a consola (ver
 *     `KEY_DA_CONSOLA`) rodassem o refresh, esta ficava com o antigo, e ao fim
 *     de duas rodas o Supabase recusava-o — com a sessão viva ao lado. Agora
 *     lê-se sempre o par mais novo que estiver guardado (`fresca`), e uma
 *     recusa confirma-se com o que lá estiver antes de se desistir.
 *  2. **Uma resposta que não é uma recusa.** Qualquer 4xx do Supabase terminava
 *     a sessão, incluindo o 409 de duas renovações ao mesmo tempo e o 429 de
 *     pedidos a mais. Só termina o que diz que o refresh ou a sessão já não
 *     valem (`recusa`).
 *  3. **Um 401 da nossa API com a sessão boa.** Ver `lib/http.ts`.
 */

const KEY = "academia.family.session";

/**
 * A chave da consola, que em produção vive nesta mesma origem.
 *
 * Quando a conta é a mesma, é a mesma sessão guardada em dois sítios: quem é
 * staff e pai passa de uma app à outra com o mesmo par (ver `lib/handoff.ts` e o
 * `lib/app-contexts.ts` da consola). Lê-se aqui para nunca renovar com uma cópia
 * mais velha do que a que a consola já tem.
 */
const KEY_DA_CONSOLA = "academia.session";

/** Onde fica escrito porque é que a última sessão acabou sem ninguém a terminar. */
const KEY_DO_FIM = "academia.sessao.fim";

type Stored = {
  accessToken: string;
  refreshToken?: string | null;
  /** Só para saudar quem entra. A autoridade sobre a identidade é sempre o token. */
  name?: string;
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** O que o token diz de si: de quem é, quando foi emitido e até quando vale. */
function claims(token: string): { sub?: string; iat?: number; exp?: number } | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string; iat?: number; exp?: number };
  } catch {
    return null;
  }
}

function mesmaConta(a: string, b: string): boolean {
  const sub = claims(a)?.sub;
  return Boolean(sub) && sub === claims(b)?.sub;
}

/** `outro` é da mesma conta que `este` e foi emitido depois. */
function maisNovo(este: string, outro: string): boolean {
  const a = claims(este)?.iat;
  const b = claims(outro)?.iat;
  return mesmaConta(este, outro) && typeof a === "number" && typeof b === "number" && b > a;
}

/** O par que a consola tem guardado nesta origem, se tiver algum completo. */
function lerDaConsola(): { accessToken: string; refreshToken: string } | null {
  try {
    const raw = localStorage.getItem(KEY_DA_CONSOLA);
    const p = raw ? (JSON.parse(raw) as { accessToken?: string; refreshToken?: string | null }) : null;
    return p?.accessToken && p.refreshToken ? { accessToken: p.accessToken, refreshToken: p.refreshToken } : null;
  } catch {
    return null;
  }
}

/**
 * A sessão como está guardada, com o par mais novo que houver nesta origem.
 *
 * Se a consola tiver a mesma conta com um token emitido depois, é esse o par
 * vivo — o daqui é a cópia que envelheceu enquanto a consola trabalhava.
 * Fica-se com ele e guarda-se, para as duas chaves voltarem a dizer o mesmo.
 *
 * Só da mesma conta. Um telemóvel com um pai na app e um treinador na consola
 * tem duas sessões de duas pessoas, e nenhuma delas toma o lugar da outra.
 */
function readStored(): Stored | null {
  let guardada: Stored | null;
  try {
    const raw = localStorage.getItem(KEY);
    guardada = raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    // Sem armazenamento, a sessão é a que está em memória (ver `saveSession`).
    return snapshot;
  }
  if (!guardada) return null;

  const daConsola = lerDaConsola();
  if (!daConsola || !maisNovo(guardada.accessToken, daConsola.accessToken)) return guardada;

  const adoptada = { ...guardada, ...daConsola };
  try {
    localStorage.setItem(KEY, JSON.stringify(adoptada));
  } catch {
    /* sem armazenamento: vale para esta leitura */
  }
  return adoptada;
}

let snapshot: Stored | null = null;
snapshot = readStored();

function read(): Stored | null {
  return snapshot;
}

/**
 * A sessão tal como está guardada **agora**, e não como estava ao abrir.
 *
 * O `snapshot` é o que o React desenha, e tem de ser estável entre renders. Mas
 * para renovar interessa o que está no armazenamento neste instante: outra
 * janela desta app, ou a consola, podem ter rodado o refresh entretanto. Se
 * mudou, o `snapshot` acompanha e quem desenha é avisado.
 */
function fresca(): Stored | null {
  const guardada = readStored();
  if (guardada?.accessToken !== snapshot?.accessToken || guardada?.refreshToken !== snapshot?.refreshToken) {
    snapshot = guardada;
    emit();
  }
  return guardada;
}

/*
 * E quando é outra janela a mexer — entrar, sair, renovar —, esta fica a saber
 * na hora, em vez de só no pedido seguinte. O evento `storage` só chega às
 * outras janelas da mesma origem, nunca à que escreveu.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null || e.key === KEY || e.key === KEY_DA_CONSOLA) fresca();
  });
}

export function readToken(): string | null {
  return read()?.accessToken ?? null;
}

/**
 * A sessão inteira, para a entregar a outra app.
 *
 * Só a `lib/handoff.ts` precisa disto: a consola quer o par completo (acesso e
 * renovação), e não só o token de acesso que `readToken` dá a toda a gente. Vai
 * a fresca: entregar um par que já envelheceu era pôr a consola a renovar com
 * um refresh que o Supabase recusa.
 */
export function readStoredSession(): Stored | null {
  return fresca();
}

/**
 * Recebe uma sessão entregue no fragmento do URL (`#s=…`).
 *
 * É o caminho de volta da consola em desenvolvimento, onde as duas apps vivem
 * em portas diferentes e o `localStorage` de uma não se vê da outra. Em
 * produção partilham a origem e a consola escreve directamente na chave desta
 * app — este código nunca chega a correr. O mesmo desenho, e o mesmo formato,
 * do `adoptSessionFromUrl` da consola.
 *
 * O fragmento nunca vai ao servidor, e sai do URL no instante em que é lido.
 */
export function adoptSessionFromUrl(): void {
  const hash = window.location.hash;
  if (!hash.startsWith("#s=")) return;
  try {
    const parsed = JSON.parse(atob(decodeURIComponent(hash.slice(3)))) as Partial<Stored>;
    if (parsed.accessToken) {
      saveSession({ accessToken: parsed.accessToken, refreshToken: parsed.refreshToken ?? null, name: parsed.name });
    }
  } catch {
    /* ilegível: fica como estava */
  } finally {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}

/* -------------------------------------------------------------------------- */
/* Renovação                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Quando é que o token expira, segundo o próprio token.
 *
 * Lê-se o `exp` do JWT em vez de guardar a hora à parte: é o servidor que decide
 * a duração, e um número guardado por nós ficava errado no dia em que essa
 * duração mudasse. Isto não é validação nenhuma — a assinatura é verificada no
 * servidor, sempre; aqui só se quer saber se vale a pena tentar.
 */
function expiresAt(token: string): number | null {
  const exp = claims(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
}

/*
 * Um minuto de folga.
 *
 * Renovar no segundo exacto em que expira é chegar tarde: o pedido ainda demora a
 * viajar, e o relógio de um telemóvel raramente está ao segundo com o do
 * servidor. Um minuto cobre as duas coisas sem andar a renovar à toa.
 */
const SKEW_MS = 60_000;

/*
 * Uma renovação de cada vez.
 *
 * O arranque da app dispara uma dúzia de pedidos em paralelo (ver `lib/store.ts`).
 * Sem isto, todos viam o token expirado e pediam a sua própria renovação: uma
 * dúzia de idas ao Supabase para obter a mesma coisa. Todos esperam pela mesma.
 *
 * O Supabase **roda** o refresh a cada uso e continua a aceitar o imediatamente
 * anterior; o de há duas rodas já é recusado (medido neste projecto:
 * `refresh_token_already_used`). É por isso que `refreshSession` confirma uma
 * recusa com o que está guardado antes de dar a sessão por acabada.
 */
let refreshing: Promise<string | null> | null = null;

function supabaseConfig(): { url: string; anon: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anon ? { url: url.replace(/\/$/, ""), anon } : null;
}

/**
 * Porque é que o Supabase recusou a renovação — ou `null` se não recusou.
 *
 * Recusar é dizer que **este refresh ou esta sessão já não valem**: usado há
 * demasiado tempo, sessão terminada, conta apagada ou suspensa. Só isso acaba
 * com a sessão.
 *
 * Um 409 (duas renovações da mesma sessão ao mesmo tempo), um 429 (pedidos a
 * mais) ou outro 4xx qualquer não dizem nada sobre a sessão, e tratá-los como
 * recusa era pôr um pai no ecrã de entrada por causa de uma coincidência. O
 * token velho segue, e o pedido seguinte tenta outra vez.
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
 * A sessão acabou sem ninguém a terminar.
 *
 * Fica escrito porquê (`KEY_DO_FIM`): "a app pediu-me para entrar outra vez"
 * passa a ter uma resposta que se lê no próprio telemóvel, em vez de um padrão
 * para adivinhar.
 *
 * A cópia da consola só sai se for desta conta — é a mesma sessão, e está tão
 * acabada como esta. A de outra pessoa não tem nada a ver com isto.
 */
function terminarPorRecusa(motivo: string): void {
  const acabada = snapshot;
  snapshot = null;
  try {
    localStorage.removeItem(KEY);
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("academia.app.contexto")) localStorage.removeItem(k);
    }
    const daConsola = lerDaConsola();
    if (acabada && daConsola && mesmaConta(acabada.accessToken, daConsola.accessToken)) {
      localStorage.removeItem(KEY_DA_CONSOLA);
    }
    localStorage.setItem(KEY_DO_FIM, JSON.stringify({ quando: new Date().toISOString(), motivo, app: "app" }));
  } catch {
    /* nada a fazer — o passo seguinte é o ecrã de entrada na mesma */
  }
  emit();
}

/**
 * Troca o refresh por um par novo.
 *
 * Só termina a sessão quando o Supabase **recusa** o refresh (ver `recusa`).
 * Uma falha de rede não desliga ninguém: um pai dentro de um pavilhão sem
 * cobertura não pode perder a sessão por isso, e o token velho ainda pode servir
 * mais uns minutos.
 *
 * E mesmo uma recusa confirma-se: se entretanto outra janela, ou a consola,
 * guardou um refresh diferente, o recusado era a cópia velha e o que conta é o
 * que lá está agora. Tenta-se uma vez com esse antes de desistir.
 */
export async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;

  const current = fresca();
  const config = supabaseConfig();
  if (!current || !config) return current?.accessToken ?? null;

  if (!current.refreshToken) {
    /*
     * Sem refresh não há como renovar. Enquanto o token de acesso valer,
     * usa-se; depois disso a sessão acabou, e dizê-lo é melhor do que deixar a
     * app a levar 401 em todos os pedidos sem saída nenhuma.
     */
    const exp = expiresAt(current.accessToken);
    if (exp !== null && exp <= Date.now()) {
      terminarPorRecusa("sem_refresh");
      return null;
    }
    return current.accessToken;
  }

  refreshing = (async () => {
    try {
      let token = current.refreshToken as string;
      for (let tentativa = 1; ; tentativa++) {
        const res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { apikey: config.anon, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: token }),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            access_token: string;
            refresh_token?: string;
            user?: { user_metadata?: { name?: string } };
          };

          saveSession({
            accessToken: data.access_token,
            refreshToken: data.refresh_token ?? token,
            // O nome vem do que já cá estava quando o refresh não o traz: perdê-lo
            // trocava a saudação da abertura por um espaço vazio.
            name: data.user?.user_metadata?.name ?? current.name,
          });

          return data.access_token;
        }

        const motivo = await recusa(res);
        // Não é uma recusa (5xx, 409, 429…): o token velho segue enquanto durar.
        if (!motivo) return fresca()?.accessToken ?? null;

        // Recusado — mas pode ter sido só a cópia velha. O que está guardado agora?
        const agora = fresca()?.refreshToken;
        if (tentativa === 1 && agora && agora !== token) {
          token = agora;
          continue;
        }

        // Aqui sim, a sessão acabou mesmo.
        terminarPorRecusa(motivo);
        return null;
      }
    } catch {
      /* sem rede: fica como estava e tenta-se no pedido seguinte */
      return read()?.accessToken ?? null;
    } finally {
      refreshing = null;
    }
  })();

  return refreshing;
}

/**
 * O token para os pedidos, já renovado se estava a acabar.
 *
 * É por aqui que passam `http.ts` e `push.ts`, e é por isso que a renovação vive
 * aqui: nenhum dos dois precisa de saber que os tokens expiram.
 */
export async function getAccessToken(): Promise<string | null> {
  const current = fresca();
  if (!current) return null;

  const exp = expiresAt(current.accessToken);
  if (exp !== null && exp - SKEW_MS <= Date.now()) return refreshSession();

  return current.accessToken;
}

/* -------------------------------------------------------------------------- */

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
    /*
     * A escolha de contexto sai com a sessão — pelo prefixo, e não pelo módulo:
     * importar `lib/contexts` daqui fechava um ciclo (contexts → http → session).
     * A conta seguinte não tem de herdar a área em que a anterior ficou.
     */
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("academia.app.contexto")) localStorage.removeItem(k);
    }
    /*
     * E a sessão da consola, que vive na mesma origem. Quem é treinador e pai
     * entrou uma vez e a sessão foi entregue às duas apps (ver `lib/handoff.ts`);
     * "terminar sessão" tem de terminar nas duas, senão sair daqui deixava a
     * consola aberta a quem pegasse no telemóvel a seguir.
     */
    localStorage.removeItem(KEY_DA_CONSOLA);
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
  const config = supabaseConfig();
  if (!config) throw new Error("A app não está configurada para entrar.");

  const res = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.anon, "Content-Type": "application/json" },
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
