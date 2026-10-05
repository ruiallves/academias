import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SubscriptionBillingPeriod, SubscriptionPaymentMethod } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { EupagoClient } from "../billing/eupago.client";
import { MailClient } from "../mail/mail.client";
import { platformPaymentAlertEmail, subscriptionPaymentEmail } from "../mail/mail.templates";
import { can, type RequestContext } from "../common/permissions";
import { FATURAS_BUCKET, PlatformFinanceService } from "../platform/platform-finance.service";
import { StorageService } from "../storage/storage.service";
import { responsavelDoClube } from "./responsavel";
import { diaDoClube } from "./ciclo";
import { identificadorDaMensalidade, periodoPorExtenso } from "./cobranca";
import {
  SubscriptionNoticesService,
  condicoesDoClube,
  condicoesPorAssinar,
  type LinhaDeCobranca,
} from "./subscription-notices.service";

/** O 403 de quem tenta pagar sem ter aceitado as condições de adesão. */
export const ORDER_UNSIGNED_CODE = "SUBSCRIPTION_ORDER_UNSIGNED";

/** Quanto tempo um pedido MB WAY ainda conta como "a confirmar" na consola. */
const MBWAY_JANELA_MS = 15 * 60_000;

export const METODO_LABEL: Record<string, string> = {
  MBWAY: "MB WAY",
  MULTIBANCO: "Multibanco",
  MANUAL: "Transferência",
};

/**
 * Pagar a mensalidade da plataforma na consola, pela euPago **da plataforma**.
 *
 * ## O que é diferente dos pagamentos aos clubes
 *
 * Tudo o que está em `billing/` cobra **para o clube**: as mensalidades dos
 * atletas e as quotas dos sócios, pela chave do canal do clube. Isto cobra
 * **para nós**, pela chave global (`EUPAGO_API_KEY`), e o dinheiro liquida na
 * conta da plataforma. É por isso que não passa por `Charge`/`Payment`: são
 * tabelas do clube, com o IBAN do clube do outro lado.
 *
 * ## O identificador
 *
 * `ACADEMIAS-<slug>-<AAAAMMDD do período>-<sufixo>`. O prefixo é o que
 * distingue, no webhook global, um pagamento à plataforma de um pagamento a um
 * clube (`CLUBE-…`). O webhook chega sem clube nenhum, e é
 * `app.resolve_subscription_payment()` que diz de quem é para se poder abrir o
 * `runAs` certo.
 *
 * ## Quem paga
 *
 * Quem representa o clube (`legal:club`) ou quem gere as definições
 * (`settings:write`). Quem só vê as Definições vê o estado e mais nada.
 *
 * ## Facturas
 *
 * A euPago não emite facturas. Quando o pagamento chega, sai um email a quem
 * factura (`PLATFORM_ALERT_EMAIL`) com o cliente, o NIF da ordem assinada, o
 * período e o valor; a factura emite-se no Portal das Finanças e segue para o
 * responsável do clube. O recibo que o clube recebe di-lo.
 */
@Injectable()
export class SubscriptionPaymentsService {
  private readonly log = new Logger(SubscriptionPaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eupago: EupagoClient,
    private readonly config: ConfigService,
    private readonly mail: MailClient,
    private readonly finance: PlatformFinanceService,
    private readonly avisos: SubscriptionNoticesService,
    private readonly storage: StorageService,
  ) {}

  private podePagar(ctx: RequestContext): boolean {
    return can(ctx, "legal:club") || can(ctx, "settings:write");
  }

  /* ------------------------------------------------------------- a consola */

  /**
   * O estado da mensalidade, para a secção das Definições e para o ecrã de
   * clube suspenso: o que está em falta (com a referência, se já foi pedida),
   * e o que já foi pago.
   */
  async estadoParaAConsola(ctx: RequestContext) {
    const academyId = ctx.academyId;
    const hoje = diaDoClube(new Date());
    const agora = Date.now();

    const linhas = await this.prisma.$queryRaw<LinhaDeCobranca[]>`SELECT * FROM app.subscription_billing()`;
    const cobranca = linhas.find((l) => l.academy_id === academyId) ?? null;

    return this.prisma.runAs(academyId, async (db) => {
      const academy = await db.academy.findFirst({
        where: { id: academyId },
        select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true, suspendedAt: true },
      });
      if (!academy) throw new NotFoundException("Clube não encontrado");

      const condicoes = await condicoesDoClube(db, academyId);
      const porAssinar = await condicoesPorAssinar(db, academyId);
      const avisos = await db.subscriptionNotice.findMany({
        where: { academyId },
        orderBy: { periodStart: "desc" },
        take: 24,
        select: {
          id: true, periodStart: true, periodEnd: true, amountCents: true, planName: true, billingPeriod: true,
          paidAt: true, paidMethod: true, invoiceFileName: true, invoicePath: true,
          payments: {
            orderBy: { createdAt: "desc" },
            select: { method: true, status: true, entity: true, reference: true, phone: true, expiresAt: true, createdAt: true, amountCents: true },
          },
        },
      });

      const mensalidade = (a: (typeof avisos)[number]) => {
        const multibanco = a.payments.find(
          (p) => p.method === "MULTIBANCO" && p.status === "PENDING" && (!p.expiresAt || p.expiresAt.getTime() > agora),
        );
        const mbway = a.payments.find((p) => p.method === "MBWAY" && agora - p.createdAt.getTime() < MBWAY_JANELA_MS);
        return {
          id: a.id,
          periodStart: a.periodStart,
          periodEnd: a.periodEnd,
          periodo: periodoPorExtenso(a.periodStart, a.periodEnd),
          amountCents: a.amountCents,
          planName: a.planName,
          billingPeriod: a.billingPeriod,
          paidAt: a.paidAt,
          metodo: a.paidMethod ? (METODO_LABEL[a.paidMethod] ?? a.paidMethod) : null,
          vencida: a.paidAt === null && a.periodEnd < hoje,
          /** O nome do PDF da fatura, quando a plataforma o anexou. */
          fatura: a.invoicePath ? (a.invoiceFileName ?? "fatura.pdf") : null,
          multibanco: multibanco
            ? { entity: multibanco.entity, reference: multibanco.reference, expiresAt: multibanco.expiresAt, amountCents: multibanco.amountCents }
            : null,
          mbway: mbway ? { phone: mbway.phone, status: mbway.status, createdAt: mbway.createdAt } : null,
        };
      };

      const emFalta = avisos.filter((a) => a.paidAt === null && a.periodStart <= hoje).reverse().map(mensalidade);
      const historico = avisos.filter((a) => a.paidAt !== null).slice(0, 12).map(mensalidade);

      return {
        academy: { slug: academy.slug, name: academy.name, shortName: academy.shortName, signalColor: academy.signalColor, logoUrl: academy.logoUrl },
        suspenso: academy.suspendedAt !== null,
        podePagar: this.podePagar(ctx),
        /** Há condições de adesão por aceitar: até lá, não se paga. Ver `condicoesPorAssinar`. */
        porAssinar,
        /** Nulo quando o clube não paga (avaliação, ou sem plano activo). */
        plano: cobranca
          ? {
              // O de hoje, o da subscrição: é o que os avisos cobram.
              name: cobranca.plan_name,
              amountCents: cobranca.amount_cents,
              billingPeriod: (condicoes?.billingPeriod ?? "MONTHLY") as SubscriptionBillingPeriod,
            }
          : null,
        emFalta,
        historico,
      };
    });
  }

  /**
   * Uma referência Multibanco para a mensalidade.
   *
   * A que já existe e ainda vale serve outra vez: pedir a referência duas
   * vezes não cria duas dívidas na euPago.
   */
  async multibanco(ctx: RequestContext, noticeId: string) {
    if (!this.podePagar(ctx)) throw new ForbiddenException("Só quem representa o clube pode pagar a mensalidade.");
    await this.exigirCondicoesAceites(ctx);
    const { aviso, academy, pagador } = await this.avisoPorPagar(ctx, noticeId);

    const viva = aviso.payments.find(
      (p) => p.method === "MULTIBANCO" && p.status === "PENDING" && (!p.expiresAt || p.expiresAt.getTime() > Date.now()),
    );
    if (viva) return { entity: viva.entity, reference: viva.reference, expiresAt: viva.expiresAt, amountCents: viva.amountCents };

    const identifier = identificadorDaMensalidade(academy.slug, aviso.periodStart, sufixo());
    const r = await this.eupago.createMultibancoCharge({
      reference: identifier,
      amountCents: aviso.amountCents,
      description: `Academias · ${academy.name} · ${periodoPorExtenso(aviso.periodStart, aviso.periodEnd)}`,
      payerName: pagador.name,
      payerEmail: pagador.email,
    });

    await this.prisma.runAs(ctx.academyId, (db) =>
      db.subscriptionPayment.create({
        data: {
          academyId: ctx.academyId,
          noticeId: aviso.id,
          method: "MULTIBANCO",
          identifier,
          providerRef: r.providerRef ?? null,
          entity: r.entity ?? null,
          reference: r.reference ?? null,
          amountCents: aviso.amountCents,
          expiresAt: r.expiresAt ?? null,
        },
      }),
    );
    return { entity: r.entity ?? null, reference: r.reference ?? null, expiresAt: r.expiresAt ?? null, amountCents: aviso.amountCents };
  }

  /** Um pedido MB WAY para o telemóvel indicado. A confirmação chega pelo webhook. */
  async mbway(ctx: RequestContext, noticeId: string, telefone: string) {
    if (!this.podePagar(ctx)) throw new ForbiddenException("Só quem representa o clube pode pagar a mensalidade.");
    await this.exigirCondicoesAceites(ctx);
    const phone = telefone.replace(/\s+/g, "").replace(/^\+351/, "").replace(/^00351/, "");
    if (!/^9\d{8}$/.test(phone)) throw new BadRequestException("Indica um número de telemóvel português com 9 dígitos.");

    const { aviso, academy, pagador } = await this.avisoPorPagar(ctx, noticeId);
    const identifier = identificadorDaMensalidade(academy.slug, aviso.periodStart, sufixo());
    const r = await this.eupago.createMbWayCharge({
      reference: identifier,
      amountCents: aviso.amountCents,
      description: `Academias · ${academy.name} · ${periodoPorExtenso(aviso.periodStart, aviso.periodEnd)}`,
      payerName: pagador.name,
      payerEmail: pagador.email,
      payerPhone: phone,
    });

    await this.prisma.runAs(ctx.academyId, (db) =>
      db.subscriptionPayment.create({
        data: {
          academyId: ctx.academyId,
          noticeId: aviso.id,
          method: "MBWAY",
          identifier,
          providerRef: r.providerRef ?? null,
          phone,
          amountCents: aviso.amountCents,
          // A euPago dá uns minutos para aceitar no telemóvel.
          expiresAt: new Date(Date.now() + 5 * 60_000),
        },
      }),
    );
    return { ok: true, phone };
  }

  /**
   * Paga-se o que se aceitou, e não antes.
   *
   * Enquanto o clube não tiver assinado as condições de adesão (ou houver umas
   * mais recentes à espera, com outro preço ou plano), a referência e o MB WAY
   * ficam recusados aqui, e não só escondidos na consola.
   */
  private async exigirCondicoesAceites(ctx: RequestContext) {
    const porAssinar = await this.prisma.runAs(ctx.academyId, (db) => condicoesPorAssinar(db, ctx.academyId));
    if (porAssinar) {
      throw new ForbiddenException({
        statusCode: 403,
        code: ORDER_UNSIGNED_CODE,
        message: "Antes de pagar, é preciso aceitar as condições de adesão, em Definições, Plano.",
      });
    }
  }

  /** A fatura de uma mensalidade, em base64, para descarregar na consola. */
  async faturaParaAConsola(ctx: RequestContext, noticeId: string) {
    if (!this.podePagar(ctx)) throw new ForbiddenException("Só quem representa o clube pode descarregar as faturas.");
    const aviso = await this.prisma.runAs(ctx.academyId, (db) =>
      db.subscriptionNotice.findFirst({
        where: { id: noticeId, academyId: ctx.academyId },
        select: { invoicePath: true, invoiceFileName: true },
      }),
    );
    if (!aviso?.invoicePath) throw new NotFoundException("Esta mensalidade ainda não tem fatura.");
    const dados = await this.storage.download(FATURAS_BUCKET, aviso.invoicePath);
    if (!dados) throw new NotFoundException("Não foi possível ler a fatura.");
    return { ficheiro: aviso.invoiceFileName ?? "fatura.pdf", base64: dados.toString("base64") };
  }

  private async avisoPorPagar(ctx: RequestContext, noticeId: string) {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const aviso = await db.subscriptionNotice.findFirst({
        where: { id: noticeId, academyId: ctx.academyId },
        select: {
          id: true, periodStart: true, periodEnd: true, amountCents: true, paidAt: true,
          payments: { select: { method: true, status: true, entity: true, reference: true, expiresAt: true, amountCents: true } },
        },
      });
      if (!aviso) throw new NotFoundException("Mensalidade não encontrada");
      if (aviso.paidAt) throw new BadRequestException("Esta mensalidade já está paga.");
      if (aviso.amountCents <= 0) throw new BadRequestException("Esta mensalidade não tem valor a pagar.");

      const academy = await db.academy.findFirstOrThrow({ where: { id: ctx.academyId }, select: { slug: true, name: true } });
      const vinculo = await db.membership.findFirst({
        where: { id: ctx.membershipId },
        select: { user: { select: { name: true, email: true } } },
      });
      const pagador = { name: vinculo?.user.name ?? academy.name, email: vinculo?.user.email ?? "" };
      return { aviso, academy, pagador };
    });
  }

  /* ------------------------------------------------------------- o webhook */

  /**
   * Um aviso da euPago que pode ser nosso.
   *
   * Devolve `false` quando nenhuma das referências é de um pagamento à
   * plataforma, e o webhook segue para os pagamentos aos clubes. Idempotente:
   * o mesmo "pago" duas vezes não marca nada duas vezes.
   */
  async tratarWebhook(
    refs: string[],
    status: string,
    quando: Date,
    payload: Record<string, unknown>,
    paidCents?: number,
  ): Promise<boolean> {
    let academyId: string | null = null;
    for (const ref of refs) {
      const rows = await this.prisma.$queryRaw<{ academy: string | null }[]>`
        SELECT app.resolve_subscription_payment(${ref}) AS academy
      `;
      academyId = rows[0]?.academy ?? null;
      if (academyId) break;
    }
    if (!academyId) return false;

    const resultado = await this.prisma.runAs(academyId, async (db) => {
      const pagamento = await db.subscriptionPayment.findFirst({
        where: { academyId, OR: [{ identifier: { in: refs } }, { providerRef: { in: refs } }, { reference: { in: refs } }] },
        include: { notice: { select: { id: true, paidAt: true, periodStart: true, periodEnd: true, amountCents: true, planName: true, billingPeriod: true } } },
      });
      if (!pagamento) return null;

      if (status === "PAID") {
        if (pagamento.status === "PAID") return { pagamento, repetido: true };
        if (paidCents !== undefined && paidCents !== pagamento.amountCents) {
          this.log.warn(`Mensalidade ${pagamento.identifier}: a euPago diz ${paidCents} cêntimos, esperava ${pagamento.amountCents}`);
        }
        await db.subscriptionPayment.update({
          where: { id: pagamento.id },
          data: { status: "PAID", paidAt: quando, payload: payload as object },
        });
        return { pagamento, repetido: false };
      }

      if (status === "EXPIRED" || status === "ERROR" || status === "CANCEL") {
        if (pagamento.status === "PENDING") {
          await db.subscriptionPayment.update({
            where: { id: pagamento.id },
            data: {
              status: status === "EXPIRED" ? "EXPIRED" : "FAILED",
              failureNote: status === "EXPIRED" ? "A referência expirou sem ser paga." : "O pagamento foi recusado ou cancelado.",
              payload: payload as object,
            },
          });
        }
        return null;
      }
      return null;
    });

    if (!resultado || resultado.repetido) return true;
    const { pagamento } = resultado;

    /*
     * O aviso dado como pago, com o movimento nas contas da plataforma, e o
     * clube reaberto se estava suspenso: tudo o que o botão "Recebido" do
     * painel já fazia, pelo mesmo caminho.
     */
    if (!pagamento.notice.paidAt) {
      await this.finance.marcarNoticePaga(null, pagamento.noticeId, {
        paidAt: quando.toISOString(),
        note: `euPago ${METODO_LABEL[pagamento.method]} · ${pagamento.providerRef ?? pagamento.identifier}`,
        method: pagamento.method,
      });
    }

    await this.confirmar(academyId, pagamento.method, pagamento.providerRef ?? pagamento.identifier, quando, pagamento.notice);
    return true;
  }

  /** O recibo ao clube, e o aviso a quem factura. Fora de qualquer transacção. */
  private async confirmar(
    academyId: string,
    method: SubscriptionPaymentMethod,
    ref: string,
    quando: Date,
    notice: { periodStart: Date; periodEnd: Date; amountCents: number; planName: string; billingPeriod: SubscriptionBillingPeriod },
  ) {
    const ctx = await this.prisma.runAs(academyId, async (db) => {
      const academy = await db.academy.findFirstOrThrow({
        where: { id: academyId },
        select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
      });
      const responsavel = await responsavelDoClube(db, academyId);
      const assinada = await db.subscriptionOrder.findFirst({
        where: { academyId, status: "SIGNED" },
        orderBy: { signedAt: "desc" },
        select: { institutionName: true, institutionTaxId: true },
      });
      return { academy, responsavel, assinada };
    });
    const metodo = METODO_LABEL[method] ?? method;

    if (ctx.responsavel) {
      await this.mail
        .send({
          to: ctx.responsavel.email,
          toName: ctx.responsavel.name,
          kind: "subscription-recebido",
          ...subscriptionPaymentEmail({
            brand: { shortName: ctx.academy.shortName, name: ctx.academy.name, signalColor: ctx.academy.signalColor, logoUrl: ctx.academy.logoUrl },
            kind: "recebido",
            name: ctx.responsavel.name,
            title: ctx.responsavel.title,
            planName: notice.planName,
            annual: notice.billingPeriod === "ANNUAL",
            amountCents: notice.amountCents,
            periodStart: notice.periodStart,
            periodEnd: notice.periodEnd,
            metodo,
            paidAt: quando,
            link: this.avisos.linkDaConsola(ctx.academy.slug),
          }),
        })
        .catch((e) => this.log.warn(`Recibo da mensalidade não saiu: ${e instanceof Error ? e.message : e}`));
    }

    const destinos = (this.config.get<string>("PLATFORM_ALERT_EMAIL") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    if (destinos.length === 0) {
      this.log.warn(`Pagamento da mensalidade de ${ctx.academy.slug} recebido e ninguém a avisar: falta PLATFORM_ALERT_EMAIL`);
      return;
    }
    const base = (this.config.get<string>("PLATFORM_BASE_URL") ?? "https://admin.academias.pt").replace(/\/$/, "");
    const carta = platformPaymentAlertEmail({
      clubName: ctx.academy.name,
      slug: ctx.academy.slug,
      institutionName: ctx.assinada?.institutionName ?? null,
      taxId: ctx.assinada?.institutionTaxId ?? null,
      periodStart: notice.periodStart,
      periodEnd: notice.periodEnd,
      amountCents: notice.amountCents,
      metodo,
      providerRef: ref,
      paidAt: quando,
      link: `${base}/academias/${academyId}`,
    });
    for (const to of destinos) {
      await this.mail
        .send({ to, subject: carta.subject, html: carta.html, text: carta.text, kind: "platform-payment-alert" })
        .catch((e) => this.log.warn(`Aviso de factura não saiu: ${e instanceof Error ? e.message : e}`));
    }
  }
}

/** Seis caracteres, para a mesma mensalidade poder ter mais do que uma referência sem chocar. */
function sufixo(): string {
  return randomBytes(4).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase().padEnd(6, "X");
}
