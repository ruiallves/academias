import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import {
  encomendaAnuladaEmail,
  encomendaEmail,
  encomendaEnviadaEmail,
  encomendaForaDoPrazoEmail,
  encomendaParaOClubeEmail,
  encomendaProntaEmail,
  type EntregaEmail,
  type LinhaDaEncomendaEmail,
  type MailBrand,
} from "../mail/mail.templates";
import { identidadeValida, lojaValida, stockValido } from "../site/site.tipos";
import { aindaHaStock, bloquearLoja } from "./contexto";
import { destinoDoPagamento, moradaValida, type Morada } from "./regras";

/**
 * O que acontece quando o dinheiro de uma encomenda chega: confirmar e
 * descontar o stock, ou marcar o reembolso. E os emails da loja.
 *
 * Vive à parte da compra (`LojaService`) pela mesma razão da bilheteira:
 * é chamado pelo webhook da euPago (`BillingService.confirmPayment`), e a
 * compra chama o `BillingService` para criar o pagamento.
 *
 * ## Depois do commit
 *
 * `pagamentoConfirmado` escreve dentro da transação do webhook e devolve o
 * email a enviar, que quem chama só envia depois de a transação acabar. Ver
 * `academia-push-depois-do-commit`.
 */

type EncomendaComLinhas = Prisma.SiteOrderGetPayload<{ include: { items: true } }>;

@Injectable()
export class LojaEmissao {
  private readonly log = new Logger(LojaEmissao.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
  ) {}

  /** Um token aleatório para a página da encomenda. */
  novoAcesso(): string {
    return randomBytes(24).toString("base64url");
  }

  /* ------------------------------------------------------------------------ */
  /* O pagamento chegou                                                         */
  /* ------------------------------------------------------------------------ */

  /**
   * O pagamento de uma encomenda chegou. Escreve o que a regra manda
   * (`destinoDoPagamento`) e devolve o email a enviar depois do commit.
   */
  async pagamentoConfirmado(db: ScopedClient, academyId: string, orderId: string, pagoEm: Date, valorCents: number): Promise<(() => Promise<void>) | null> {
    // A loja bloqueia-se **antes** de ler a encomenda: lida antes, podia estar a
    // expirar e a ver o stock levado por outra encomenda que segurava o bloqueio.
    await bloquearLoja(db, academyId);
    const encomenda = await db.siteOrder.findFirst({ where: { id: orderId }, include: { items: true } });
    if (!encomenda) return null;

    const agora = new Date();
    const estado = encomenda.status === "RESERVED" && encomenda.reservedUntil <= agora ? "EXPIRED" : encomenda.status;
    const haStock = estado === "EXPIRED" ? await aindaHaStock(db, encomenda, agora) : true;
    const destino = destinoDoPagamento({ status: estado, reservedUntil: encomenda.reservedUntil, pagoEm, aindaHaStock: haStock });

    if (destino === "ja-tratado") {
      // Um segundo pagamento da mesma encomenda (a pessoa pagou duas vezes): o dinheiro a mais devolve-se.
      await db.siteOrder.update({
        where: { id: encomenda.id },
        data: {
          refundDueCents: (encomenda.refundDueCents ?? 0) + valorCents,
          refundNote: [encomenda.refundNote, "Pagamento repetido: devolver o segundo."].filter(Boolean).join(" "),
        },
      });
      this.log.error(`PAGAMENTO REPETIDO na encomenda ${encomenda.id} (n.º ${encomenda.number}): ${(valorCents / 100).toFixed(2)} € a devolver`);
      return null;
    }

    if (destino === "reembolso") {
      await db.siteOrder.update({ where: { id: encomenda.id }, data: { status: "LATE_PAYMENT", paidAt: pagoEm, refundDueCents: valorCents } });
      return () => this.enviarForaDoPrazo(academyId, encomenda.id);
    }

    await this.descontarStock(db, academyId, encomenda);
    await db.siteOrder.update({ where: { id: encomenda.id }, data: { status: "PAID", paidAt: pagoEm } });
    return async () => {
      await this.enviarConfirmacao(academyId, encomenda.id);
      await this.avisarClube(academyId, encomenda.id).catch((e: unknown) => this.log.warn(`Aviso da encomenda ${encomenda.id} ao clube falhou: ${e instanceof Error ? e.message : e}`));
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Stock                                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * A encomenda foi paga: o stock desce. Num produto do Inventário, a variante
   * leva uma saída (`EXIT`) com a encomenda no motivo, sem quem a fez (foi o
   * site); num produto sem artigo, o número gravado no produto desce. O total
   * do Inventário nunca desce abaixo do que está entregue a atletas: se o
   * clube mexeu no stock entretanto, fica registado no log e segue-se.
   */
  private async descontarStock(db: ScopedClient, academyId: string, encomenda: EncomendaComLinhas): Promise<void> {
    await this.moverStock(db, academyId, encomenda, "EXIT");
  }

  /** O contrário: uma encomenda paga anulada pelo clube devolve os artigos ao stock. */
  async reporStock(db: ScopedClient, academyId: string, encomenda: EncomendaComLinhas): Promise<void> {
    await this.moverStock(db, academyId, encomenda, "ENTRY");
  }

  private async moverStock(db: ScopedClient, academyId: string, encomenda: EncomendaComLinhas, sentido: "EXIT" | "ENTRY"): Promise<void> {
    const motivo = sentido === "EXIT" ? `Venda no site · encomenda n.º ${encomenda.number}` : `Encomenda n.º ${encomenda.number} anulada`;
    for (const linha of encomenda.items) {
      if (linha.variantId) {
        const v = await db.inventoryVariant.findFirst({ where: { id: linha.variantId }, select: { id: true, totalQuantity: true, assignedQuantity: true } });
        if (!v) continue;
        const novoTotal = sentido === "EXIT" ? Math.max(v.assignedQuantity, v.totalQuantity - linha.quantity) : v.totalQuantity + linha.quantity;
        if (sentido === "EXIT" && v.totalQuantity - linha.quantity < v.assignedQuantity) {
          this.log.warn(`Encomenda n.º ${encomenda.number}: a variante ${v.id} tinha ${v.totalQuantity - v.assignedQuantity} disponíveis para ${linha.quantity} vendidas; o total ficou no mínimo`);
        }
        await db.inventoryVariant.update({ where: { id: v.id }, data: { totalQuantity: novoTotal } });
        await db.inventoryMovement.create({
          data: { academyId, variantId: v.id, type: sentido, quantity: Math.abs(novoTotal - v.totalQuantity), reason: motivo, performedById: null },
        });
        continue;
      }
      if (!linha.productId) continue;
      const p = await db.siteProduct.findFirst({ where: { id: linha.productId }, select: { id: true, stock: true, inventoryItemId: true } });
      if (!p || p.inventoryItemId) continue;
      const stock = stockValido(p.stock);
      if (!(linha.size in stock)) continue; // sem contagem: não há nada a descer
      stock[linha.size] = Math.max(0, stock[linha.size] + (sentido === "EXIT" ? -linha.quantity : linha.quantity));
      await db.siteProduct.update({ where: { id: p.id }, data: { stock } });
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Emails                                                                     */
  /* ------------------------------------------------------------------------ */

  private async clube(db: ScopedClient, academyId: string) {
    const [a, config] = await Promise.all([
      db.academy.findFirst({ where: { id: academyId }, select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true, siteDomain: true } }),
      db.siteConfig.findUnique({ where: { academyId }, select: { identity: true, shop: true } }),
    ]);
    const brand: MailBrand = { shortName: a?.shortName ?? "Clube", name: a?.name ?? "Clube", signalColor: a?.signalColor, logoUrl: a?.logoUrl };
    return { a, brand, identidade: identidadeValida(config?.identity), loja: lojaValida(config?.shop) };
  }

  /** Onde vive a página da encomenda: o domínio do clube, ou a pré-visualização do site. */
  enderecoDaEncomenda(a: { slug: string; siteDomain: string | null } | null, token: string): string {
    const preview = this.config.get<string>("SITE_PREVIEW_DOMAIN") ?? "website.academias.pt";
    const base = a?.siteDomain ? `https://${a.siteDomain}` : `https://${a?.slug ?? ""}.${preview}`;
    return `${base}/encomenda/${token}`;
  }

  private enderecoDaConsola(slug: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    return base ? `${base.replace(/\/$/, "").replace("{slug}", slug)}/consola/website?secao=loja&vista=encomendas` : `https://${slug}.academias.pt/consola/website?secao=loja&vista=encomendas`;
  }

  private linhasParaEmail(e: EncomendaComLinhas): LinhaDaEncomendaEmail[] {
    return e.items.map((i) => ({ nome: i.productName, tamanho: i.size, quantidade: i.quantity, totalCents: i.quantity * i.unitPriceCents }));
  }

  /** A morada como linhas, para o email e para a página. */
  static moradaEmLinhas(m: Morada | null): string[] {
    if (!m) return [];
    return [m.nome, m.linha1, m.linha2, [m.codigoPostal, m.localidade].filter(Boolean).join(" ")].filter(Boolean);
  }

  private entregaParaEmail(e: EncomendaComLinhas, loja: ReturnType<typeof lojaValida>): EntregaEmail {
    if (e.delivery === "SHIPPING") return { tipo: "SHIPPING", morada: LojaEmissao.moradaEmLinhas(moradaValida(e.address)), nota: loja.envio.nota };
    return { tipo: "PICKUP", local: loja.levantamento.local, nota: loja.levantamento.nota };
  }

  private async lerParaEmail(academyId: string, orderId: string, where: Prisma.SiteOrderWhereInput = {}) {
    return this.prisma.runAs(academyId, async (db) => {
      const encomenda = await db.siteOrder.findFirst({ where: { id: orderId, ...where }, include: { items: { orderBy: { createdAt: "asc" } } } });
      if (!encomenda) return null;
      return { encomenda, ...(await this.clube(db, academyId)) };
    });
  }

  /** A confirmação de uma encomenda paga. Também serve o "Reenviar" da consola. */
  async enviarConfirmacao(academyId: string, orderId: string): Promise<void> {
    const d = await this.lerParaEmail(academyId, orderId, { status: { in: ["PAID", "READY", "SHIPPED", "DELIVERED"] } });
    if (!d) return;
    const corpo = encomendaEmail({
      brand: d.brand,
      nome: d.encomenda.buyerName,
      numero: d.encomenda.number,
      linhas: this.linhasParaEmail(d.encomenda),
      envioCents: d.encomenda.shippingCents,
      totalCents: d.encomenda.totalCents,
      entrega: this.entregaParaEmail(d.encomenda, d.loja),
      link: this.enderecoDaEncomenda(d.a, d.encomenda.accessToken),
    });
    await this.mail.send({ to: d.encomenda.buyerEmail, toName: d.encomenda.buyerName, ...corpo, kind: "encomenda" });
  }

  /** Ao clube: há uma encomenda paga para preparar. Para o email da Identidade do site, se houver. */
  async avisarClube(academyId: string, orderId: string): Promise<void> {
    const d = await this.lerParaEmail(academyId, orderId);
    if (!d || !d.a) return;
    const para = d.identidade.email.trim();
    if (!para) return;
    const corpo = encomendaParaOClubeEmail({
      brand: d.brand,
      numero: d.encomenda.number,
      comprador: { nome: d.encomenda.buyerName, email: d.encomenda.buyerEmail, telefone: d.encomenda.buyerPhone },
      linhas: this.linhasParaEmail(d.encomenda),
      envioCents: d.encomenda.shippingCents,
      totalCents: d.encomenda.totalCents,
      entrega: this.entregaParaEmail(d.encomenda, d.loja),
      nota: d.encomenda.note,
      link: this.enderecoDaConsola(d.a.slug),
    });
    await this.mail.send({ to: para, toName: d.brand.shortName, ...corpo, replyTo: { email: d.encomenda.buyerEmail, name: d.encomenda.buyerName }, kind: "encomenda-clube" });
  }

  async enviarPronta(academyId: string, orderId: string): Promise<void> {
    const d = await this.lerParaEmail(academyId, orderId);
    if (!d) return;
    const corpo = encomendaProntaEmail({
      brand: d.brand,
      nome: d.encomenda.buyerName,
      numero: d.encomenda.number,
      local: d.loja.levantamento.local,
      nota: d.loja.levantamento.nota,
      link: this.enderecoDaEncomenda(d.a, d.encomenda.accessToken),
    });
    await this.mail.send({ to: d.encomenda.buyerEmail, toName: d.encomenda.buyerName, ...corpo, kind: "encomenda-pronta" });
  }

  async enviarEnviada(academyId: string, orderId: string): Promise<void> {
    const d = await this.lerParaEmail(academyId, orderId);
    if (!d) return;
    const corpo = encomendaEnviadaEmail({
      brand: d.brand,
      nome: d.encomenda.buyerName,
      numero: d.encomenda.number,
      morada: LojaEmissao.moradaEmLinhas(moradaValida(d.encomenda.address)),
      rastreio: d.encomenda.trackingCode,
      link: this.enderecoDaEncomenda(d.a, d.encomenda.accessToken),
    });
    await this.mail.send({ to: d.encomenda.buyerEmail, toName: d.encomenda.buyerName, ...corpo, kind: "encomenda-enviada" });
  }

  async enviarForaDoPrazo(academyId: string, orderId: string): Promise<void> {
    const d = await this.lerParaEmail(academyId, orderId);
    if (!d) return;
    const corpo = encomendaForaDoPrazoEmail({ brand: d.brand, nome: d.encomenda.buyerName, numero: d.encomenda.number, valor: euros(d.encomenda.refundDueCents ?? d.encomenda.totalCents) });
    await this.mail.send({ to: d.encomenda.buyerEmail, toName: d.encomenda.buyerName, ...corpo, kind: "encomenda-fora-do-prazo" });
  }

  async enviarAnulada(academyId: string, orderId: string, motivo: string): Promise<void> {
    const d = await this.lerParaEmail(academyId, orderId);
    if (!d) return;
    const corpo = encomendaAnuladaEmail({
      brand: d.brand,
      nome: d.encomenda.buyerName,
      numero: d.encomenda.number,
      motivo,
      valor: d.encomenda.refundDueCents ? euros(d.encomenda.refundDueCents) : null,
    });
    await this.mail.send({ to: d.encomenda.buyerEmail, toName: d.encomenda.buyerName, ...corpo, kind: "encomenda-anulada" });
  }
}

export function euros(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}
