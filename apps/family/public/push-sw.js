/* eslint-disable no-undef */
/**
 * Notificações push — importado pelo service worker gerado pelo Workbox
 * (ver `workbox.importScripts` em vite.config.ts).
 *
 * Fica num ficheiro à parte de propósito: o service worker principal é gerado no
 * build e reescrito a cada compilação, por isso não se lhe pode acrescentar código
 * à mão. `importScripts` deixa-nos juntar comportamento sem tocar no que o Workbox
 * gera — e sem trocar para `injectManifest`, que obrigaria a reimplementar o
 * precache todo só para acrescentar dois ouvintes.
 */

/**
 * Onde é que esta app vive — `/app/` em produção, `/` em desenvolvimento.
 *
 * ## O erro que isto tapa
 *
 * As rotas que o servidor manda na notificação são da **app** (`/pagamentos`,
 * `/evento/jogo/xyz`). Navegar para elas tal e qual leva-as à raiz da origem —
 * e em produção a raiz da origem é o servidor da API, que responde
 * `Cannot GET /pagamentos`. Era o que acontecia: tocar na notificação no
 * telemóvel abria uma página de erro em vez da app.
 *
 * O `base` deduz-se de onde este service worker está a correr, e não de uma
 * constante: o SW gerado vive em `${base}sw.js`, por isso a pasta dele **é** a
 * base. Uma constante aqui era uma segunda verdade para manter sincronizada com
 * o `vite.config.ts`, e o dia em que divergissem dava exactamente este bug
 * outra vez.
 */
const BASE = new URL("./", self.location).pathname;

/**
 * De uma rota da app para um endereço a sério.
 *
 * Tolera o que vier: rota vazia, rota já com a base, ou um endereço absoluto
 * (que se respeita como está). O que **não** faz é deixar passar um caminho
 * solto para a raiz da origem.
 */
function destino(rota) {
  if (typeof rota !== "string" || rota.trim() === "") return new URL(BASE, self.location.origin).href;
  if (/^https?:\/\//i.test(rota)) return rota;

  const limpa = rota.replace(/^\/+/, "");
  // Já vem com a base? Não se põe duas vezes.
  const semBase = BASE !== "/" && limpa.startsWith(BASE.slice(1)) ? limpa.slice(BASE.length - 1) : limpa;
  return new URL(BASE + semBase, self.location.origin).href;
}

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Academia", body: event.data.text() };
  }

  const title = payload.title || "Academia";
  const options = {
    body: payload.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    // A cor da academia na barra de notificação do Android.
    data: { url: destino(payload.url) },
    // Agrupa por assunto: uma segunda notificação sobre a mesma mensalidade
    // substitui a primeira em vez de empilhar duas iguais.
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    requireInteraction: payload.requireInteraction === true,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/**
 * Tocar na notificação leva ao sítio certo — e reutiliza a janela já aberta em vez
 * de abrir uma segunda instância da app, que é o que acontece se não se procurar
 * primeiro nos clientes existentes.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  /*
   * `destino` outra vez, e não só na chegada do push: as notificações que já
   * estavam na bandeja quando esta versão entrou guardaram o endereço antigo,
   * sem base. Sem isto, essas continuavam a abrir a página de erro para sempre.
   */
  const target = destino(event.notification.data && event.notification.data.url);

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
