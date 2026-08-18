/**
 * Subscrição de notificações push.
 *
 * O fluxo real, do lado do telemóvel:
 *
 *   1. pedir permissão ao utilizador (só com um gesto dele — os browsers ignoram
 *      pedidos automáticos, e com razão);
 *   2. subscrever no `PushManager` com a chave pública VAPID do servidor;
 *   3. enviar a subscrição para o servidor, que a guarda e a usa para empurrar.
 *
 * A chave privada nunca sai do servidor. A pública é pedida em `/api/push/key`
 * em vez de ir compilada no bundle: assim rodar as chaves não obriga a
 * reconstruir a app.
 *
 * No iOS isto só funciona com a app **instalada** no ecrã principal (16.4+);
 * no Safari em separador, `PushManager` nem existe. É mais uma razão para a app
 * se recusar a correr fora do modo instalado — ver `StandaloneGate`.
 */

import { getAccessToken } from "@/lib/session";

// Em produção a app e a API vivem na mesma origem, e a base fica vazia. Em
// desenvolvimento a API está noutra porta — `VITE_API_URL` diz onde.
const API = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

/** Um `fetch` para a API com a sessão do pai — é o que liga a subscrição a uma pessoa. */
async function authed(path: string, body: unknown): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "x-academy-slug": "life-club",
    },
    body: JSON.stringify(body),
  });
}

export type PushState = "unsupported" | "denied" | "granted" | "default";

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function pushState(): PushState {
  if (!pushSupported()) return "unsupported";
  return Notification.permission as PushState;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) {
    return { ok: false, reason: "Este telemóvel não suporta notificações nesta app." };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, reason: "As notificações ficaram bloqueadas nas definições do telemóvel." };
  }

  const keyResponse = await fetch(`${API}/api/push/key`);
  if (!keyResponse.ok) return { ok: false, reason: "O servidor não devolveu a chave de notificações." };
  const { publicKey } = (await keyResponse.json()) as { publicKey: string };

  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      // Obrigatório nos browsers actuais: uma subscrição silenciosa, que
      // recebesse push sem mostrar nada, seria um rastreador.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const res = await authed("/api/push/subscribe", subscription);
  if (res.status === 401) return { ok: false, reason: "Sem sessão — entra na app da academia primeiro." };
  if (!res.ok) return { ok: false, reason: "Não foi possível registar no servidor." };
  return { ok: true };
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await authed("/api/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe();
}

/** Dispara uma notificação de teste a partir do servidor — não local. */
export async function sendTestPush(kind: string): Promise<{ ok: boolean; reason?: string }> {
  const sub = await currentSubscription();
  if (!sub) return { ok: false, reason: "Ainda não há subscrição activa." };

  const res = await authed("/api/push/test", { endpoint: sub.endpoint, kind });
  if (!res.ok) return { ok: false, reason: `O servidor respondeu ${res.status}.` };
  return { ok: true };
}

/**
 * A chave VAPID viaja em base64url; o `PushManager` quer bytes. Sem esta
 * conversão o `subscribe` falha com um erro que não diz o que está mal.
 */
function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  // `ArrayBuffer` explícito: o tipo `Uint8Array<ArrayBufferLike>` que sai de
  // `new Uint8Array(n)` não satisfaz `BufferSource`, que exige `ArrayBuffer`.
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return view;
}
