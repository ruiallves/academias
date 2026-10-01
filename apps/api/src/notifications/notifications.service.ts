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
   * Grava a notificação e entrega-a — **a entrega só depois de a escrita valer**.
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
   *
   * ## O push nunca sai de dentro de uma transacção
   *
   * Saía. A linha gravava-se e o push partia logo a seguir, com a transacção de
   * quem chamou ainda aberta. A 1 de Outubro de 2026 isso deu um aviso falso a
   * um clube inteiro: a emissão do mês criou as mensalidades, avisou dezanove
   * famílias uma a uma — cada push é uma chamada de rede —, passou dos cinco
   * segundos da transacção, e o Postgres desfez tudo. As mensalidades e as
   * notificações desapareceram; os pushes já estavam nos telemóveis. As famílias
   * abriram a app para pagar Outubro e Outubro não existia — e como a emissão
   * volta a tentar de hora a hora, receberam o mesmo aviso outra vez a cada hora.
   *
   * Um push não se desfaz. Por isso só pode sair de uma escrita que já não se
   * desfaz: com `db` de quem chama, a linha fica gravada na transacção dele e a
   * entrega fica **à espera** — só sai quando a linha passa a ser visível de
   * fora, que é a prova de que houve commit. Se nunca aparecer, a transacção foi
   * desfeita e não há nada a entregar. Ver `varrerPendentes`.
   *
   * É também a regra da casa — "HTTP nunca entra num `runAs`" — que este
   * serviço quebrava por todos os que o chamavam.
   */
  async enqueue(input: NotificationInput, db?: ScopedClient): Promise<{ id: string }> {
    if (!db) {
      const gravada = await this.prisma.runAs(input.academyId, (scoped) => this.gravar(input, scoped));
      /* A transacção já fechou: a entrega faz-se agora, e quem chamou continua a
         poder esperar por ela como sempre esperou. */
      await this.entregar(gravada, input.academyId);
      return gravada;
    }

    const gravada = await this.gravar(input, db);
    this.pendentes.push({ id: gravada.id, academyId: input.academyId, desde: Date.now() });
    this.agendar();
    return gravada;
  }

  private gravar(input: NotificationInput, db: ScopedClient) {
    return db.notification.create({
      data: {
        academyId: input.academyId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        payload: (input.payload ?? {}) as object,
        channels: ["inapp", ...this.channels.map((c) => c.name)],
      },
      select: { id: true, userId: true, title: true, body: true, payload: true },
    });
  }

  /**
   * Os canais, e a marca de entregue. Sempre **fora** de qualquer transacção.
   *
   * A entrega é best-effort: se um canal falhar, a notificação continua a
   * existir e a aparecer na app. Nunca se desfaz o que já foi gravado.
   */
  private async entregar(
    n: { id: string; userId: string; title: string; body: string; payload: unknown },
    academyId: string,
  ): Promise<void> {
    for (const channel of this.channels) {
      try {
        await channel.deliver(n);
      } catch (error) {
        this.log.warn(`Canal ${channel.name} falhou para ${n.id}: ${error}`);
      }
    }
    try {
      await this.prisma.runAs(academyId, (db) =>
        db.notification.updateMany({ where: { id: n.id }, data: { deliveredAt: new Date() } }),
      );
    } catch (error) {
      this.log.warn(`Não foi possível marcar ${n.id} como entregue: ${error}`);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* As entregas à espera de um commit                                       */
  /* ---------------------------------------------------------------------- */

  /** Gravadas dentro da transacção de outro, à espera de saber se ela valeu. */
  private pendentes: { id: string; academyId: string; desde: number }[] = [];
  private temporizador: ReturnType<typeof setTimeout> | null = null;
  private aVarrer = false;

  /** De quanto em quanto se espreita. Curto: um push atrasado um segundo é um push a horas. */
  intervaloMs = 1_000;
  /**
   * Quanto se espera por um commit antes de desistir. Folgado de propósito: as
   * operações em lote correm com transacções de um minuto (`timeoutMs`), e
   * desistir antes disso era perder o aviso de uma escrita que valeu.
   */
  idadeMaximaMs = 3 * 60_000;

  private agendar() {
    if (this.temporizador) return;
    this.temporizador = setTimeout(() => {
      this.temporizador = null;
      void this.varrerPendentes().then(() => {
        if (this.pendentes.length > 0) this.agendar();
      });
    }, this.intervaloMs);
    /* Não segura o processo vivo: é uma cortesia, não um trabalho por acabar. */
    this.temporizador.unref?.();
  }

  /**
   * Entrega o que já tem commit, e esquece o que nunca o vai ter.
   *
   * A pergunta "houve commit?" faz-se da única maneira que não mente: lendo a
   * linha por **outra** ligação. O Postgres só a mostra a quem está de fora
   * depois do commit; antes disso, e depois de um rollback, não existe.
   *
   * Uma leitura por academia e não por notificação: uma emissão de trinta
   * mensalidades deixa trinta à espera, e trinta transacções por segundo para
   * espreitar eram mais carga do que o trabalho que se está a vigiar.
   *
   * Vive em memória. Se o processo reiniciar com entregas à espera, o push
   * perde-se e a notificação fica na app — que é exactamente o "best-effort" que
   * a entrega sempre foi. O contrário (um push sem notificação) é que não pode
   * acontecer, e deixa de poder.
   *
   * Pública para os testes a chamarem sem relógio.
   */
  async varrerPendentes(agora = Date.now()): Promise<void> {
    if (this.aVarrer || this.pendentes.length === 0) return;
    this.aVarrer = true;
    try {
      const lote = this.pendentes;
      this.pendentes = [];
      const porAcademia = new Map<string, typeof lote>();
      for (const p of lote) porAcademia.set(p.academyId, [...(porAcademia.get(p.academyId) ?? []), p]);

      for (const [academyId, espera] of porAcademia) {
        let visiveis: { id: string; userId: string; title: string; body: string; payload: unknown; deliveredAt: Date | null }[];
        try {
          visiveis = await this.prisma.runAs(academyId, (db) =>
            db.notification.findMany({
              where: { id: { in: espera.map((p) => p.id) } },
              select: { id: true, userId: true, title: true, body: true, payload: true, deliveredAt: true },
            }),
          );
        } catch (error) {
          /* A base não respondeu: voltam todas à fila, para a volta seguinte. */
          this.log.warn(`Não foi possível espreitar as notificações pendentes: ${error}`);
          this.pendentes.push(...espera.filter((p) => agora - p.desde < this.idadeMaximaMs));
          continue;
        }

        const porId = new Map(visiveis.map((n) => [n.id, n]));
        for (const p of espera) {
          const n = porId.get(p.id);
          if (n) {
            if (!n.deliveredAt) await this.entregar(n, academyId);
          } else if (agora - p.desde < this.idadeMaximaMs) {
            /* Ainda sem commit. Fica para a volta seguinte. */
            this.pendentes.push(p);
          }
          /* Senão: passou o tempo e a linha nunca apareceu — a transacção foi
             desfeita, e não há nada a anunciar. */
        }
      }
    } finally {
      this.aVarrer = false;
    }
  }

  /*
   * As duas leituras abaixo passam por `runAs`, como o `enqueue`.
   *
   * `Notification` tem RLS por academia: sem `SET LOCAL app.academy_id` na
   * ligação, o Postgres não recusa com erro — devolve **zero linhas**, que é
   * muito pior. Foi exactamente isso que aconteceu quando estes métodos
   * ganharam um endpoint pela primeira vez: as notificações existiam na base, o
   * pai tinha-as por ler, e a app mostrava a caixa vazia.
   */

  /**
   * As notificações de uma pessoa, na forma que o cliente lê.
   *
   * ## Isto devolvia a linha em bruto
   *
   * E o painel da consola não conseguia fazer nada com ela: espera `kind` e a
   * coluna chama-se `type`; espera `link` e não há coluna nenhuma — o destino vive
   * dentro do `payload`. O resultado era um painel onde **nenhuma** notificação
   * era clicável, sem erro nenhum a dizer porquê.
   *
   * ## Dois destinos, porque são dois produtos
   *
   * A mesma notificação é lida em dois sítios que não têm as mesmas páginas: a
   * consola abre `/jogos/:id`, a app abre `/evento/jogo/:id`. Por isso o
   * `payload` guarda **dois** endereços com nomes próprios — `link` para a
   * consola, `route` para a app — e este método devolve os dois. Cada cliente
   * usa o seu e ignora o outro.
   *
   * Devolver só um era o bug: a app pedia esta mesma lista, procurava
   * `payload.route` num objecto que nunca vinha, e **nenhuma** notificação era
   * clicável — nem a de uma convocatória, que tem página desde sempre. Pelo
   * mesmo caminho ia `type`: a app lê-o para escolher o ícone, aqui chamava-se
   * `kind`, e todas apareciam com o sino genérico.
   *
   * Um destino em falta é `null` e não uma string vazia: é a diferença entre
   * "não há para onde ir" e "há, e enganei-me a escrevê-lo". Os dois clientes
   * desenham o cartão sem ligação quando é `null`, em vez de fingir que
   * navegaram.
   */
  async listForUser(userId: string, academyId: string) {
    const rows = await this.prisma.runAs(academyId, (db) =>
      db.notification.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    );

    return rows.map((n) => {
      const payload = (n.payload ?? {}) as Record<string, unknown>;
      const endereco = (chave: string) => {
        const v = payload[chave];
        return typeof v === "string" && v.trim() !== "" ? v : null;
      };
      return {
        id: n.id,
        /** `kind` é o nome que a consola usa; `type` o que a app usa. O mesmo valor. */
        kind: n.type,
        type: n.type,
        title: n.title,
        body: n.body,
        /** Destino na consola. */
        link: endereco("link"),
        /** Destino na app da família. */
        route: endereco("route"),
        readAt: n.readAt,
        createdAt: n.createdAt,
      };
    });
  }

  /** Idempotente: `readAt: null` no filtro impede que reler mude a data da primeira vez. */
  async markRead(userId: string, academyId: string, ids: string[]) {
    return this.prisma.runAs(academyId, (db) =>
      db.notification.updateMany({
        where: { userId, id: { in: ids }, readAt: null },
        data: { readAt: new Date() },
      }),
    );
  }
}
