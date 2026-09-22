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
/** O convite de **sócio** viaja pelo mesmo caminho, com outro parâmetro. */
const SOCIO_KEY = "academia.socio.convite";
/** E o de **atleta** — o link que sai para o email da ficha do atleta. */
const ATLETA_KEY = "academia.atleta.convite";

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

    /*
     * O token pode vir de duas formas, e as duas têm de valer:
     *
     *  - na **query** (`?atleta=…`), como a landing o passa ao abrir a app;
     *  - no **caminho** (`/atleta/<token>`), como o link do clube chega quando a
     *    app **já instalada** o abre dentro do seu âmbito (o service worker serve
     *    a casca e não há query nenhuma).
     *
     * Faltava a segunda, e o efeito era mau de perceber: quem tinha a app
     * instalada abria o link de atleta, o token no caminho era ignorado, e a app
     * caía no login de família — com a mensagem "este link já não está válido",
     * que é de outro convite. O convite de atleta certo nunca chegava a ser lido.
     */
    const noCaminho = window.location.pathname.match(/\/(familia|socio|atleta)\/([^/?#]+)/);
    const tipoCaminho = noCaminho?.[1];
    const convite = params.get("convite") ?? (tipoCaminho === "familia" ? noCaminho![2] : null);
    const socio = params.get("socio") ?? (tipoCaminho === "socio" ? noCaminho![2] : null);
    const atleta = params.get("atleta") ?? (tipoCaminho === "atleta" ? noCaminho![2] : null);
    const academia = params.get("academia");

    /*
     * Um convite de cada vez, e é sempre o que a pessoa acabou de abrir.
     *
     * Sem isto, um token de família de uma tentativa anterior (ou de outro link)
     * sequestrava a leitura — o `App` verifica sócio e atleta antes do login de
     * família, mas um token velho no sítio errado ainda estraga o fluxo. Quem
     * chega por um link novo quer esse, e mais nenhum: limpam-se os outros.
     */
    if (convite || socio || atleta) {
      localStorage.removeItem(KEY);
      localStorage.removeItem(SOCIO_KEY);
      localStorage.removeItem(ATLETA_KEY);
    }
    if (convite) localStorage.setItem(KEY, convite);
    if (socio) localStorage.setItem(SOCIO_KEY, socio);
    if (atleta) localStorage.setItem(ATLETA_KEY, atleta);
    if (academia) localStorage.setItem(SLUG_KEY, academia);

    if (convite || socio || atleta || academia || noCaminho) {
      params.delete("convite");
      params.delete("socio");
      params.delete("atleta");
      params.delete("academia");
      const rest = params.toString();
      /*
       * A barra fica na raiz da app (o `base` do Vite: `/app/` ou `/`), sem token
       * no caminho nem na query — fora do histórico e de qualquer captura de ecrã,
       * e dentro do `basename` do router, senão a app abria fora dele depois de
       * registar. O fragmento preserva-se: é por lá que a sessão viaja no
       * desenvolvimento (ver `adoptSessionFromUrl`, que corre a seguir).
       */
      const base = (import.meta.env as { BASE_URL?: string } | undefined)?.BASE_URL ?? "/";
      window.history.replaceState({}, "", base + (rest ? `?${rest}` : "") + window.location.hash);
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

export function readMemberInvite(): string | null {
  try {
    return localStorage.getItem(SOCIO_KEY);
  } catch {
    return null;
  }
}

export function clearMemberInvite(): void {
  try {
    localStorage.removeItem(SOCIO_KEY);
  } catch {
    /* idem */
  }
}

export function readAthleteInvite(): string | null {
  try {
    return localStorage.getItem(ATLETA_KEY);
  } catch {
    return null;
  }
}

export function clearAthleteInvite(): void {
  try {
    localStorage.removeItem(ATLETA_KEY);
  } catch {
    /* idem */
  }
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

  /*
   * O subdomínio é o clube — em produção, onde a app vive em
   * `{slug}.academias.pt`. Em desenvolvimento nunca: o host é `localhost` ou um
   * túnel (`ddfb8c….lhr.life`), e ler-lhe o primeiro pedaço mandava a app pedir
   * uma academia chamada "ddfb8c…" depois do login.
   */
  if (!import.meta.env.DEV) {
    const parts = window.location.hostname.split(".");
    if (parts.length >= 3 && parts[0] !== "www") return parts[0];
  }

  return (import.meta.env.VITE_ACADEMY_SLUG as string | undefined) ?? "life-club";
}

export function saveSlug(slug: string): void {
  try {
    localStorage.setItem(SLUG_KEY, slug);
  } catch {
    /* idem */
  }
}
