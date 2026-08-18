/**
 * A sessão do painel da plataforma.
 *
 * Chave própria no `sessionStorage` — `academias.platform` e não
 * `academia.session`. Não é detalhe: em produção o painel vive em
 * `admin.academias.pt` e uma academia em `clube.academias.pt`, origens diferentes
 * que nunca se cruzam. Mas em desenvolvimento partilham `localhost`, e uma chave
 * comum faria a sessão de um vazar para o outro — exactamente a confusão que o
 * resto da arquitectura existe para impedir.
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

export function signOut(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* modo privado: já não havia nada */
  }
  window.location.reload();
}
