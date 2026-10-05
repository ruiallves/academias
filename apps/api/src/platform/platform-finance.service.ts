import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { PlatformFinanceKind, PlatformFinanceStatus, PlatformRecurrence } from "@prisma/client";
import { PlatformPrisma } from "./platform.prisma";
import { avisosDevidos, chaveDoDia, diaDoClube, periodosDoContrato, soODia, somaDias, somaMeses } from "../subscription/ciclo";
import { SubscriptionNoticesService } from "../subscription/subscription-notices.service";
import { StorageService } from "../storage/storage.service";
import { MailClient } from "../mail/mail.client";
import { subscriptionInvoiceEmail } from "../mail/mail.templates";
import { SELECT_RESPONSAVEL, escolherResponsavel } from "../subscription/responsavel";

/** O bucket privado das faturas da mensalidade da plataforma. */
export const FATURAS_BUCKET = "faturas";
const FATURA_MAX_BYTES = 5 * 1024 * 1024;

/**
 * As contas da plataforma.
 *
 * ## A pergunta que isto responde
 *
 * O painel sabia o MRR e mais nada, e um número de receita sem custos ao lado
 * não diz se o negócio se paga. Aqui entra o outro lado: quanto sai por mês,
 * quanto entrou mesmo, e a partir de que mês é que os clubes que já existem
 * cobrem os gastos fixos.
 *
 * ## De onde vem cada número
 *
 * - **A receita recorrente vem dos clubes**, e não de linhas escritas à mão. O
 *   contrato assinado de cada clube diz quanto e de quanto em quanto tempo (ver
 *   `subscription/ciclo.ts`), e é a mesma conta que emite os avisos mensais.
 *   Assim a previsão e o que o clube recebe por email nunca discordam.
 * - **O recebido** são os avisos dados como pagos. Cada um gera um movimento no
 *   livro, ligado ao aviso — a ligação é única, e por isso marcar duas vezes não
 *   soma duas.
 * - **Os gastos** são os do livro: os fixos, lançados a partir de
 *   `PlatformRecurringExpense`, e os avulsos escritos à mão.
 *
 * ## O IVA
 *
 * Cada movimento guarda o valor com IVA e a taxa; o líquido é uma divisão. As
 * contas mostram os dois, e a previsão corre a **líquido**: é o que fica depois
 * de entregar o IVA, e é com isso que se pagam os custos.
 *
 * As mensalidades dos clubes são o caso especial: o preço combinado com um clube
 * é normalmente sem IVA, e `PlatformFinanceSettings` diz a taxa e se o preço já
 * a inclui.
 */
@Injectable()
export class PlatformFinanceService {
  private readonly log = new Logger(PlatformFinanceService.name);

  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly avisos: SubscriptionNoticesService,
    private readonly storage: StorageService,
    private readonly mail: MailClient,
  ) {}

  /* ---------------------------------------------------------------- definições */

  /** As definições, criadas na primeira vez que alguém abre as contas. */
  async settings() {
    const existente = await this.prisma.platformFinanceSettings.findFirst();
    if (existente) return existente;
    return this.prisma.platformFinanceSettings.create({ data: { updatedAt: new Date() } });
  }

  async saveSettings(dto: {
    openingBalanceCents?: number;
    openingBalanceAt?: string | null;
    subscriptionVatRate?: number;
    subscriptionVatIncluded?: boolean;
  }) {
    const atual = await this.settings();
    return this.prisma.platformFinanceSettings.update({
      where: { id: atual.id },
      data: {
        ...(dto.openingBalanceCents !== undefined ? { openingBalanceCents: Math.round(dto.openingBalanceCents) } : {}),
        ...(dto.openingBalanceAt !== undefined
          ? { openingBalanceAt: dto.openingBalanceAt ? new Date(dto.openingBalanceAt) : null }
          : {}),
        ...(dto.subscriptionVatRate !== undefined ? { subscriptionVatRate: taxaValida(dto.subscriptionVatRate) } : {}),
        ...(dto.subscriptionVatIncluded !== undefined ? { subscriptionVatIncluded: dto.subscriptionVatIncluded } : {}),
        updatedAt: new Date(),
      },
    });
  }

  /* ---------------------------------------------------------------- movimentos */

  async listTransactions(q: { from?: string; to?: string; kind?: PlatformFinanceKind; limit?: number }) {
    const take = Math.min(Math.max(q.limit ?? 200, 1), 500);
    return this.prisma.platformTransaction.findMany({
      where: {
        ...(q.kind ? { kind: q.kind } : {}),
        ...(q.from || q.to
          ? {
              occurredAt: {
                ...(q.from ? { gte: new Date(q.from) } : {}),
                ...(q.to ? { lte: new Date(q.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take,
      include: {
        academy: { select: { id: true, name: true, slug: true } },
        recurring: { select: { id: true, description: true } },
      },
    });
  }

  async createTransaction(
    adminId: string | null,
    dto: {
      kind: PlatformFinanceKind;
      status?: PlatformFinanceStatus;
      description: string;
      amountCents: number;
      vatRate?: number;
      occurredAt: string;
      dueDate?: string | null;
      category?: string | null;
      counterparty?: string | null;
      notes?: string | null;
      academyId?: string | null;
    },
  ) {
    if (!Number.isFinite(dto.amountCents) || dto.amountCents <= 0) {
      throw new BadRequestException("O valor tem de ser maior do que zero");
    }
    return this.prisma.platformTransaction.create({
      data: {
        kind: dto.kind,
        status: dto.status ?? "COMPLETED",
        description: dto.description.trim(),
        amountCents: Math.round(dto.amountCents),
        vatRate: taxaValida(dto.vatRate ?? 23),
        occurredAt: new Date(dto.occurredAt),
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        category: dto.category?.trim() || null,
        counterparty: dto.counterparty?.trim() || null,
        notes: dto.notes?.trim() || null,
        academyId: dto.academyId || null,
        createdById: adminId,
        updatedAt: new Date(),
      },
    });
  }

  async updateTransaction(id: string, dto: Record<string, unknown>) {
    const atual = await this.prisma.platformTransaction.findUnique({ where: { id }, select: { id: true, noticeId: true } });
    if (!atual) throw new NotFoundException("Movimento não encontrado");
    /*
     * Um movimento que veio de um aviso pago não se edita aqui: o valor é o da
     * mensalidade e o dia é o do recebimento. Quem se enganou desmarca o aviso.
     */
    if (atual.noticeId) throw new BadRequestException("Este ganho vem de uma mensalidade. Corrige-o no aviso.");

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof dto.description === "string") data.description = dto.description.trim();
    if (typeof dto.amountCents === "number") data.amountCents = Math.round(dto.amountCents);
    if (typeof dto.vatRate === "number") data.vatRate = taxaValida(dto.vatRate);
    if (typeof dto.occurredAt === "string") data.occurredAt = new Date(dto.occurredAt);
    if (dto.dueDate !== undefined) data.dueDate = dto.dueDate ? new Date(String(dto.dueDate)) : null;
    if (dto.category !== undefined) data.category = String(dto.category ?? "").trim() || null;
    if (dto.counterparty !== undefined) data.counterparty = String(dto.counterparty ?? "").trim() || null;
    if (dto.notes !== undefined) data.notes = String(dto.notes ?? "").trim() || null;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.academyId !== undefined) data.academyId = dto.academyId || null;

    return this.prisma.platformTransaction.update({ where: { id }, data });
  }

  async deleteTransaction(id: string) {
    const atual = await this.prisma.platformTransaction.findUnique({ where: { id }, select: { noticeId: true } });
    if (!atual) throw new NotFoundException("Movimento não encontrado");
    if (atual.noticeId) throw new BadRequestException("Este ganho vem de uma mensalidade. Desmarca o aviso.");
    await this.prisma.platformTransaction.delete({ where: { id } });
    return { ok: true };
  }

  /* -------------------------------------------------------------- gastos fixos */

  listRecurring() {
    return this.prisma.platformRecurringExpense.findMany({ orderBy: [{ isActive: "desc" }, { description: "asc" }] });
  }

  async createRecurring(dto: {
    description: string;
    amountCents: number;
    vatRate?: number;
    recurrence: PlatformRecurrence;
    dayOfMonth?: number;
    month?: number | null;
    category?: string | null;
    counterparty?: string | null;
    notes?: string | null;
    startsOn: string;
    endsOn?: string | null;
  }) {
    if (!Number.isFinite(dto.amountCents) || dto.amountCents <= 0) {
      throw new BadRequestException("O valor tem de ser maior do que zero");
    }
    if (dto.recurrence === "ANNUAL" && !dto.month) throw new BadRequestException("Falta o mês do gasto anual");

    return this.prisma.platformRecurringExpense.create({
      data: {
        description: dto.description.trim(),
        amountCents: Math.round(dto.amountCents),
        vatRate: taxaValida(dto.vatRate ?? 23),
        recurrence: dto.recurrence,
        dayOfMonth: Math.min(Math.max(Math.round(dto.dayOfMonth ?? 1), 1), 28),
        month: dto.recurrence === "ANNUAL" ? Math.min(Math.max(Math.round(dto.month ?? 1), 1), 12) : null,
        category: dto.category?.trim() || null,
        counterparty: dto.counterparty?.trim() || null,
        notes: dto.notes?.trim() || null,
        startsOn: new Date(dto.startsOn),
        endsOn: dto.endsOn ? new Date(dto.endsOn) : null,
        updatedAt: new Date(),
      },
    });
  }

  async updateRecurring(id: string, dto: Record<string, unknown>) {
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof dto.description === "string") data.description = dto.description.trim();
    if (typeof dto.amountCents === "number") data.amountCents = Math.round(dto.amountCents);
    if (typeof dto.vatRate === "number") data.vatRate = taxaValida(dto.vatRate);
    if (typeof dto.recurrence === "string") data.recurrence = dto.recurrence;
    if (typeof dto.dayOfMonth === "number") data.dayOfMonth = Math.min(Math.max(Math.round(dto.dayOfMonth), 1), 28);
    if (dto.month !== undefined) data.month = dto.month === null ? null : Math.min(Math.max(Number(dto.month), 1), 12);
    if (dto.category !== undefined) data.category = String(dto.category ?? "").trim() || null;
    if (dto.counterparty !== undefined) data.counterparty = String(dto.counterparty ?? "").trim() || null;
    if (dto.notes !== undefined) data.notes = String(dto.notes ?? "").trim() || null;
    if (typeof dto.startsOn === "string") data.startsOn = new Date(dto.startsOn);
    if (dto.endsOn !== undefined) data.endsOn = dto.endsOn ? new Date(String(dto.endsOn)) : null;
    if (typeof dto.isActive === "boolean") data.isActive = dto.isActive;

    try {
      return await this.prisma.platformRecurringExpense.update({ where: { id }, data });
    } catch {
      throw new NotFoundException("Gasto fixo não encontrado");
    }
  }

  async deleteRecurring(id: string) {
    try {
      await this.prisma.platformRecurringExpense.delete({ where: { id } });
    } catch {
      throw new NotFoundException("Gasto fixo não encontrado");
    }
    return { ok: true };
  }

  /**
   * Lançar no livro um gasto fixo que já aconteceu.
   *
   * O gasto fixo é uma regra, e a previsão lê a regra; o livro guarda o que se
   * pagou mesmo. Este atalho evita reescrever à mão todos os meses o que já está
   * descrito uma vez.
   */
  async lancarRecorrente(adminId: string | null, id: string, occurredAt?: string) {
    const fixo = await this.prisma.platformRecurringExpense.findUnique({ where: { id } });
    if (!fixo) throw new NotFoundException("Gasto fixo não encontrado");

    return this.prisma.platformTransaction.create({
      data: {
        kind: "EXPENSE",
        status: "COMPLETED",
        description: fixo.description,
        amountCents: fixo.amountCents,
        vatRate: fixo.vatRate,
        occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
        category: fixo.category,
        counterparty: fixo.counterparty,
        recurringId: fixo.id,
        createdById: adminId,
        updatedAt: new Date(),
      },
    });
  }

  /* ------------------------------------------------------- mensalidades pagas */

  /**
   * As mensalidades dos clubes, com o estado de cada uma.
   *
   * É a lista de quem já pagou e de quem está a dever. Vem dos avisos que a
   * varredura emite todos os meses (ver `subscription-notices.service.ts`), e é
   * aqui que se marca o recebimento.
   */
  async listNotices(q: { estado?: "todos" | "por-pagar" | "pagos"; limit?: number }) {
    const take = Math.min(Math.max(q.limit ?? 100, 1), 300);
    return this.prisma.subscriptionNotice.findMany({
      where: {
        ...(q.estado === "por-pagar" ? { paidAt: null } : {}),
        ...(q.estado === "pagos" ? { NOT: { paidAt: null } } : {}),
      },
      orderBy: [{ issuedOn: "desc" }],
      take,
      include: { academy: { select: { id: true, name: true, slug: true } } },
    });
  }

  /**
   * Dar uma mensalidade como paga, e escrever o ganho no livro.
   *
   * O movimento fica ligado ao aviso. Desmarcar apaga-o: o que não foi recebido
   * não pode ficar a somar nas contas.
   */
  async marcarNoticePaga(
    adminId: string | null,
    id: string,
    dto: { paidAt?: string; note?: string; method?: "MBWAY" | "MULTIBANCO" | "MANUAL" },
  ) {
    const aviso = await this.prisma.subscriptionNotice.findUnique({
      where: { id },
      include: { academy: { select: { id: true, name: true } } },
    });
    if (!aviso) throw new NotFoundException("Aviso não encontrado");

    const quando = dto.paidAt ? new Date(dto.paidAt) : new Date();
    const settings = await this.settings();

    await this.prisma.subscriptionNotice.update({
      where: { id },
      // Como se pagou: pela consola (MB WAY, Multibanco) ou à mão, por transferência.
      data: { paidAt: quando, paidNote: dto.note?.trim() || null, paidById: adminId, paidMethod: dto.method ?? "MANUAL" },
    });

    /*
     * O valor do aviso é o do contrato. Se o preço combinado for sem IVA (o
     * caso normal), o que entra na conta é esse valor mais o IVA — e é o valor
     * com IVA que o livro guarda, como em qualquer movimento.
     */
    const comIva = settings.subscriptionVatIncluded
      ? aviso.amountCents
      : Math.round(aviso.amountCents * (1 + settings.subscriptionVatRate / 100));

    const existente = await this.prisma.platformTransaction.findUnique({ where: { noticeId: id } });
    if (existente) {
      await this.prisma.platformTransaction.update({
        where: { id: existente.id },
        data: { occurredAt: soODia(quando), amountCents: comIva, updatedAt: new Date() },
      });
    } else {
      await this.prisma.platformTransaction.create({
        data: {
          kind: "INCOME",
          status: "COMPLETED",
          description: `Mensalidade ${aviso.academy.name}`,
          amountCents: comIva,
          vatRate: settings.subscriptionVatRate,
          occurredAt: soODia(quando),
          category: "Subscrições",
          counterparty: aviso.academy.name,
          academyId: aviso.academyId,
          noticeId: aviso.id,
          createdById: adminId,
          updatedAt: new Date(),
        },
      });
    }

    /*
     * Um clube suspenso por esta mensalidade reabre no mesmo gesto, venha o
     * pagamento da consola ou de uma transferência registada à mão. Falhar
     * aqui não desfaz o pagamento: a varredura seguinte volta a tentar.
     */
    await this.avisos
      .levantarSeEmDia(aviso.academyId)
      .catch((e) => this.log.warn(`Não foi possível reabrir o clube ${aviso.academyId}: ${e instanceof Error ? e.message : e}`));

    return { ok: true, paidAt: quando };
  }

  async desmarcarNotice(id: string) {
    const aviso = await this.prisma.subscriptionNotice.findUnique({
      where: { id },
      select: { id: true, sentAt: true, issuedOn: true },
    });
    if (!aviso) throw new NotFoundException("Aviso não encontrado");
    await this.prisma.platformTransaction.deleteMany({ where: { noticeId: id } });

    /*
     * Um pagamento registado à mão antes do dia do aviso criou a linha do aviso
     * sem email nenhum. Desmarcá-lo apaga essa linha: fica tudo como se nunca
     * tivesse sido registado, e a varredura manda o aviso no dia certo. Se a
     * linha ficasse, a varredura via o período como tratado e o clube nunca
     * recebia o aviso.
     */
    if (!aviso.sentAt && soODia(aviso.issuedOn) > diaDoClube(new Date())) {
      await this.prisma.subscriptionNotice.delete({ where: { id } });
      return { ok: true, apagado: true };
    }

    await this.prisma.subscriptionNotice.update({
      where: { id },
      data: { paidAt: null, paidNote: null, paidById: null },
    });
    // Sem pagamento não há fatura: a que estivesse anexada sai com ele.
    await this.tirarFatura(id);
    return { ok: true };
  }

  /* ------------------------------------------------------ a fatura do pagamento */

  /**
   * Anexar a fatura (PDF) a uma mensalidade paga, e enviá-la ou não.
   *
   * A euPago não emite faturas: emitem-se no Portal das Finanças e anexam-se
   * aqui. Com `enviar`, o responsável do clube recebe o PDF por email; sem,
   * fica só guardada (e à vista na consola do clube). Anexar outra substitui a
   * anterior.
   */
  async anexarFatura(id: string, dto: { fileName: string; base64: string; enviar: boolean }) {
    const aviso = await this.prisma.subscriptionNotice.findUnique({
      where: { id },
      include: { academy: { select: { id: true, slug: true, name: true, shortName: true, signalColor: true, logoUrl: true } } },
    });
    if (!aviso) throw new NotFoundException("Mensalidade não encontrada");
    if (!aviso.paidAt) throw new BadRequestException("A fatura anexa-se a uma mensalidade paga.");

    const dados = Buffer.from(dto.base64.replace(/^data:[^,]*,/, ""), "base64");
    if (dados.length === 0) throw new BadRequestException("O ficheiro chegou vazio.");
    if (dados.length > FATURA_MAX_BYTES) throw new BadRequestException("A fatura tem mais de 5 MB.");
    if (dados.subarray(0, 5).toString("latin1") !== "%PDF-") throw new BadRequestException("A fatura tem de ser um PDF.");

    const limpo = dto.fileName.trim().replace(/[\\/:*?"<>|]+/g, "-") || "fatura";
    const nome = /\.pdf$/i.test(limpo) ? limpo : `${limpo}.pdf`;
    await this.storage.ensureBucket({ name: FATURAS_BUCKET, fileSizeLimit: FATURA_MAX_BYTES, allowedMimeTypes: ["application/pdf"] });
    const key = `${aviso.academyId}/${aviso.id}/${Date.now()}.pdf`;
    await this.storage.upload(FATURAS_BUCKET, key, dados, "application/pdf");
    if (aviso.invoicePath && aviso.invoicePath !== key) {
      await this.storage.remove(FATURAS_BUCKET, aviso.invoicePath).catch(() => undefined);
    }

    let enviadaPara: string | null = null;
    let motivo: string | null = null;
    if (dto.enviar) {
      const vinculos = await this.prisma.membership.findMany({
        where: { academyId: aviso.academyId, isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
        orderBy: { createdAt: "asc" },
        select: SELECT_RESPONSAVEL,
      });
      const responsavel = escolherResponsavel(vinculos);
      if (!responsavel) {
        motivo = "O clube não tem ninguém com poderes para o representar e endereço de email.";
      } else {
        const a = aviso.academy;
        const r = await this.mail.send({
          to: responsavel.email,
          toName: responsavel.name,
          kind: "subscription-invoice",
          attachments: [{ filename: nome, content: dados.toString("base64"), type: "application/pdf" }],
          ...subscriptionInvoiceEmail({
            brand: { shortName: a.shortName, name: a.name, signalColor: a.signalColor, logoUrl: a.logoUrl },
            name: responsavel.name,
            title: responsavel.title,
            annual: aviso.billingPeriod === "ANNUAL",
            amountCents: aviso.amountCents,
            periodStart: aviso.periodStart,
            periodEnd: aviso.periodEnd,
            fileName: nome,
            link: this.avisos.linkDaConsola(a.slug),
          }),
        });
        if (r.sent) enviadaPara = responsavel.email;
        else motivo = r.reason ?? "O email não saiu.";
      }
    }

    const agora = new Date();
    await this.prisma.subscriptionNotice.update({
      where: { id },
      data: {
        invoicePath: key,
        invoiceFileName: nome,
        invoiceSentAt: agora,
        ...(enviadaPara ? { invoiceEmailedTo: enviadaPara, invoiceEmailedAt: agora } : {}),
      },
    });
    return { ok: true, enviadaPara, motivo };
  }

  /** Dar a fatura como enviada por fora: sem ficheiro e sem email. */
  async marcarFaturaEnviada(id: string) {
    const aviso = await this.prisma.subscriptionNotice.findUnique({ where: { id }, select: { paidAt: true } });
    if (!aviso) throw new NotFoundException("Mensalidade não encontrada");
    if (!aviso.paidAt) throw new BadRequestException("A fatura é de uma mensalidade paga.");
    await this.prisma.subscriptionNotice.update({ where: { id }, data: { invoiceSentAt: new Date() } });
    return { ok: true };
  }

  /** Desfazer: tira o ficheiro (se houver) e volta a "falta fatura". O email que saiu, saiu. */
  async tirarFatura(id: string) {
    const aviso = await this.prisma.subscriptionNotice.findUnique({ where: { id }, select: { invoicePath: true } });
    if (!aviso) throw new NotFoundException("Mensalidade não encontrada");
    if (aviso.invoicePath) await this.storage.remove(FATURAS_BUCKET, aviso.invoicePath).catch(() => undefined);
    await this.prisma.subscriptionNotice.update({
      where: { id },
      data: { invoicePath: null, invoiceFileName: null, invoiceSentAt: null, invoiceEmailedTo: null, invoiceEmailedAt: null },
    });
    return { ok: true };
  }

  /** O PDF anexado, em base64, para abrir no painel. */
  async faturaParaDescarregar(id: string) {
    const aviso = await this.prisma.subscriptionNotice.findUnique({
      where: { id },
      select: { invoicePath: true, invoiceFileName: true },
    });
    if (!aviso?.invoicePath) throw new NotFoundException("Esta mensalidade não tem fatura anexada.");
    const dados = await this.storage.download(FATURAS_BUCKET, aviso.invoicePath);
    if (!dados) throw new NotFoundException("Não foi possível ler a fatura.");
    return { ficheiro: aviso.invoiceFileName ?? "fatura.pdf", base64: dados.toString("base64") };
  }

  /* ------------------------------------------- mensalidades de um clube, à mão */

  /**
   * As condições que contam para um clube: a última assinada, senão a que está
   * à espera de assinatura. Muitos clubes pagam antes de assinar, e o registo
   * manual não pode esperar pela assinatura.
   */
  private async condicoesDoClube(academyId: string) {
    const select = {
      id: true, planName: true, billingPeriod: true, amountCents: true,
      startsOn: true, signedAt: true, billingAnchorAt: true, status: true,
    } as const;
    return (
      (await this.prisma.subscriptionOrder.findFirst({
        where: { academyId, status: "SIGNED", signedAt: { not: null } },
        orderBy: { signedAt: "desc" },
        select,
      })) ??
      (await this.prisma.subscriptionOrder.findFirst({
        where: { academyId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
        select,
      }))
    );
  }

  /** O dia de onde se contam os períodos: o mesmo que a varredura usa quando há assinatura. */
  private ancora(o: { billingAnchorAt: Date | null; signedAt: Date | null; startsOn: Date }): Date {
    if (o.billingAnchorAt) return diaDoClube(o.billingAnchorAt);
    if (o.signedAt) return diaDoClube(o.signedAt);
    return soODia(o.startsOn);
  }

  /**
   * As mensalidades de um clube, para a ficha dele: os avisos que existem e os
   * períodos do contrato que ainda não têm aviso (o que está a correr e o
   * seguinte), todos com o botão de dar como recebida.
   */
  async mensalidadesDoClube(academyId: string) {
    const [condicoes, avisos] = await Promise.all([
      this.condicoesDoClube(academyId),
      this.prisma.subscriptionNotice.findMany({
        where: { academyId },
        orderBy: { periodStart: "desc" },
        take: 36,
        select: {
          id: true, periodStart: true, periodEnd: true, issuedOn: true, dueOn: true,
          planName: true, billingPeriod: true, amountCents: true, sentAt: true,
          paidAt: true, paidNote: true, paidMethod: true, remindersSent: true, suspensionSentAt: true,
          invoiceSentAt: true, invoiceFileName: true, invoiceEmailedTo: true, invoiceEmailedAt: true,
          paidBy: { select: { name: true } },
        },
      }),
    ]);

    const porChave = new Map(avisos.map((a) => [chaveDoDia(a.periodStart), a]));
    const linhas = avisos.map((a) => ({
      chave: chaveDoDia(a.periodStart),
      noticeId: a.id as string | null,
      periodStart: a.periodStart,
      periodEnd: a.periodEnd,
      dueOn: a.dueOn as Date | null,
      amountCents: a.amountCents,
      enviado: Boolean(a.sentAt),
      paidAt: a.paidAt,
      paidNote: a.paidNote,
      paidBy: a.paidBy?.name ?? null,
      /** `MBWAY`, `MULTIBANCO` ou `MANUAL`. Nulo por pagar. */
      metodo: a.paidMethod as string | null,
      lembretes: a.remindersSent as number,
      suspensaoAvisada: a.suspensionSentAt !== null,
      /** Nulo = falta tratar a fatura (numa paga). `ficheiro` nulo = marcada como enviada sem anexo. */
      fatura: (a.invoiceSentAt
        ? { em: a.invoiceSentAt, ficheiro: a.invoiceFileName, emailPara: a.invoiceEmailedTo, emailEm: a.invoiceEmailedAt }
        : null) as { em: Date; ficheiro: string | null; emailPara: string | null; emailEm: Date | null } | null,
    }));

    if (condicoes) {
      const hoje = diaDoClube(new Date());
      for (const p of periodosDoContrato({
        ancora: this.ancora(condicoes),
        desde: condicoes.startsOn,
        hoje,
        periodo: condicoes.billingPeriod,
      })) {
        const chave = chaveDoDia(p.periodStart);
        if (porChave.has(chave)) continue;
        // Um aviso com outra âncora (antes de assinar) que já cobre este período.
        if (avisos.some((a) => a.periodStart <= p.periodEnd && a.periodEnd >= p.periodStart)) continue;
        linhas.push({
          chave,
          noticeId: null,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          dueOn: null,
          amountCents: condicoes.amountCents,
          enviado: false,
          paidAt: null,
          paidNote: null,
          paidBy: null,
          metodo: null,
          lembretes: 0,
          suspensaoAvisada: false,
          fatura: null,
        });
      }
    }

    linhas.sort((a, b) => b.periodStart.getTime() - a.periodStart.getTime());
    return {
      condicoes: condicoes
        ? {
            planName: condicoes.planName,
            billingPeriod: condicoes.billingPeriod,
            amountCents: condicoes.amountCents,
            assinadas: condicoes.status === "SIGNED",
            startsOn: condicoes.startsOn,
          }
        : null,
      periodos: linhas,
    };
  }

  /**
   * Dar como recebido o período de um clube que ainda não tem aviso.
   *
   * Cria a linha do aviso (sem email: o clube já pagou) e marca-a paga, com o
   * movimento nas contas, como qualquer outro aviso. Quando o dia desse aviso
   * chegar, a varredura encontra o período tratado e não manda nada.
   */
  async registarPagamentoDoClube(
    adminId: string | null,
    academyId: string,
    dto: { periodStart: string; paidAt?: string; note?: string },
  ) {
    const condicoes = await this.condicoesDoClube(academyId);
    if (!condicoes) throw new BadRequestException("O clube ainda não tem condições emitidas");

    const hoje = diaDoClube(new Date());
    const periodo = periodosDoContrato({
      ancora: this.ancora(condicoes),
      desde: condicoes.startsOn,
      hoje,
      periodo: condicoes.billingPeriod,
      maximo: 480,
    }).find((p) => chaveDoDia(p.periodStart) === dto.periodStart.slice(0, 10));
    if (!periodo) throw new BadRequestException("Esse período não é do contrato deste clube");

    const existente = await this.prisma.subscriptionNotice.findUnique({
      where: { academyId_periodStart: { academyId, periodStart: periodo.periodStart } },
      select: { id: true },
    });
    const id =
      existente?.id ??
      (
        await this.prisma.subscriptionNotice.create({
          data: {
            academyId,
            orderId: condicoes.id,
            periodStart: periodo.periodStart,
            periodEnd: periodo.periodEnd,
            issuedOn: periodo.issuedOn,
            dueOn: somaDias(periodo.issuedOn, 8),
            planName: condicoes.planName,
            billingPeriod: condicoes.billingPeriod,
            amountCents: condicoes.amountCents,
          },
          select: { id: true },
        })
      ).id;

    await this.marcarNoticePaga(adminId, id, { paidAt: dto.paidAt, note: dto.note });
    return { ok: true, noticeId: id };
  }

  /* ------------------------------------------------------------------ resumo */

  /**
   * O estado das contas: este mês, o ano até hoje, e o que está por receber.
   *
   * Tudo a **líquido** além do bruto: é o líquido que paga os custos.
   */
  async resumo() {
    const hoje = soODia(new Date());
    const inicioDoMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
    const inicioDoAno = new Date(Date.UTC(hoje.getUTCFullYear(), 0, 1));

    const [settings, movimentos, porReceber] = await Promise.all([
      this.settings(),
      this.prisma.platformTransaction.findMany({
        where: { occurredAt: { gte: inicioDoAno } },
        select: { kind: true, status: true, amountCents: true, vatRate: true, occurredAt: true },
      }),
      this.prisma.subscriptionNotice.findMany({
        where: { paidAt: null },
        select: { amountCents: true, dueOn: true },
      }),
    ]);

    const soma = (linhas: typeof movimentos, kind: PlatformFinanceKind, desde: Date) =>
      linhas
        .filter((m) => m.kind === kind && m.status === "COMPLETED" && m.occurredAt >= desde)
        .reduce(
          (a, m) => ({ bruto: a.bruto + m.amountCents, liquido: a.liquido + liquido(m.amountCents, m.vatRate) }),
          { bruto: 0, liquido: 0 },
        );

    const mes = { ganhos: soma(movimentos, "INCOME", inicioDoMes), gastos: soma(movimentos, "EXPENSE", inicioDoMes) };
    const ano = { ganhos: soma(movimentos, "INCOME", inicioDoAno), gastos: soma(movimentos, "EXPENSE", inicioDoAno) };

    const emDivida = porReceber.reduce((a, n) => a + n.amountCents, 0);
    const vencidas = porReceber.filter((n) => n.dueOn < hoje).length;

    return {
      mes: {
        ganhosCents: mes.ganhos.bruto,
        ganhosLiquidosCents: mes.ganhos.liquido,
        gastosCents: mes.gastos.bruto,
        gastosLiquidosCents: mes.gastos.liquido,
        saldoLiquidoCents: mes.ganhos.liquido - mes.gastos.liquido,
      },
      ano: {
        ganhosLiquidosCents: ano.ganhos.liquido,
        gastosLiquidosCents: ano.gastos.liquido,
        saldoLiquidoCents: ano.ganhos.liquido - ano.gastos.liquido,
      },
      porReceber: { count: porReceber.length, cents: emDivida, vencidas },
      settings: {
        openingBalanceCents: settings.openingBalanceCents,
        subscriptionVatRate: settings.subscriptionVatRate,
        subscriptionVatIncluded: settings.subscriptionVatIncluded,
      },
    };
  }

  /* ---------------------------------------------------------------- previsão */

  /**
   * Os próximos meses, mês a mês.
   *
   * **Só com os clubes que já existem.** Cada contrato assinado projeta-se pelo
   * seu próprio relógio: quem assinou a 20 paga a 20, e um contrato anual conta
   * uma vez por ano, no mês em que cai. A conta é a mesma que emite os avisos,
   * por isso a previsão e o email do clube dizem o mesmo.
   *
   * `novosPorMes` e `valorNovoCents` são a **simulação**: somam clubes que ainda
   * não existem, e vêm separados no resultado para o gráfico os poder desenhar
   * como o que são. Sem eles, o cenário é o contratado.
   */
  async previsao(q: { meses?: number; novosPorMes?: number; valorNovoCents?: number }) {
    const meses = Math.min(Math.max(q.meses ?? 12, 1), 24);
    const novosPorMes = Math.max(q.novosPorMes ?? 0, 0);
    const valorNovo = Math.max(q.valorNovoCents ?? 0, 0);

    const hoje = diaDoClube(new Date());
    const settings = await this.settings();

    const [ordens, fixos] = await Promise.all([
      this.prisma.subscriptionOrder.findMany({
        where: { status: "SIGNED", NOT: { signedAt: null } },
        orderBy: { signedAt: "desc" },
        select: {
          academyId: true,
          signedAt: true,
          billingAnchorAt: true,
          startsOn: true,
          billingPeriod: true,
          amountCents: true,
          academy: { select: { name: true, status: true, subscription: { select: { status: true } } } },
        },
      }),
      this.prisma.platformRecurringExpense.findMany({ where: { isActive: true } }),
    ]);

    /* Uma ordem por clube: a mais recente das assinadas, como na emissão. */
    const porClube = new Map<string, (typeof ordens)[number]>();
    for (const o of ordens) if (!porClube.has(o.academyId)) porClube.set(o.academyId, o);

    const janelas = Array.from({ length: meses }, (_, i) => {
      const inicio = somaMeses(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)), i);
      const fim = somaDias(somaMeses(inicio, 1), -1);
      return { inicio, fim, chave: chaveDoDia(inicio).slice(0, 7) };
    });

    const linhas = janelas.map((j) => ({
      mes: j.chave,
      receitaCents: 0,
      receitaSimuladaCents: 0,
      gastosCents: 0,
      clubes: 0,
    }));

    /* ---- a receita contratada ---- */
    for (const ordem of porClube.values()) {
      if (ordem.academy.status === "CANCELLED") continue;
      if (ordem.academy.subscription?.status === "CANCELLED") continue;
      if (!ordem.signedAt) continue;

      const liquidoDoClube = settings.subscriptionVatIncluded
        ? liquido(ordem.amountCents, settings.subscriptionVatRate)
        : ordem.amountCents;

      janelas.forEach((j, i) => {
        const devidos = avisosDevidos({
          // O mesmo dia que os avisos usam — ver `subscription-notices.service`.
          assinatura: diaDoClube(ordem.billingAnchorAt ?? ordem.signedAt!),
          desde: ordem.startsOn,
          hoje: j.fim,
          periodo: ordem.billingPeriod,
          jaEmitidos: new Set(),
          /* A janela é o mês inteiro: conta o que cai neste mês e mais nada. */
          janelaDias: Math.round((j.fim.getTime() - j.inicio.getTime()) / 86_400_000) + 1,
        });
        if (devidos.length === 0) return;
        linhas[i].receitaCents += liquidoDoClube * devidos.length;
        linhas[i].clubes += 1;
      });
    }

    /* ---- os gastos fixos ---- */
    for (const fixo of fixos) {
      const valor = liquido(fixo.amountCents, fixo.vatRate);
      janelas.forEach((j, i) => {
        const dia = new Date(Date.UTC(j.inicio.getUTCFullYear(), j.inicio.getUTCMonth(), fixo.dayOfMonth));
        if (dia < soODia(fixo.startsOn)) return;
        if (fixo.endsOn && dia > soODia(fixo.endsOn)) return;
        if (fixo.recurrence === "ANNUAL" && fixo.month !== dia.getUTCMonth() + 1) return;
        linhas[i].gastosCents += valor;
      });
    }

    /* ---- os gastos avulsos já lançados para o futuro ---- */
    const futuros = await this.prisma.platformTransaction.findMany({
      where: { kind: "EXPENSE", occurredAt: { gte: janelas[0].inicio, lte: janelas[janelas.length - 1].fim } },
      select: { amountCents: true, vatRate: true, occurredAt: true, recurringId: true },
    });
    for (const t of futuros) {
      // Um gasto fixo já lançado não conta duas vezes: a regra dele já o contou.
      if (t.recurringId) continue;
      const i = janelas.findIndex((j) => t.occurredAt >= j.inicio && t.occurredAt <= j.fim);
      if (i >= 0) linhas[i].gastosCents += liquido(t.amountCents, t.vatRate);
    }

    /* ---- a simulação ---- */
    if (novosPorMes > 0 && valorNovo > 0) {
      let acumulados = 0;
      linhas.forEach((linha) => {
        // Os clubes que entram num mês só pagam a partir do mês seguinte, como
        // acontece de verdade: o primeiro aviso sai um mês depois de assinar.
        linha.receitaSimuladaCents = acumulados * valorNovo;
        acumulados += novosPorMes;
      });
    }

    const comSaldo = linhas.map((l) => ({
      ...l,
      saldoCents: l.receitaCents + l.receitaSimuladaCents - l.gastosCents,
    }));

    let acumulado = 0;
    const resultado = comSaldo.map((l) => {
      acumulado += l.saldoCents;
      return { ...l, acumuladoCents: acumulado };
    });

    const gastoFixoMensal = fixos
      .filter((f) => f.recurrence === "MONTHLY")
      .reduce((a, f) => a + liquido(f.amountCents, f.vatRate), 0);
    const gastoFixoAnual = fixos
      .filter((f) => f.recurrence === "ANNUAL")
      .reduce((a, f) => a + liquido(f.amountCents, f.vatRate), 0);

    return {
      meses: resultado,
      fixos: { mensalCents: gastoFixoMensal, anualCents: gastoFixoAnual, porMesCents: gastoFixoMensal + Math.round(gastoFixoAnual / 12) },
      clubes: porClube.size,
      /**
       * O primeiro mês em que o contratado cobre os gastos.
       *
       * Exige gastos maiores do que zero: sem nada lançado, zero cobre zero em
       * Janeiro e a página anunciava que o negócio já se pagava a si próprio.
       */
      cobreEm: resultado.find((l) => l.gastosCents > 0 && l.receitaCents >= l.gastosCents)?.mes ?? null,
    };
  }
}

/** O valor sem IVA. A taxa vem em pontos percentuais (23, 13, 6, 0). */
export function liquido(comIva: number, taxa: number): number {
  if (!taxa) return comIva;
  return Math.round(comIva / (1 + taxa / 100));
}

const TAXAS = [0, 6, 13, 23];
function taxaValida(v: number): number {
  const n = Math.round(v);
  if (!TAXAS.includes(n)) throw new BadRequestException("Taxa de IVA inválida");
  return n;
}
