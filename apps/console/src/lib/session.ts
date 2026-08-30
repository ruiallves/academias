import { academy } from "@/lib/api";

/**
 * A sessão vinda da página de entrada da academia.
 *
 * A landing autentica-se contra o Supabase e guarda aqui o token antes de
 * encaminhar para a consola. Em produção as duas vivem na mesma origem
 * (`{slug}.academias.pt`), o que a faz atravessar; em desenvolvimento estão em
 * portas diferentes e há uma entrega explícita — ver `adoptSessionFromUrl`.
 *
 * ## Porquê `localStorage` e não `sessionStorage`
 *
 * Porque `sessionStorage` é **por separador**, e isso partia todos os links da
 * consola. Abrir a ficha de um sócio num separador novo — ou colar o endereço a
 * um colega, que é para isso que uma ficha tem endereço — dava uma sessão vazia e
 * um reencaminhamento para a página de entrada. Um produto onde os links só
 * funcionam no separador onde se entrou não tem links, tem ecrãs.
 *
 * ## O que isto custa
 *
 * `localStorage` sobrevive a fechar o browser; `sessionStorage` morria com o
 * separador. Alarga a janela em que um token roubado por XSS continua útil — e é
 * por isso que `VULN-004` (o XSS armazenado na página de convite) teve de ser
 * fechado primeiro. A correcção definitiva continua a ser a mesma que a auditoria
 * já aponta em `VULN-007`: cookie `httpOnly`, que exige repensar a entrega
 * landing→consola e é trabalho à parte.
 *
 * Quem quiser a sessão presa ao separador tem "Terminar sessão" — que agora limpa
 * mesmo, em vez de a deixar viva nos outros.
 *
 * ## A sessão renova-se sozinha
 *
 * O token de acesso do Supabase dura **uma hora**. O `refreshToken` era guardado
 * aqui desde sempre e nunca era usado — e o resultado aparecia todos os dias a
 * quem tem a consola aberta ao trabalho: ao fim de uma hora, cada pedido voltava
 * 401, o arranque engolia-os em silêncio (ver `soft` em `lib/store.ts`), os ecrãs
 * ficavam vazios sem explicação, e a pessoa recarregava a página para perceber o
 * que se passava — para depois ser mandada entrar outra vez.
 *
 * Agora `getAccessToken()` verifica a validade antes de entregar o token e
 * troca-o por um novo quando está a acabar. O refresh do Supabase dura meses e
 * renova-se a cada uso, por isso uma consola aberta todos os dias mantém-se
 * ligada indefinidamente. Só se volta à página de entrada quando o próprio
 * refresh for recusado: password mudada noutro sítio, conta desactivada, ou
 * meses sem abrir.
 *
 * É a mesma solução que a app das famílias já tinha (`apps/family/src/lib/
 * session.ts`) — de propósito. Duas apps a resolver o mesmo problema de duas
 * maneiras são duas maneiras de o ter partido.
 */

const KEY = "academia.session";

/**
 * Onde a sessão vive.
 *
 * Uma função e não uma constante para o modo privado não rebentar à importação:
 * em alguns browsers o simples acesso a `localStorage` atira, e isso mataria a
 * consola antes do primeiro pixel.
 */
function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  academySlug: string;
};

export function readSession(): StoredSession | null {
  try {
    // `sessionStorage` fica como leitura de recurso: quem já tinha a consola
    // aberta quando isto mudou continua com a sessão onde ela estava, em vez de
    // ser posto na rua a meio do dia de trabalho.
    const raw = store()?.getItem(KEY) ?? sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
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
 * Renovar no segundo exacto em que expira é chegar tarde: o pedido ainda demora
 * a viajar, e o relógio de um portátil raramente está ao segundo com o do
 * servidor. Um minuto cobre as duas coisas sem andar a renovar à toa.
 */
const SKEW_MS = 60_000;

/*
 * Uma renovação de cada vez.
 *
 * O arranque da consola dispara nove pedidos em paralelo (ver `loadAcademy`).
 * Sem isto, todos veriam o token a expirar e pediriam a sua própria renovação:
 * nove idas ao Supabase para obter a mesma coisa, e nove escritas a competir
 * pelo mesmo espaço no armazenamento.
 *
 * O Supabase **roda** o refresh a cada uso e tolera a reutilização do anterior
 * durante uns segundos — é o que hoje impede essa corrida de deitar a sessão
 * fora. Mas essa janela é configuração do projecto e pode ser zero amanhã;
 * depender dela seria construir sobre uma definição que ninguém aqui controla.
 * Todos esperam pela mesma renovação, e a questão não se põe.
 */
let refreshing: Promise<string | null> | null = null;

function supabaseConfig(): { url: string; anon: string } | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  return url && anon ? { url: url.replace(/\/$/, ""), anon } : null;
}

/** Grava o par novo, mantendo a academia — o slug não vem no refresh. */
function saveTokens(accessToken: string, refreshToken: string): void {
  const slug = readSession()?.academySlug ?? "";
  const valor = JSON.stringify({ accessToken, refreshToken, academySlug: slug });
  try {
    store()?.setItem(KEY, valor);
  } catch {
    /* modo privado: a sessão renovada vale para esta página e mais nada */
  }
}

/**
 * Troca o refresh por um par novo.
 *
 * Só termina a sessão quando o Supabase **recusa** o refresh. Uma falha de rede
 * não desliga ninguém: um clube com internet a oscilar não pode perder a sessão
 * por isso, e o token velho ainda pode servir mais uns minutos.
 */
export async function refreshSession(): Promise<string | null> {
  if (refreshing) return refreshing;

  const current = readSession();
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
        // Recusado: o refresh já não vale. Aqui sim, a sessão acabou mesmo — e
        // quem chamou trata de mandar entrar (ver `request` em `lib/http.ts`).
        if (res.status >= 400 && res.status < 500) {
          clearSession();
          return null;
        }
        // 5xx é avaria do lado de lá — o token velho segue enquanto durar.
        return readSession()?.accessToken ?? null;
      }

      const data = (await res.json()) as { access_token: string; refresh_token?: string };
      // O refresh roda a cada uso; guardar o novo é o que mantém a corrente viva.
      saveTokens(data.access_token, data.refresh_token ?? token);
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

/**
 * O token para os pedidos, já renovado se estava a acabar.
 *
 * É por aqui que passa o `lib/http.ts` inteiro, e é por isso que a renovação
 * vive aqui: nenhuma das cinco funções de pedido precisa de saber que os tokens
 * expiram.
 */
export async function getAccessToken(): Promise<string | null> {
  const current = readSession();
  if (!current) return null;

  const exp = expiresAt(current.accessToken);
  if (exp !== null && exp - SKEW_MS <= Date.now()) return refreshSession();

  return current.accessToken;
}

export function clearSession(): void {
  try {
    // Os dois: sair tem de sair mesmo, incluindo de uma sessão antiga deixada no
    // armazenamento do separador.
    store()?.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    /* modo privado: não havia nada para limpar */
  }
}

/**
 * A página de entrada desta academia.
 *
 * Em produção é a raiz do próprio domínio do clube. Em desenvolvimento a landing
 * corre noutra porta, e `VITE_LANDING_URL` diz onde — sem isso, sair levaria a um
 * endereço que não existe.
 */
export function academyLandingUrl(): string {
  const configured = import.meta.env.VITE_LANDING_URL as string | undefined;
  if (configured) return configured;

  const { hostname, protocol } = window.location;
  // Num subdomínio a sério, a landing é a raiz do mesmo sítio.
  if (hostname.split(".").length >= 3) return `${protocol}//${hostname}/`;

  // Antes de a academia carregar, `academy.slug` ainda está vazio — e é
  // precisamente aí que este URL é preciso, para mandar quem não tem sessão
  // entrar. Daí a variável de ambiente como recurso.
  const slug = academy.slug || ((import.meta.env.VITE_ACADEMY_SLUG as string | undefined) ?? "life-club");
  return `http://localhost:3000/l/${slug}`;
}

/**
 * Terminar sessão.
 *
 * Limpa o token e volta à página do clube. `replace` e não `assign`: quem sai não
 * deve poder voltar atrás no histórico e reencontrar a consola.
 */
export function signOut(): void {
  clearSession();
  window.location.replace(academyLandingUrl());
}

/* -------------------------------------------------------------------------- */
/* Troca de perfil — só em desenvolvimento                                     */
/* -------------------------------------------------------------------------- */

/**
 * Os perfis semeados, um por papel, para se ver a consola pelos olhos de cada um.
 *
 * Isto **não** é a máscara de papel que existia antes e foi retirada: aquela trocava
 * o papel sem trocar de conta, e era uma mentira perigosa — o servidor continuava a
 * responder como a mesma pessoa. Aqui cada perfil é um **re-login a sério** na conta
 * daquele papel, com o seu próprio token: entrar como o treinador é mesmo entrar
 * como o treinador. Existe só em `import.meta.env.DEV`, e some no build de produção.
 */
export const DEV_PROFILES = [
  { role: "OWNER", email: "presidente@lifeclub.pt", label: "Presidência" },
  { role: "DIRECTOR", email: "direcao@lifeclub.pt", label: "Direção" },
  { role: "COACH", email: "treinador@lifeclub.pt", label: "Equipa técnica" },
  { role: "MEDICAL", email: "clinico@lifeclub.pt", label: "Departamento clínico" },
  { role: "SCOUT", email: "scouting@lifeclub.pt", label: "Departamento de scouting" },
] as const;

/** Re-autentica contra o Supabase com a conta semeada de um papel e recarrega. */
export async function devSignInAs(email: string): Promise<void> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) {
    throw new Error("Supabase por configurar — falta VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY em .env.local.");
  }

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    // A password comum das contas semeadas. Só serve em desenvolvimento.
    body: JSON.stringify({ email, password: "academia2026" }),
  });
  if (!res.ok) throw new Error("Não foi possível entrar com este perfil.");
  const data = (await res.json()) as { access_token: string; refresh_token: string };

  const slug = readSession()?.academySlug ?? ((import.meta.env.VITE_ACADEMY_SLUG as string | undefined) ?? "life-club");
  store()?.setItem(
    KEY,
    JSON.stringify({ accessToken: data.access_token, refreshToken: data.refresh_token, academySlug: slug }),
  );
  // Recarrega para o store e a sessão nascerem do zero com o novo token.
  window.location.reload();
}

/* -------------------------------------------------------------------------- */
/* Entrega da sessão entre origens                                             */
/* -------------------------------------------------------------------------- */

/**
 * Recebe a sessão que a página da academia entregou no fragmento do URL.
 *
 * ## Porque é que isto é preciso
 *
 * `sessionStorage` é por origem. Em produção a landing e a consola vivem ambas em
 * `{slug}.academias.pt`, e a sessão atravessa sozinha — este código nunca chega a
 * correr. Em desenvolvimento são `:3000` e `:5173`, origens diferentes, e sem
 * entrega explícita a consola recebia quem acabou de entrar e voltava a pedir
 * login.
 *
 * ## Porquê no fragmento e não na query
 *
 * O fragmento (`#`) **não é enviado ao servidor**: não aparece em logs de acesso
 * nem em cabeçalhos `Referer`. É o mesmo mecanismo que o próprio Supabase usa para
 * devolver tokens ao browser.
 *
 * E é apagado do URL no instante em que é lido — com `replaceState`, para não
 * ficar no histórico nem sobreviver a um F5.
 */
export function adoptSessionFromUrl(): StoredSession | null {
  const hash = window.location.hash;
  if (!hash.startsWith("#s=")) return null;

  try {
    const raw = decodeURIComponent(hash.slice(3));
    const parsed = JSON.parse(atob(raw)) as StoredSession;
    if (!parsed.accessToken || !parsed.academySlug) return null;

    store()?.setItem(KEY, JSON.stringify(parsed));
    return parsed;
  } catch {
    return null;
  } finally {
    // Sai do URL de qualquer maneira — mesmo que fosse ilegível, não deve ficar lá.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
}
