import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { TicketStatus } from "@prisma/client";
import { PlatformPrisma } from "./platform.prisma";
import { PlatformService } from "./platform.service";
import type { PlatformAdminContext } from "./platform.guard";

/**
 * Os pedidos que chegam pelo formulário do site.
 *
 * ## O que isto é, e o que não é
 *
 * É uma **caixa de entrada**: mensagens de estranhos, por triar. Não é o funil de
 * vendas — isso são os `Contact`, que têm responsável, próximo passo agendado e
 * vão ao calendário. Um ticket ou já foi respondido ou ainda não, e mais nada.
 *
 * As duas coisas viviam na mesma tabela e era um erro com duas consequências: o
 * assunto e o número de atletas chegavam desfeitos dentro de uma string, e uma
 * pergunta de alguém que nunca vai ser cliente enchia a lista de quem se anda a
 * trabalhar. Ver a nota na migração `20260826234500_tickets`.
 *
 * O que liga os dois é `converter`: um pedido que **é** um negócio vira um
 * contacto, com um gesto, e fica a apontar para ele.
 *
 * ## Porque é que não há "enviar resposta"
 *
 * Porque este servidor não envia email nenhum — não há SMTP, não há Resend, não há
 * nada. Um botão "Responder" que abrisse um formulário e gravasse o texto dava a
 * entender que a mensagem tinha saído, e não tinha saído. A resposta sai do
 * cliente de email de quem responde, e o que fica aqui são **notas internas**: o
 * que a equipa escreveu para a equipa, mais o estado.
 */

export interface TicketInput {
  status?: TicketStatus;
  /** `null` desatribui. */
  assigneeId?: string | null;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly platform: PlatformService,
  ) {}

  /**
   * Criar a partir do site. Sem sessão — é a entrada da frente.
   *
   * Ao contrário do que estava, os campos ficam em colunas: o assunto é o assunto,
   * os atletas são os atletas. Um `notes` com tudo lá dentro não se filtra, não se
   * ordena e não se conta.
   */
  async createFromSite(
    dto: {
      name: string;
      email: string;
      phone?: string;
      club?: string;
      subject: string;
      subjectId?: string;
      athletes?: string;
      message?: string;
    },
    ip?: string,
  ) {
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException("O nome é preciso");

    const ticket = await this.prisma.ticket.create({
      data: {
        name,
        email: dto.email.trim().toLowerCase(),
        phone: dto.phone?.trim() || null,
        club: dto.club?.trim() || null,
        subject: dto.subject.trim(),
        subjectId: dto.subjectId?.trim() || null,
        athletes: dto.athletes?.trim() || null,
        message: dto.message?.trim() || null,
        status: "NOVO",
        ip: ip ?? null,
      },
      select: { id: true },
    });

    // `admin: null` — é o mesmo `AuditLog` que regista impersonation e criação de
    // clientes, e um pedido do site não tem administrador a assumi-lo. O registo
    // fica na mesma: diz que existiu, quando, e a partir de que IP.
    await this.platform.audit(
      null,
      "ticket.create.site",
      "ticket",
      ticket.id,
      { name, email: dto.email, club: dto.club ?? null, subject: dto.subject },
      ip,
    );

    return { ok: true as const };
  }

  /**
   * A lista, por omissão só o que está por fechar.
   *
   * Uma caixa de entrada que abre com tudo lá dentro, incluindo o que já foi
   * tratado há três meses, deixa de responder à única pergunta que se lhe faz:
   * *o que é que falta?*. Os fechados continuam a existir e vêem-se a pedido.
   */
  async list(params: { status?: TicketStatus | "ABERTOS"; q?: string } = {}) {
    const { status, q } = params;
    const termo = q?.trim();

    const where = {
      ...(status && status !== "ABERTOS"
        ? { status }
        : status === "ABERTOS"
          ? { status: { in: ["NOVO", "ABERTO", "RESPONDIDO"] as TicketStatus[] } }
          : {}),
      ...(termo
        ? {
            OR: [
              { name: { contains: termo, mode: "insensitive" as const } },
              { email: { contains: termo, mode: "insensitive" as const } },
              { club: { contains: termo, mode: "insensitive" as const } },
              { message: { contains: termo, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, contagens] = await Promise.all([
      this.prisma.ticket.findMany({
        where,
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        take: 200,
        select: {
          id: true,
          subject: true,
          subjectId: true,
          name: true,
          email: true,
          phone: true,
          club: true,
          athletes: true,
          message: true,
          status: true,
          createdAt: true,
          assignee: { select: { id: true, name: true } },
          contact: { select: { id: true, name: true, status: true } },
          _count: { select: { notes: true } },
        },
      }),
      this.prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

    return {
      tickets: rows.map((t) => ({
        ...t,
        notes: t._count.notes,
        _count: undefined,
      })),
      counts: Object.fromEntries(contagens.map((c) => [c.status, c._count._all])) as Record<string, number>,
    };
  }

  async get(id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        subject: true,
        subjectId: true,
        name: true,
        email: true,
        phone: true,
        club: true,
        athletes: true,
        message: true,
        status: true,
        ip: true,
        createdAt: true,
        assignee: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, status: true } },
        notes: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            body: true,
            createdAt: true,
            admin: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!ticket) throw new NotFoundException("Pedido não encontrado");
    return ticket;
  }

  async update(admin: PlatformAdminContext, id: string, dto: TicketInput) {
    await this.mustExist(id);

    /*
     * `assigneeId` só aceita um administrador que exista.
     *
     * Sem esta verificação, um id inventado no corpo do pedido dava um erro de
     * chave estrangeira em bruto — 500 em vez de 400, e uma mensagem de Postgres
     * a sair pela API fora.
     */
    if (dto.assigneeId) {
      const existe = await this.prisma.platformAdmin.findUnique({
        where: { id: dto.assigneeId },
        select: { id: true },
      });
      if (!existe) throw new BadRequestException("Esse administrador não existe");
    }

    await this.prisma.ticket.update({
      where: { id },
      data: {
        ...(dto.status ? { status: dto.status } : {}),
        ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
      },
    });

    await this.platform.audit(admin, "ticket.update", "ticket", id, {
      status: dto.status ?? null,
      assigneeId: dto.assigneeId ?? null,
    });

    return this.get(id);
  }

  /** Uma nota interna. Passar o ticket a ABERTO é o efeito de alguém lhe pegar. */
  async addNote(admin: PlatformAdminContext, id: string, body: string) {
    const texto = body.trim();
    if (texto.length < 2) throw new BadRequestException("A nota está vazia");
    const ticket = await this.mustExist(id);

    await this.prisma.ticketNote.create({
      data: { ticketId: id, adminId: admin.id, body: texto },
    });

    /*
     * Escrever uma nota num pedido NOVO é pegar nele.
     *
     * Fazer o estado avançar sozinho aqui evita o passo esquecido que enche a
     * caixa de entrada de coisas que já foram vistas mas continuam a parecer por
     * ver. Só de NOVO para ABERTO: os outros estados são decisões, e uma nota não
     * é uma decisão.
     */
    if (ticket.status === "NOVO") {
      await this.prisma.ticket.update({ where: { id }, data: { status: "ABERTO" } });
    }

    await this.platform.audit(admin, "ticket.note", "ticket", id, {});
    return this.get(id);
  }

  /**
   * Converter num contacto do funil.
   *
   * É a ponte entre a caixa de entrada e as vendas, e é explícita de propósito:
   * criar um contacto por cada pedido que chega era o que fazia a lista de
   * trabalho encher-se de curiosos. Alguém decide que aquele pedido é um negócio,
   * e só então ele passa para o outro lado.
   *
   * Chamar duas vezes não cria dois contactos — devolve o que já existe.
   */
  async converter(admin: PlatformAdminContext, id: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, phone: true, club: true,
        subject: true, athletes: true, message: true, contactId: true,
      },
    });
    if (!ticket) throw new NotFoundException("Pedido não encontrado");
    if (ticket.contactId) return { contactId: ticket.contactId, jaExistia: true };

    const notes = [
      `Veio do site: ${ticket.subject}`,
      ticket.athletes && `Atletas: ${ticket.athletes}`,
      ticket.message,
    ]
      .filter(Boolean)
      .join("\n\n");

    const contact = await this.prisma.contact.create({
      data: {
        name: ticket.name,
        email: ticket.email,
        phone: ticket.phone,
        club: ticket.club,
        notes: notes || null,
        status: "NOVO",
        // Quem converte fica com ele. Um contacto novo sem dono é um contacto que
        // ninguém trabalha, e a lista de vendas já tem um filtro por responsável.
        ownerId: admin.id,
      },
      select: { id: true },
    });

    await this.prisma.ticket.update({
      where: { id },
      data: { contactId: contact.id, assigneeId: ticket.contactId ? undefined : admin.id },
    });

    await this.platform.audit(admin, "ticket.convert", "ticket", id, { contactId: contact.id });
    return { contactId: contact.id, jaExistia: false };
  }

  async remove(admin: PlatformAdminContext, id: string) {
    await this.mustExist(id);
    await this.prisma.ticket.delete({ where: { id } });
    await this.platform.audit(admin, "ticket.delete", "ticket", id, {});
    return { ok: true as const };
  }

  private async mustExist(id: string) {
    const t = await this.prisma.ticket.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!t) throw new NotFoundException("Pedido não encontrado");
    return t;
  }
}
