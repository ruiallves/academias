import { academy } from "@/lib/api";

/**
 * A sessão vinda da página de entrada da academia.
 *
 * A landing autentica-se contra o Supabase e guarda aqui o token antes de
 * encaminhar para a consola. Em produção as duas vivem na mesma origem
 * (`{slug}.academias.pt`), que é o que faz o `sessionStorage` atravessar — em
 * desenvolvimento estão em portas diferentes e a consola arranca sem sessão,
 * com o selector de perfil de demonstração.
 */

const KEY = "academia.session";

export type StoredSession = {
  accessToken: string;
  refreshToken: string;
  academySlug: string;
};

export function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
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

  return `http://localhost:3000/l/${academy.slug}`;
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
