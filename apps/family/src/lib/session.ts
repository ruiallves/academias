/**
 * A sessão da app do pai.
 *
 * A app é, para já, um protótipo com dados **mock** — mas o **push** precisa de uma
 * sessão real: é o token que diz ao servidor a que pai pertence a subscrição, para
 * um aviso poder chegar ao telemóvel certo.
 *
 * Em produção, o token virá do mesmo handoff que a consola usa (a landing autentica
 * e entrega a sessão). Enquanto isso não existe, **em desenvolvimento** a app entra
 * sozinha com a conta de teste do pai — só para o push poder subscrever autenticado.
 * Fora de `DEV` isto não faz nada, e o push fica à espera do handoff real.
 */

const KEY = "academia.family.session";

type Stored = { accessToken: string; refreshToken?: string };

export function readToken(): string | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored).accessToken : null;
  } catch {
    return null;
  }
}

let pending: Promise<string | null> | null = null;

/** O token da sessão — o guardado, ou (só em dev) um obtido pela conta de teste. */
export async function getAccessToken(): Promise<string | null> {
  const existing = readToken();
  if (existing) return existing;
  if (!import.meta.env.DEV) return null;
  pending ??= devLogin();
  return pending;
}

async function devLogin(): Promise<string | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !anon) return null;

  try {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: "familia@lifeclub.pt", password: "academia2026" }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string; refresh_token: string };
    sessionStorage.setItem(KEY, JSON.stringify({ accessToken: data.access_token, refreshToken: data.refresh_token }));
    return data.access_token;
  } catch {
    return null;
  }
}
