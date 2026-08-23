import { randomBytes } from "node:crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ContactChannel, ContactStatus } from "@prisma/client";
import { PlatformPrisma } from "./platform.prisma";
import { PlatformService } from "./platform.service";
import type { PlatformAdminContext } from "./platform.guard";

/**
 * Contactos — a lista de quem já falámos e em que pé está.
 *
 * ## O que esta lista é
 *
 * Um sítio para saber a quem se liga hoje. Não é um CRM: não tem funil com etapas
 * configuráveis, não tem campos à medida, não tem probabilidade de fecho. Tem um
 * estado por conversa, um histórico do que se disse, e uma data para o próximo
 * passo — que é a única coisa que gera trabalho amanhã.
 *
 * ## Uma nota sobre a fronteira
 *
 * Estas pessoas são **de fora**. É a diferença que faz isto ser legítimo do lado
 * da plataforma: `docs/04-plataforma.md` diz que o Platform Admin vê o negócio e
 * não vê as pessoas dentro das academias, e continua verdade — ninguém aqui é de
 * uma academia. No dia em que alguém quiser pôr um pai de um cliente nesta tabela,
 * a resposta é não, e a razão é essa.
 *
 * ## O que vai ao registo de auditoria, e o que não vai
 *
 * Criar, apagar e mexer no segredo do calendário ficam no `AuditLog`. Uma chamada
 * registada não fica: o histórico dela **é** a tabela `ContactTouch`, e duplicá-lo
 * no registo de auditoria só tornaria o registo — onde se procura impersonation e
 * criação de clientes — ilegível por excesso.
 */

const DAY = 86_400_000;

/** Meio ano à frente, uma semana atrás. Ver `feedFor`. */
const FEED_AHEAD_DAYS = 180;
const FEED_BEHIND_DAYS = 7;

export type ContactInput = {
  /** Obrigatório a criar, opcional a alterar — ver `ContactDto` no controlador. */
  name?: string;
  phone?: string | null;
  email?: string | null;
  club?: string | null;
  role?: string | null;
  status?: ContactStatus;
  notes?: string | null;
  academyId?: string | null;
  nextActionAt?: string | null;
  nextActionNote?: string | null;
};

export type TouchInput = {
  channel: ContactChannel;
  note?: string | null;
  status?: ContactStatus | null;
  happenedAt?: string | null;
  nextActionAt?: string | null;
  nextActionNote?: string | null;
};

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly platform: PlatformService,
    private readonly config: ConfigService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Leitura                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * A lista toda, de uma vez.
   *
   * Sem paginação de propósito: são contactos de um humano, não linhas de um log.
   * Quem tiver dez mil pessoas nesta tabela já não está a usar isto para o que
   * foi feito — e nessa altura a paginação é o menor dos problemas.
   *
   * A ordem por omissão põe primeiro o que tem seguimento atrasado, depois o que
   * tem seguimento marcado, e só depois o resto. É a ordem em que o dia se faz.
   */
  async list() {
    const rows = await this.prisma.contact.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        owner: { select: { id: true, name: true } },
        academy: { select: { id: true, name: true, slug: true } },
        _count: { select: { touches: true } },
        touches: { orderBy: { happenedAt: "desc" }, take: 1 },
      },
    });

    return rows.map(shape).sort(byUrgency);
  }

  async get(id: string) {
    const row = await this.prisma.contact.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true } },
        academy: { select: { id: true, name: true, slug: true } },
        _count: { select: { touches: true } },
        touches: { orderBy: { happenedAt: "desc" } },
      },
    });
    if (!row) throw new NotFoundException("Contacto não encontrado");

    return {
      ...shape({ ...row, touches: row.touches.slice(0, 1) }),
      touches: row.touches.map((t) => ({
        id: t.id,
        channel: t.channel,
        note: t.note,
        status: t.status,
        byName: t.byName,
        happenedAt: t.happenedAt,
      })),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Escrita                                                                   */
  /* ------------------------------------------------------------------------ */

  async create(admin: PlatformAdminContext, dto: ContactInput, ip?: string) {
    const name = (dto.name ?? "").trim();
    if (name.length < 2) throw new BadRequestException("O nome é preciso");

    const contact = await this.prisma.contact.create({
      data: {
        name,
        ...clean(dto),
        status: dto.status ?? "NOVO",
        // Quem cria acompanha, até alguém dizer o contrário. Uma lista de
        // contactos sem dono é uma lista onde ninguém liga a ninguém.
        ownerId: admin.id,
      },
      select: { id: true, name: true },
    });

    await this.platform.audit(admin, "contact.create", "contact", contact.id, { name, club: dto.club ?? null }, ip);
    return this.get(contact.id);
  }

  async update(admin: PlatformAdminContext, id: string, dto: ContactInput) {
    await this.exists(id);

    const name = dto.name?.trim();
    if (name !== undefined && name.length < 2) throw new BadRequestException("O nome é preciso");

    await this.prisma.contact.update({
      where: { id },
      data: { ...(name ? { name } : {}), ...clean(dto), ...(dto.status ? { status: dto.status } : {}) },
    });

    return this.get(id);
  }

  /**
   * Registar um contacto feito.
   *
   * Três coisas de uma vez, porque na cabeça de quem acabou de desligar o telefone
   * são a mesma: o que aconteceu, em que pé ficou, e quando se volta a falar. Pedir
   * isto em três ecrãs seria garantir que o terceiro nunca se preenche — e o
   * terceiro é o único que faz aparecer trabalho amanhã.
   */
  async addTouch(admin: PlatformAdminContext, id: string, dto: TouchInput) {
    await this.exists(id);

    const happenedAt = parseDate(dto.happenedAt) ?? new Date();

    await this.prisma.$transaction([
      this.prisma.contactTouch.create({
        data: {
          contactId: id,
          channel: dto.channel,
          note: dto.note?.trim() || null,
          status: dto.status ?? null,
          byName: admin.name,
          happenedAt,
        },
      }),
      this.prisma.contact.update({
        where: { id },
        data: {
          ...(dto.status ? { status: dto.status } : {}),
          // Só avança. Registar uma chamada antiga que faltava lançar não pode
          // fazer o contacto parecer mais recente do que o último que houve.
          lastContactAt: happenedAt,
          ...(dto.nextActionAt !== undefined ? { nextActionAt: parseDate(dto.nextActionAt) } : {}),
          ...(dto.nextActionNote !== undefined ? { nextActionNote: dto.nextActionNote?.trim() || null } : {}),
        },
      }),
    ]);

    // `lastContactAt` só recua se não houver nada mais recente — resolvido aqui e
    // não no update acima, que não sabe comparar com o valor que está lá.
    await this.prisma.$executeRaw`
      UPDATE "Contact" c
      SET "lastContactAt" = (SELECT max(t."happenedAt") FROM "ContactTouch" t WHERE t."contactId" = c.id)
      WHERE c.id = ${id}
    `;

    return this.get(id);
  }

  async remove(admin: PlatformAdminContext, id: string, ip?: string) {
    const contact = await this.exists(id);
    await this.prisma.contact.delete({ where: { id } });
    await this.platform.audit(admin, "contact.delete", "contact", id, { name: contact.name }, ip);
    return { ok: true };
  }

  /* ------------------------------------------------------------------------ */
  /* Google Calendar                                                           */
  /* ------------------------------------------------------------------------ */

  /**
   * O endereço do feed a subscrever no Google Calendar.
   *
   * Gera o segredo na primeira vez que alguém pergunta, e não no momento em que a
   * conta é criada: um segredo que nunca foi pedido é um segredo a mais para
   * vazar. `rotate` deita o anterior fora — é o que se faz quando o link foi parar
   * ao sítio errado, e a razão de ele ser por administrador.
   */
  async calendarUrl(admin: PlatformAdminContext, rotate = false, ip?: string) {
    const current = await this.prisma.platformAdmin.findUnique({
      where: { id: admin.id },
      select: { calendarToken: true },
    });

    let token = current?.calendarToken ?? null;
    if (!token || rotate) {
      token = randomBytes(24).toString("base64url");
      await this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { calendarToken: token } });
      await this.platform.audit(admin, rotate ? "contact.calendar.rotate" : "contact.calendar.enable", "admin", admin.id, undefined, ip);
    }

    const base = (this.config.get<string>("PUBLIC_API_URL") ?? "http://localhost:3000").replace(/\/$/, "");
    const url = `${base}/api/agenda/contactos/${token}.ics`;

    return {
      url,
      // O Google só subscreve endereços que consegue ir buscar. Em localhost não
      // consegue, e é melhor dizê-lo aqui do que deixar alguém a olhar para um
      // calendário vazio a perguntar-se o que correu mal.
      reachable: !/localhost|127\.0\.0\.1/.test(base),
      googleAddUrl: `https://calendar.google.com/calendar/r/settings/addbyurl`,
    };
  }

  /**
   * O que o Google vai lá buscar.
   *
   * Autenticado pelo token no URL, porque uma subscrição de calendário não tem
   * onde levar um cabeçalho. Consequências assumidas: quem tiver o link vê os
   * seguimentos — nomes, clubes e telefones de pessoas de fora — e por isso o link
   * é revogável e a rotação fica no registo de auditoria.
   *
   * A janela é apertada de propósito. Um calendário com tudo o que alguma vez foi
   * marcado não é um calendário, é um arquivo — e o Google carrega-o inteiro a
   * cada leitura.
   */
  async feedFor(token: string) {
    if (!token || token.length < 16) return null;

    const admin = await this.prisma.platformAdmin.findFirst({
      where: { calendarToken: token, isActive: true },
      select: { id: true, name: true },
    });
    if (!admin) return null;

    const contacts = await this.prisma.contact.findMany({
      where: {
        nextActionAt: {
          gte: new Date(Date.now() - FEED_BEHIND_DAYS * DAY),
          lte: new Date(Date.now() + FEED_AHEAD_DAYS * DAY),
        },
        // Fechados não geram trabalho. Um contacto perdido com data por apagar
        // ficaria a tocar no telemóvel de alguém para nada.
        status: { notIn: ["CLIENTE", "PERDIDO"] },
      },
      select: {
        id: true, name: true, club: true, phone: true, email: true,
        status: true, nextActionAt: true, nextActionNote: true,
      },
      orderBy: { nextActionAt: "asc" },
    });

    return {
      admin,
      contacts: contacts.filter((c): c is typeof c & { nextActionAt: Date } => c.nextActionAt !== null),
    };
  }

  /* ------------------------------------------------------------------------ */

  private async exists(id: string) {
    const row = await this.prisma.contact.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!row) throw new NotFoundException("Contacto não encontrado");
    return row;
  }
}

/* ---------------------------------------------------------------------------- */

type Row = {
  id: string; name: string; phone: string | null; email: string | null; club: string | null;
  role: string | null; status: ContactStatus; notes: string | null;
  lastContactAt: Date | null; nextActionAt: Date | null; nextActionNote: string | null;
  createdAt: Date; updatedAt: Date;
  owner: { id: string; name: string } | null;
  academy: { id: string; name: string; slug: string } | null;
  _count: { touches: number };
  touches: { channel: ContactChannel; note: string | null; happenedAt: Date }[];
};

function shape(r: Row) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    email: r.email,
    club: r.club,
    role: r.role,
    status: r.status,
    notes: r.notes,
    owner: r.owner,
    academy: r.academy,
    lastContactAt: r.lastContactAt,
    nextActionAt: r.nextActionAt,
    nextActionNote: r.nextActionNote,
    touchCount: r._count.touches,
    lastTouch: r.touches[0] ? { channel: r.touches[0].channel, note: r.touches[0].note, happenedAt: r.touches[0].happenedAt } : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * A ordem do dia: atrasados, marcados, e depois o resto por antiguidade do último
 * contacto — quem há mais tempo não ouve nada é quem mais depressa esfria.
 */
function byUrgency(a: ReturnType<typeof shape>, b: ReturnType<typeof shape>): number {
  const rank = (c: ReturnType<typeof shape>) => {
    if (!c.nextActionAt) return 2;
    return new Date(c.nextActionAt).getTime() <= Date.now() ? 0 : 1;
  };

  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;

  if (ra < 2) return new Date(a.nextActionAt!).getTime() - new Date(b.nextActionAt!).getTime();

  const ta = a.lastContactAt ? new Date(a.lastContactAt).getTime() : 0;
  const tb = b.lastContactAt ? new Date(b.lastContactAt).getTime() : 0;
  return ta - tb;
}

/** Os campos opcionais, com `""` a valer `null` — um campo esvaziado é um campo apagado. */
function clean(dto: ContactInput) {
  const text = (v: string | null | undefined) => (v === undefined ? undefined : v?.trim() || null);
  // `?.toLowerCase()` sobre o resultado transformaria um `null` — um campo
  // esvaziado de propósito — em `undefined`, que o Prisma lê como "não mexer".
  const email = text(dto.email);
  return {
    phone: text(dto.phone),
    email: email ? email.toLowerCase() : email,
    club: text(dto.club),
    role: text(dto.role),
    notes: text(dto.notes),
    nextActionNote: text(dto.nextActionNote),
    ...(dto.nextActionAt !== undefined ? { nextActionAt: parseDate(dto.nextActionAt) } : {}),
    ...(dto.academyId !== undefined ? { academyId: dto.academyId || null } : {}),
  };
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Data inválida");
  return d;
}
