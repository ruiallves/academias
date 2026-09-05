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
 */

const KEY = "academia.family.session";

type Stored = {
  accessToken: string;
  refreshToken?: string | null;
  /** Só para saudar quem entra. A autoridade sobre a identidade é sempre o token. */
  name?: string;
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readStored(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

let snapshot: Stored | null = readStored();

function read(): Stored | null {
  return snapshot;
}

export function readToken(): string | null {
  return read()?.accessToken ?? null;
}

/**
 * A sessão inteira, para a entregar a outra app.
 *
 * Só a `lib/handoff.ts` precisa disto: a consola quer o par completo (acesso e
 * renovação), e não só o token de acesso que `readToken` dá a toda a gente.
 */
export function readStoredSession(): Stored | null {
  return read();
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
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
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
 * Sem isto, todos viam o token expirado e pediam a sua própria renovação — e como
 * o Supabase **roda** o refresh a cada uso, a primeira invalidava as restantes e a
 * app caía no ecrã de entrada por excesso de zelo. Todos esperam pela mesma.
 */
let refreshing: Promise<string | null> | null = null;

function supabaseConfig(): { url: string; anon: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anon ? { url: url.replace(/\/$/, ""), anon } : null;
}

/**
 * Troca o refresh por um par novo.
 *
 * Só termina a sessão quando o Supabase **recusa** o refresh. Uma falha de rede
 * não desliga ninguém: um pai dentro de um pavilhão sem cobertura não pode perder
 * a sessão por isso, e o token velho ainda pode servir mais uns minutos.
 */
export async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;

  const current = read();
  const token = current?.refreshToken;
  const config = supabaseConfig();
  if (!current || !token || !config) return current?.accessToken ?? null;

  refreshing = (async () => {
    try {
      const res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: config.anon, "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: token }),
      });

      if (!res.ok) {
        // Recusado: o refresh já não vale. Aqui sim, a sessão acabou mesmo.
        if (res.status >= 400 && res.status < 500) {
          signOut();
          return null;
        }
        // 5xx é avaria do lado de lá — o token velho segue enquanto durar.
        return read()?.accessToken ?? null;
      }

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
  const current = read();
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
    localStorage.removeItem("academia.session");
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
