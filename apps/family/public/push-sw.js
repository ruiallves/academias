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
    /*
       Com a base, e não a partir da raiz da origem.

       Em produção a app vive em `/app/` e a raiz é a API: `/icon-192.png`
       pedia o ícone ao servidor errado, levava 404, e o Android mostrava o
       símbolo genérico do browser em vez da marca do clube. Mesmo erro que o
       `destino` acima já tapava para as rotas.
    */
    icon: BASE + "icon-192.png",
    badge: BASE + "icon-192.png",
    // A cor da academia na barra de notificação do Android.
    data: { url: destino(payload.url) },
    // Agrupa por assunto: uma segunda notificação sobre a mesma mensalidade
    // substitui a primeira em vez de empilhar duas iguais.
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
    requireInteraction: payload.requireInteraction === true,
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      /*
         E avisar a app, se estiver aberta.

         O push chega ao telemóvel e a app, por trás da notificação, continua a
         mostrar o que leu quando abriu — a convocatória aparecia na bandeja e
         não na agenda. Esta mensagem é o empurrão que falta: quem a ouvir relê
         (ver `lib/fresco.ts`), e as duas coisas mudam ao mesmo tempo.
      */
      avisarJanelas({ tipo: "academia:push" }),
    ]),
  );
});

/** Manda uma mensagem a todas as janelas desta app, abertas ou em segundo plano. */
function avisarJanelas(mensagem) {
  return self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clients) => {
      for (const client of clients) client.postMessage(mensagem);
    })
    .catch(() => {
      /* Sem janelas, ou sem permissão para as ver. A notificação já saiu. */
    });
}

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

/**
 * O browser trocou a subscrição — repor, sem esperar que alguém abra a app.
 *
 * ## O que estava a acontecer
 *
 * Uma subscrição push não dura para sempre. O browser deita a antiga fora e
 * emite outra por sua conta — numa actualização do sistema, ao fim de semanas
 * sem a usar, quando o serviço de mensagens do telemóvel se volta a registar.
 * Quando isso acontece dispara este evento, e **ninguém o estava a ouvir**.
 *
 * O resto seguia-se sozinho: o servidor continuava a empurrar para o endereço
 * velho, levava `410 Gone`, apagava a linha — e o telemóvel ficava mudo. Sem
 * erro, sem aviso, sem nada no ecrã. Voltava a funcionar quando a pessoa abria
 * a app e tocava no interruptor das notificações, o que dá exactamente a
 * impressão de que "as notificações só chegam com a app aberta".
 *
 * ## O que faz
 *
 * Subscreve outra vez com a mesma chave do servidor e pede que a linha passe do
 * endereço antigo para o novo (`/api/push/rotate`). Corre sem sessão, porque
 * um service worker não tem nenhuma: a prova de que é este dispositivo é
 * conhecer o endereço que vem substituir.
 *
 * Alguns browsers dão a subscrição nova em `event.newSubscription`; os outros
 * obrigam a pedi-la. Trata-se dos dois casos — sem isto, funcionava no Chrome
 * e não no resto.
 */
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(reporSubscricao(event));
});

async function reporSubscricao(event) {
  const antiga = event.oldSubscription || (await self.registration.pushManager.getSubscription());
  const anteriorEndpoint = antiga && antiga.endpoint;
  if (!anteriorEndpoint) return;

  let nova = event.newSubscription;
  if (!nova) {
    const chave = await chaveDoServidor();
    if (!chave) return;
    nova = await self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: chave,
    });
  }

  const corpo = nova.toJSON();
  await fetch(new URL(API_BASE + "api/push/rotate", self.location.origin).href, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      oldEndpoint: anteriorEndpoint,
      endpoint: nova.endpoint,
      keys: corpo.keys,
    }),
  });

  /* A memória passa a apontar para o endereço novo — senão a troca seguinte
     mandava outra vez o antigo, e essa já não existiria em lado nenhum. */
  await lembrarEndpoint();
}

/**
 * A API vive na raiz da origem, e a app numa subpasta (`/app/` em produção).
 *
 * Em desenvolvimento a API está noutra porta e este caminho não lá chega — mas
 * em desenvolvimento também não há subscrições a expirar. A alternativa era
 * compilar o endereço para dentro de um ficheiro que o Workbox copia tal e
 * qual, e ficar com duas verdades para manter.
 */
const API_BASE = "/";

/** A chave pública VAPID, em bytes. O `subscribe` recusa a string. */
async function chaveDoServidor() {
  try {
    const res = await fetch(new URL(API_BASE + "api/push/key", self.location.origin).href);
    if (!res.ok) return null;
    const { publicKey } = await res.json();
    if (!publicKey) return null;
    return base64UrlParaBytes(publicKey);
  } catch {
    return null;
  }
}

function base64UrlParaBytes(base64) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const bruto = atob(normal);
  const bytes = new Uint8Array(bruto.length);
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i);
  return bytes;
}

/* -------------------------------------------------------------------------- */
/* A memória do endereço                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Onde fica: numa `Cache`, que é o único armazenamento que um service worker
 * tem sempre à mão e que sobrevive a ele ser desligado entre eventos. É uma
 * string, não um segredo — o endereço de push é público por natureza, e é
 * precisamente o que o servidor já guarda.
 */
const MEMORIA = "academia-push";
const CHAVE = "./ultimo-endpoint";

async function lembrarEndpoint() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (!sub) return;
    const cache = await caches.open(MEMORIA);
    await cache.put(CHAVE, new Response(sub.endpoint));
  } catch {
    /* Sem memória do endereço perde-se a reposição automática, não o push. */
  }
}

async function endpointLembrado() {
  try {
    const cache = await caches.open(MEMORIA);
    const guardado = await cache.match(CHAVE);
    return guardado ? await guardado.text() : null;
  } catch {
    return null;
  }
}
