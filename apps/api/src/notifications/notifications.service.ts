import { Injectable, Logger } from "@nestjs/common";
import { NotificationType } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";

export type NotificationInput = {
  academyId: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
};

/**
 * Um canal de entrega. In-app hoje; push e e-mail depois, sem tocar no domínio.
 */
export interface NotificationChannel {
  readonly name: string;
  deliver(notification: { id: string; userId: string; title: string; body: string; payload: unknown }): Promise<void>;
}

/**
 * Notificações.
 *
 * A notificação é primeiro uma linha na base de dados e só depois um empurrão para
 * um canal. Faz-se assim por três razões: a app pode mostrar o histórico sem
 * depender de push; uma falha de entrega não perde a mensagem; e acrescentar SMS
 * mais tarde é registar um adaptador.
 *
 * O domínio nunca chama um canal directamente — chama `enqueue`.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  private readonly channels: NotificationChannel[] = [];

  constructor(private readonly prisma: PrismaService) {}

  register(channel: NotificationChannel) {
    this.channels.push(channel);
  }

  /**
   * Grava a notificação e entrega-a.
   *
   * ## Porque é que isto recebe um cliente
   *
   * `Notification` tem RLS por academia. Escrever pelo cliente base — sem
   * `SET LOCAL app.academy_id` na ligação — é recusado pelo Postgres, e a
   * mensagem que sai é "new row violates row-level security policy", que não
   * ajuda ninguém a perceber o que se passou.
   *
   * Quem já está dentro de uma transação de tenant passa o seu `db`; quem não
   * está deixa em branco e esta função abre a sua. As duas coisas são precisas:
   * aninhar `$transaction` no Prisma esgota a ligação à espera de si própria, e
   * escrever sem contexto é recusado.
   */
  async enqueue(input: NotificationInput, db?: ScopedClient): Promise<{ id: string }> {
    if (!db) {
      return this.prisma.runAs(input.academyId, (scoped) => this.enqueue(input, scoped));
    }

    const notification = await db.notification.create({
      data: {
        academyId: input.academyId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        payload: (input.payload ?? {}) as object,
        channels: ["inapp", ...this.channels.map((c) => c.name)],
      },
    });

    // A entrega é best-effort: se um canal falhar, a notificação continua a
    // existir e a aparecer na app. Nunca se desfaz o que já foi gravado.
    for (const channel of this.channels) {
      try {
        await channel.deliver({
          id: notification.id,
          userId: notification.userId,
          title: notification.title,
          body: notification.body,
          payload: notification.payload,
        });
      } catch (error) {
        this.log.warn(`Canal ${channel.name} falhou para ${notification.id}: ${error}`);
      }
    }

    await db.notification.update({
      where: { id: notification.id },
      data: { deliveredAt: new Date() },
    });

    return notification;
  }

  async listForUser(userId: string, academyId: string) {
    return this.prisma.notification.findMany({
      where: { userId, academyId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async markRead(userId: string, ids: string[]) {
    return this.prisma.notification.updateMany({
      where: { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
  }
}
