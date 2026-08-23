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
