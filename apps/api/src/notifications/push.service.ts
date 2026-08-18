import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import * as webpush from "web-push";
import { PrismaService } from "../prisma/prisma.service";
import { NotificationsService } from "./notifications.service";

/** Uma subscrição Web Push, como o browser a devolve. */
export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

/** O que o service worker (`push-sw.js`) sabe mostrar. */
export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  requireInteraction?: boolean;
};

/**
 * Web Push.
 *
 * Fecha a metade que faltava: o cliente (`apps/family/lib/push.ts`) já sabia
 * subscrever e o service worker já sabia mostrar — faltava o servidor guardar as
 * subscrições e empurrar. Ao arrancar, regista-se como **canal** do
 * `NotificationsService`: a partir daí, cada notificação gravada (um aviso, uma
 * convocatória, uma mensalidade) tenta também sair como push, sem o domínio saber
 * que o push existe.
 *
 * As chaves VAPID vivem no `.env` (a privada nunca sai do servidor). Uma subscrição
 * que o serviço de push recuse com 404/410 está morta — a app foi desinstalada ou a
 * permissão revogada — e apaga-se, senão a tabela enche-se de endpoints fantasma.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly log = new Logger(PushService.name);
  private ready = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:suporte@academias.pt";

    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.ready = true;
    } else {
      this.log.warn("VAPID por configurar — o push fica desligado até haver chaves no .env.");
    }

    // Regista-se como canal: agora `enqueue` também empurra, para quem tiver
    // subscrição. Se as chaves faltarem, o canal existe mas não faz nada.
    this.notifications.register({
      name: "push",
      deliver: async (n) => {
        if (!this.ready) return;
        await this.pushToUser(n.userId, {
          title: n.title,
          body: n.body,
          url: routeOf(n.payload),
          tag: tagOf(n.payload),
        });
      },
    });
  }

  get publicKey(): string {
    return process.env.VAPID_PUBLIC_KEY ?? "";
  }

  /** Guarda (ou actualiza) a subscrição deste dispositivo para este utilizador. */
  async saveSubscription(userId: string, sub: PushSubscriptionInput, userAgent?: string): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: {
        userId,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
      },
      // Reassocia ao utilizador actual: o mesmo dispositivo pode mudar de conta.
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent, lastUsedAt: new Date() },
    });
  }

  async removeSubscription(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /** Empurra para todos os dispositivos de um utilizador. */
  async pushToUser(userId: string, payload: PushPayload): Promise<void> {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(subs.map((s) => this.send(s.id, s.endpoint, s.p256dh, s.auth, payload)));
  }

  /** Empurra para um endpoint concreto — o caminho do botão de teste. */
  async pushToEndpoint(endpoint: string, payload: PushPayload): Promise<boolean> {
    const s = await this.prisma.pushSubscription.findUnique({ where: { endpoint } });
    if (!s) return false;
    await this.send(s.id, s.endpoint, s.p256dh, s.auth, payload);
    return true;
  }

  private async send(id: string, endpoint: string, p256dh: string, auth: string, payload: PushPayload): Promise<void> {
    if (!this.ready) return;
    try {
      await webpush.sendNotification({ endpoint, keys: { p256dh, auth } }, JSON.stringify(payload));
      await this.prisma.pushSubscription.update({ where: { id }, data: { lastUsedAt: new Date() } });
    } catch (error) {
      const status = (error as webpush.WebPushError)?.statusCode;
      if (status === 404 || status === 410) {
        // Subscrição morta — app desinstalada ou permissão revogada.
        await this.prisma.pushSubscription.delete({ where: { id } }).catch(() => {});
      } else {
        this.log.warn(`Push falhou para ${endpoint.slice(0, 40)}…: ${String(error)}`);
      }
    }
  }
}

/** O destino do toque — vem do `payload.route` da notificação, ou a raiz. */
function routeOf(payload: unknown): string {
  const route = (payload as { route?: string } | null)?.route;
  return typeof route === "string" ? route : "/";
}

/** Agrupa notificações do mesmo assunto para não empilharem no telemóvel. */
function tagOf(payload: unknown): string | undefined {
  const id = (payload as { announcementId?: string } | null)?.announcementId;
  return id ? `announcement-${id}` : undefined;
}
