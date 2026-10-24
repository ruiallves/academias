import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import { bilhetesAnuladosEmail, bilhetesEmail, bilhetesForaDoPrazoEmail, type MailBrand } from "../mail/mail.templates";
import { formatarNoFuso } from "../common/fuso";
import { bloquearJogo, contextoDoJogo } from "./contexto";
import { codigoDoBilhete, destinoDoPagamento, type TipoDeCodigo } from "./regras";

/**
 * O que acontece quando o dinheiro chega: emitir os bilhetes, ou marcar o
 * reembolso. E os emails dos bilhetes.
 *
 * Vive à parte da compra (`BilheteiraService`) porque é chamado pelo webhook
 * da euPago (`BillingService.confirmPayment`), e a compra chama o
 * `BillingService` para criar o pagamento: os dois num serviço só eram uma
 * dependência circular.
 *
 * ## Depois do commit
 *
 * `pagamentoConfirmado` escreve dentro da transação do webhook e devolve o
 * email a enviar, que quem chama só envia depois de a transação acabar. Um
 * email com bilhetes de uma compra que depois desfez é o pior engano possível
 * numa bilheteira. Ver `academia-push-depois-do-commit`.
 */
@Injectable()
export class BilheteiraEmissao {
  private readonly log = new Logger(BilheteiraEmissao.name);
  private readonly segredoQr: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
  ) {
    /*
     * O segredo assina os QR dos bilhetes e dos lugares anuais, as credenciais
     * de sócio e as sessões do leitor. Mudá-lo invalida todos os bilhetes já
     * emitidos, por isso deve ser próprio (`TICKET_QR_SECRET`) e não o do
     * Supabase, que pode ter de rodar por outras razões. Em produção, sem
     * nenhum dos dois, a API não arranca: um segredo inventado no arranque
     * deitava fora todos os bilhetes na próxima reinicialização.
     */
    const s = this.config.get<string>("TICKET_QR_SECRET") || this.config.get<string>("SUPABASE_JWT_SECRET") || "";
    if (!s && process.env.NODE_ENV === "production") throw new Error("Falta TICKET_QR_SECRET (ou SUPABASE_JWT_SECRET) para assinar os bilhetes");
    if (!s) this.log.warn("Sem TICKET_QR_SECRET nem SUPABASE_JWT_SECRET: os códigos dos bilhetes só valem até a API reiniciar");
    else if (!this.config.get<string>("TICKET_QR_SECRET")) this.log.warn("Sem TICKET_QR_SECRET: os bilhetes são assinados com o segredo do Supabase; rodá-lo invalida os bilhetes emitidos");
    this.segredoQr = s || randomBytes(32).toString("hex");
  }

  /** O segredo dos códigos QR. O leitor precisa dele para os verificar. */
  segredo(): string {
    return this.segredoQr;
  }

  codigo(tipo: TipoDeCodigo, id: string): string {
    return codigoDoBilhete(this.segredoQr, tipo, id);
  }

  /** Um token aleatório para a página dos bilhetes de uma compra. */
  novoAcesso(): string {
    return randomBytes(24).toString("base64url");
  }

  /**
   * O pagamento de uma compra chegou. Escreve o que a regra manda
   * (`destinoDoPagamento`) e devolve o email a enviar depois do commit.
   */
  async pagamentoConfirmado(
    db: ScopedClient,
    academyId: string,
    orderId: string,
    pagoEm: Date,
    valorCents: number,
  ): Promise<(() => Promise<void>) | null> {
    // O jogo bloqueia-se **antes** de ler a compra: lida antes, podia estar a
    // expirar e a ver os lugares revendidos por uma compra que segurava o bloqueio.
    const doJogo = await db.ticketOrder.findFirst({ where: { id: orderId }, select: { matchId: true } });
    if (!doJogo) return null;
    await bloquearJogo(db, doJogo.matchId);
    const pedido = await db.ticketOrder.findFirst({ where: { id: orderId }, include: { tickets: true } });
    if (!pedido) return null;

    /*
     * Uma compra ainda marcada como guardada mas com os 10 minutos passados
     * já não segura lugares (a lotação conta pelo relógio, `ocupadosPorBancada`),
     * e outra compra pode tê-los levado: conta como expirada, com a lotação
     * verificada outra vez.
     */
    const estado = pedido.status === "RESERVED" && pedido.reservedUntil <= new Date() ? "EXPIRED" : pedido.status;
    let aindaHaLugar = true;
    if (estado === "EXPIRED") {
      const ctx = await contextoDoJogo(db, academyId, pedido.matchId, new Date(), pedido.id);
      const precisa = new Map<string, number>();
      for (const t of pedido.tickets) precisa.set(t.bancadaId, (precisa.get(t.bancadaId) ?? 0) + 1);
      aindaHaLugar =
        !!ctx &&
        [...precisa].every(([b, n]) => ctx.livres[b] === null || ctx.livres[b] === undefined || (ctx.livres[b] ?? 0) >= n) &&
        (ctx.livresNoJogo === null || ctx.livresNoJogo >= pedido.tickets.length);
    }

    const destino = destinoDoPagamento({ status: estado, reservedUntil: pedido.reservedUntil, pagoEm, aindaHaLugar });

    if (destino === "ja-tratado") {
      // Um segundo pagamento da mesma compra (a pessoa pagou duas vezes): o dinheiro a mais devolve-se.
      if (pedido.status === "PAID" || pedido.status === "LATE_PAYMENT" || pedido.status === "CANCELLED") {
        await db.ticketOrder.update({
          where: { id: pedido.id },
          data: {
            refundDueCents: (pedido.refundDueCents ?? 0) + valorCents,
            refundNote: [pedido.refundNote, "Pagamento repetido: devolver o segundo."].filter(Boolean).join(" "),
          },
        });
        this.log.error(`PAGAMENTO REPETIDO na compra de bilhetes ${pedido.id}: ${(valorCents / 100).toFixed(2)} € a devolver`);
      }
      return null;
    }

    if (destino === "reembolso") {
      await db.ticketOrder.update({
        where: { id: pedido.id },
        data: { status: "LATE_PAYMENT", paidAt: pagoEm, refundDueCents: valorCents },
      });
      await db.matchTicket.updateMany({ where: { orderId: pedido.id }, data: { status: "VOID" } });
      return () => this.enviarForaDoPrazo(academyId, pedido.id);
    }

    await db.ticketOrder.update({ where: { id: pedido.id }, data: { status: "PAID", paidAt: pagoEm } });
    // Uma compra dada por expirada tinha os bilhetes anulados: voltam a valer.
    await db.matchTicket.updateMany({ where: { orderId: pedido.id, status: "VOID" }, data: { status: "VALID" } });
    return () => this.enviarBilhetes(academyId, pedido.id);
  }

  /* ------------------------------------------------------------------------ */
  /* Emails                                                                     */
  /* ------------------------------------------------------------------------ */

  private async clube(db: ScopedClient, academyId: string) {
    const a = await db.academy.findFirst({
      where: { id: academyId },
      select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true, siteDomain: true },
    });
    const brand: MailBrand = { shortName: a?.shortName ?? "Clube", name: a?.name ?? "Clube", signalColor: a?.signalColor, logoUrl: a?.logoUrl };
    return { a, brand };
  }

  /** Onde vive a página dos bilhetes: o domínio do clube, ou a pré-visualização do site. */
  enderecoDosBilhetes(a: { slug: string; siteDomain: string | null } | null, token: string): string {
    const preview = this.config.get<string>("SITE_PREVIEW_DOMAIN") ?? "website.academias.pt";
    const base = a?.siteDomain ? `https://${a.siteDomain}` : `https://${a?.slug ?? ""}.${preview}`;
    return `${base}/bilhete/${token}`;
  }

  /** Quem joga em casa vem primeiro: "Seniores vs SC Braga B", ou "SC Braga B vs Seniores" fora. */
  private nomeDoJogo(teamName: string, opponent: string, isHome: boolean): string {
    return isHome ? `${teamName} vs ${opponent}` : `${opponent} vs ${teamName}`;
  }

  /** Os bilhetes de uma compra paga, com um QR em anexo por bilhete. Também serve o "Reenviar" da consola. */
  async enviarBilhetes(academyId: string, orderId: string): Promise<void> {
    const dados = await this.prisma.runAs(academyId, async (db) => {
      const pedido = await db.ticketOrder.findFirst({
        where: { id: orderId, status: "PAID" },
        include: { tickets: { where: { status: { not: "VOID" } }, orderBy: { createdAt: "asc" } } },
      });
      if (!pedido) return null;
      const jogo = await db.match.findFirst({ where: { id: pedido.matchId }, select: { startsAt: true, opponent: true, isHome: true, team: { select: { name: true } } } });
      const venda = await db.siteMatchTickets.findUnique({ where: { matchId: pedido.matchId }, select: { venueId: true } });
      const config = await db.siteConfig.findUnique({ where: { academyId }, select: { venues: true } });
      const recinto = (Array.isArray(config?.venues) ? (config!.venues as { id?: string; nome?: string }[]) : []).find((r) => r?.id === venda?.venueId);
      return { pedido, jogo, recinto: recinto?.nome ?? null, ...(await this.clube(db, academyId)) };
    });
    if (!dados?.jogo) return;

    const { pedido, jogo, a, brand } = dados;
    const anexos = await Promise.all(
      pedido.tickets.map(async (t, i) => ({
        filename: `bilhete-${i + 1}.png`,
        content: (await QRCode.toBuffer(this.codigo("T", t.id), { width: 512, margin: 2, errorCorrectionLevel: "M" })).toString("base64"),
        type: "image/png",
      })),
    );
    const corpo = bilhetesEmail({
      brand,
      nome: pedido.buyerName,
      jogo: this.nomeDoJogo(jogo.team.name, jogo.opponent, jogo.isHome),
      quando: formatarNoFuso(jogo.startsAt, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }),
      recinto: dados.recinto,
      bilhetes: pedido.tickets.map((t) => ({ tipo: t.typeName })),
      link: this.enderecoDosBilhetes(a, pedido.accessToken),
    });
    await this.mail.send({ to: pedido.buyerEmail, toName: pedido.buyerName, ...corpo, attachments: anexos, kind: "bilhetes" });
  }

  async enviarForaDoPrazo(academyId: string, orderId: string): Promise<void> {
    const dados = await this.prisma.runAs(academyId, async (db) => {
      const pedido = await db.ticketOrder.findFirst({ where: { id: orderId } });
      if (!pedido) return null;
      const jogo = await db.match.findFirst({ where: { id: pedido.matchId }, select: { opponent: true, isHome: true, team: { select: { name: true } } } });
      return { pedido, jogo, ...(await this.clube(db, academyId)) };
    });
    if (!dados?.jogo) return;
    const corpo = bilhetesForaDoPrazoEmail({
      brand: dados.brand,
      nome: dados.pedido.buyerName,
      jogo: this.nomeDoJogo(dados.jogo.team.name, dados.jogo.opponent, dados.jogo.isHome),
      valor: euros(dados.pedido.refundDueCents ?? dados.pedido.totalCents),
    });
    await this.mail.send({ to: dados.pedido.buyerEmail, toName: dados.pedido.buyerName, ...corpo, kind: "bilhetes-fora-do-prazo" });
  }

  async enviarAnulados(academyId: string, orderId: string, motivo: string): Promise<void> {
    const dados = await this.prisma.runAs(academyId, async (db) => {
      const pedido = await db.ticketOrder.findFirst({ where: { id: orderId } });
      if (!pedido) return null;
      const jogo = await db.match.findFirst({ where: { id: pedido.matchId }, select: { opponent: true, isHome: true, team: { select: { name: true } } } });
      return { pedido, jogo, ...(await this.clube(db, academyId)) };
    });
    if (!dados?.jogo) return;
    const corpo = bilhetesAnuladosEmail({
      brand: dados.brand,
      nome: dados.pedido.buyerName,
      jogo: this.nomeDoJogo(dados.jogo.team.name, dados.jogo.opponent, dados.jogo.isHome),
      motivo,
      valor: dados.pedido.refundDueCents ? euros(dados.pedido.refundDueCents) : null,
    });
    await this.mail.send({ to: dados.pedido.buyerEmail, toName: dados.pedido.buyerName, ...corpo, kind: "bilhetes-anulados" });
  }
}

export function euros(cents: number): string {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(cents / 100);
}
