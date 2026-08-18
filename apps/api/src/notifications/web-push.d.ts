/**
 * Tipos mínimos para `web-push` — a biblioteca não os traz e não há `@types`.
 * Só o que usamos: gerar chaves, configurar VAPID, enviar. O `statusCode` no erro
 * é o que distingue uma subscrição morta (404/410) de uma falha temporária.
 */
declare module "web-push" {
  export interface WebPushSubscription {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  }

  export function generateVAPIDKeys(): { publicKey: string; privateKey: string };
  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(
    subscription: WebPushSubscription,
    payload?: string | Buffer,
    options?: Record<string, unknown>,
  ): Promise<{ statusCode: number }>;

  export class WebPushError extends Error {
    statusCode: number;
  }
}
