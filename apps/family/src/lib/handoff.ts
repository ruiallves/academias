import { readStoredSession } from "@/lib/session";
import { academySlug } from "@/lib/invite";

/**
 * A entrega da sessão à consola.
 *
 * ## Porque é que a área de staff é a consola, e não uma vista desta app
 *
 * A consola já faz tudo o que um treinador, um médico ou um presidente fazem —
 * quarenta ecrãs, cada um com as suas regras de acesso, os seus diálogos e os
 * seus testes. Reescrevê-la aqui em ponto pequeno era ter duas consolas para
 * manter, e a do telemóvel ficaria sempre um passo atrás da outra: uma
 * funcionalidade nova entrava numa e faltava na outra até alguém reparar.
 *
 * Em vez disso a consola passou a caber no telemóvel (ver `apps/console`), e
 * esta app limita-se a **entregar-lhe a sessão** e a sair do caminho.
 *
 * ## Como é que a sessão atravessa
 *
 * Em produção as duas vivem na mesma origem — `{clube}.academias.pt/app` e
 * `{clube}.academias.pt/consola` — e o `localStorage` é o mesmo. Escreve-se a
 * sessão na chave que a consola lê (`academia.session`, ver o `lib/session.ts`
 * dela) e navega-se. Como o manifest tem `scope: "/"`, `/consola` continua
 * dentro da app instalada: sem barra de browser, com o mesmo ícone no
 * multitarefa. Para quem está a olhar, é a mesma app a mudar de área.
 *
 * Em desenvolvimento são portas diferentes, e a sessão vai no fragmento do URL
 * (`#s=`), que a consola já sabe recolher e apagar — é o mesmo caminho que a
 * página de entrada do clube usa para lhe entregar quem acabou de entrar.
 *
 * ## O par inteiro, e não só o token de acesso
 *
 * A consola renova a sessão sozinha com o refresh; sem ele durava uma hora e
 * depois mandava a pessoa entrar outra vez. O refresh do Supabase **roda** a
 * cada uso, por isso a cópia que fica aqui envelhece enquanto a consola
 * trabalha — e é por isso que o caminho de volta (o "Mudar de área" da
 * consola) volta a escrever aqui o par mais recente. Uma app de cada vez tem
 * a sessão viva, e a entrega é sempre da que a tem para a que vai precisar.
 */

const CONSOLA_KEY = "academia.session";

/** Os papéis da consola, para o ecrã de escolha os nomear. Neutros, como lá. */
export const ROLE_LABEL: Record<string, string> = {
  OWNER: "Presidência",
  DIRECTOR: "Direção",
  COORDINATOR: "Coordenação",
  COACH: "Equipa técnica",
  MEDICAL: "Departamento clínico",
  SCOUT: "Departamento de scouting",
  STAFF: "Staff",
};

/** Onde a consola vive — sem barra final. */
export function consoleUrl(): string {
  const configured = import.meta.env.VITE_CONSOLE_URL as string | undefined;
  if (configured) return configured.replace(/\/$/, "");
  // Em `vite dev` a consola corre na porta dela; em produção é `/consola` na mesma origem.
  if (import.meta.env.DEV) return "http://localhost:5173";
  return `${window.location.origin}/consola`;
}

/** Entrega a sessão e navega. Não faz nada sem sessão — o `App` já não chega aqui sem ela. */
export function irParaConsola(): void {
  const actual = readStoredSession();
  if (!actual) return;

  const sessao = {
    accessToken: actual.accessToken,
    refreshToken: actual.refreshToken ?? "",
    academySlug: academySlug(),
  };
  const base = consoleUrl();

  if (base.startsWith(`${window.location.origin}/`)) {
    try {
      localStorage.setItem(CONSOLA_KEY, JSON.stringify(sessao));
    } catch {
      /* sem armazenamento: vai pelo fragmento, como em desenvolvimento */
      window.location.assign(`${base}/#s=${encodeURIComponent(btoa(JSON.stringify(sessao)))}`);
      return;
    }
    window.location.assign(`${base}/`);
    return;
  }

  window.location.assign(`${base}/#s=${encodeURIComponent(btoa(JSON.stringify(sessao)))}`);
}
