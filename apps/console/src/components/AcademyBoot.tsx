import { useEffect, type ReactNode } from "react";
import { signalVars } from "@academia/ui/tokens";
import { loadAcademy, useStore } from "@/lib/store";
import { loadCatalogs } from "@/lib/catalogs";
import { loadInvites } from "@/lib/invites";
import { loadNotifications } from "@/lib/notifications";
import { clearSession } from "@/lib/session";

/**
 * Carrega a academia antes de deixar a consola desenhar.
 *
 * Nenhum ecrã abre com dados a meio. É deliberado: a alternativa — a casca a
 * aparecer e as listas a preencherem-se — dá um segundo em que a página diz "0
 * atletas" e "sem treinos por registar", e ninguém consegue distinguir isso de uma
 * academia vazia. Numa ferramenta de gestão, um número errado durante um segundo é
 * pior do que um segundo de espera.
 *
 * A cor do tenant é aplicada aqui, quando chega: o white-label deixou de estar num
 * ficheiro e passou a ser da academia.
 */
export function AcademyBoot({ children }: { children: ReactNode }) {
  const store = useStore();

  /*
   * Volta a tentar sempre que ficar sem dados — e não só ao montar.
   *
   * Em desenvolvimento o HMR substitui este módulo e o estado do armazém volta ao
   * início, mas o efeito de montagem já correu e nunca mais dispara: a consola
   * ficava a olhar para um armazém vazio sem nada a puxar por ele. `loadAcademy`
   * partilha o pedido em curso, por isso isto não pede duas vezes.
   */
  useEffect(() => {
    if (!store.ready) void loadAcademy();
  }, [store.ready]);

  /*
   * Os catálogos vêm com a academia.
   *
   * São locais, balneários e escalões — o que enche os menus suspensos de metade
   * dos diálogos. Pedi-los em cada diálogo daria cinco pedidos iguais e um
   * instante de lista vazia em cada um; trazê-los à entrada custa uma leitura de
   * umas dezenas de linhas.
   */
  useEffect(() => {
    if (!store.ready) return;
    void loadCatalogs();
    /*
     * Os convites por aceitar entram no mesmo arranque.
     *
     * O painel de arranque conta-os — "Convidar os treinadores" está feito assim
     * que houver um convite emitido, mesmo antes de a pessoa o abrir — e a lista
     * de staff mostra-os. Falhar aqui é silencioso: quem não tem `staff:read`
     * fica com a lista vazia, que é o que deve ver.
     */
    void loadInvites();
    // O sino da barra lateral vive desta lista — ver `lib/notifications.ts`.
    void loadNotifications();
  }, [store.ready]);

  useEffect(() => {
    if (!store.ready || !store.academy.slug) return;
    for (const [key, value] of Object.entries(signalVars(store.academy.signalColor))) {
      document.documentElement.style.setProperty(key, value);
    }
    document.title = `${store.academy.shortName} · Consola`;
  }, [store.ready, store.academy.slug, store.academy.signalColor, store.academy.shortName]);

  if (store.error) return <BootError message={store.error} />;
  if (!store.ready) return <BootLoading />;
  // Pronto mas sem perfil é um estado impossível — e é preciso que se veja como
  // falha, em vez de deixar a consola abrir sem se saber quem lá está dentro.
  if (!store.me) return <BootError message="A academia carregou sem perfil de utilizador." />;

  return <>{children}</>;
}

function BootLoading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas">
      <div className="text-center">
        <div
          className="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-line"
          style={{ borderTopColor: "var(--color-signal)" }}
          aria-hidden
        />
        <p className="text-meta text-ink-3">A carregar a academia…</p>
      </div>
    </div>
  );
}

/**
 * Falhar a carregar não é um ecrã vazio — é um ecrã que explica.
 *
 * "Entrar outra vez" limpa a sessão de propósito: a causa mais provável é um token
 * expirado, e recarregar a página com o mesmo token dava o mesmo erro para sempre.
 */
function BootError({ message }: { message: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-[360px] text-center">
        <h1 className="mb-1.5 text-panel text-ink">Não foi possível carregar a academia</h1>
        <p className="mb-5 text-meta leading-relaxed text-ink-3">{message}</p>
        <div className="flex justify-center gap-2">
          <button type="button" onClick={() => window.location.reload()} className="ctl-outline">
            Tentar outra vez
          </button>
          <button
            type="button"
            onClick={() => {
              clearSession();
              window.location.reload();
            }}
            className="ctl-primary"
          >
            Entrar outra vez
          </button>
        </div>
      </div>
    </div>
  );
}
