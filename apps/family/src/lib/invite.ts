/**
 * O convite com que o pai chegou.
 *
 * ## Como é que ele cá vem parar
 *
 * A academia manda `{clube}.academias.pt/familia/{token}`. Esse endereço
 * redirecciona para a landing do clube com `?convite=` agarrado, a landing instala
 * a app, e o botão de abrir passa o mesmo `?convite=` para aqui. É a única forma
 * de a app saber que **esta** academia está a aceitar registos de famílias.
 *
 * ## Porque é que se guarda
 *
 * Porque o caminho tem um degrau: instalar a app abre-a a partir do ícone, e a
 * `start_url` do manifest não leva query nenhuma. Guardar o token no
 * `localStorage` assim que ele passa uma vez é o que faz o registo sobreviver a
 * esse salto. Apaga-se quando deixa de ser preciso — depois de a conta existir.
 *
 * O `?academia=` viaja pelo mesmo caminho e serve para o mesmo: em produção o
 * subdomínio já diz de que clube é a app, em desenvolvimento é isto ou nada.
 */

const KEY = "academia.family.convite";
const SLUG_KEY = "academia.family.slug";

export type InvitePreview = {
  academy: { slug: string; name: string; shortName: string; signalColor: string; logoUrl: string | null; mark: string };
  expiresAt: string | null;
};

/**
 * Lê o endereço, guarda o que interessa e limpa a barra.
 *
 * Corre uma vez, no arranque. Limpar a query não é cosmética: sem isso, o token
 * fica no histórico e em qualquer captura de ecrã que o pai mande para o grupo.
 */
export function captureFromUrl(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const convite = params.get("convite");
    const academia = params.get("academia");

    if (convite) localStorage.setItem(KEY, convite);
    if (academia) localStorage.setItem(SLUG_KEY, academia);

    if (convite || academia) {
      params.delete("convite");
      params.delete("academia");
      const rest = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  } catch {
    /* sem armazenamento: o registo ainda funciona nesta sessão, com o token colado à mão */
  }
}

export function readInvite(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Aceita o link inteiro ou só o código — quem cola, cola o que tem à mão. */
export function saveInvite(value: string): string {
  const token = value.trim().replace(/^.*\/familia\//, "").replace(/[?#].*$/, "");
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* idem */
  }
  return token;
}

export function clearInvite(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* idem */
  }
}

/** O slug da academia: o do convite, o do `?academia=`, o do subdomínio, ou o do `.env`. */
export function academySlug(): string {
  try {
    const stored = localStorage.getItem(SLUG_KEY);
    if (stored) return stored;
  } catch {
    /* segue para o subdomínio */
  }

  const parts = window.location.hostname.split(".");
  if (parts.length >= 3 && parts[0] !== "www") return parts[0];

  return (import.meta.env.VITE_ACADEMY_SLUG as string | undefined) ?? "life-club";
}

export function saveSlug(slug: string): void {
  try {
    localStorage.setItem(SLUG_KEY, slug);
  } catch {
    /* idem */
  }
}
