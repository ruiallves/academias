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
    data: { url: payload.url || "/" },
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
  const target = (event.notification.data && event.notification.data.url) || "/";

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
