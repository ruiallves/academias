import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ContactChannel, ContactLostReason, Prisma, SalesMeetingMode, SalesMeetingStatus } from "@prisma/client";
import { PlatformPrisma } from "./platform.prisma";
import { PlatformService } from "./platform.service";
import { ContactsService } from "./contacts.service";
import type { PlatformAdminContext } from "./platform.guard";
import {
  atendeu,
  comissoes,
  efeitoDaChamada,
  horasEMinutos,
  inicioDoDiaEDaSemana,
  limitesDoMes,
  mesDe,
  mesValido,
  minutosDoTurno,
  nomeDoMes,
  pagamento,
  type Resultado,
} from "./comercial.regras";

/**
 * A área comercial do painel.
 *
 * O comercial liga aos clubes e marca reuniões; quem faz a reunião (o Rui)
 * marca o resultado. Paga-se à hora, pelos turnos marcados no painel, e por
 * blocos de reuniões marcadas. Este serviço junta as quatro coisas: o ecrã
 * "Hoje", o registo de uma chamada, as reuniões e o mês.
 *
 * ## Quem vê o quê
 *
 * O comercial vê os clubes todos (para saber quem já está com alguém), mas só as
 * reuniões que marcou e só o seu mês. O dono e os administradores veem tudo,
 * marcam o resultado das reuniões, corrigem turnos e aprovam meses.
 */

const DEFAULTS = { hourlyCents: 700, meetingsPerCommission: 10, commissionCents: 0 };

/** Um turno com mais do que isto é quase de certeza um "esqueci-me de terminar". */
const TURNO_MAXIMO_MIN = 16 * 60;

export type ChamadaInput = {
  resultado: Resultado;
  canal?: ContactChannel;
  nota?: string | null;
  voltarEm?: string | null;
  motivo?: ContactLostReason | null;
  reuniao?: ReuniaoInput;
};

export type ReuniaoInput = {
  scheduledAt?: string;
  durationMin?: number;
  mode?: SalesMeetingMode;
  location?: string | null;
  personName?: string;
  personRole?: string | null;
  personPhone?: string | null;
  personEmail?: string | null;
  decides?: boolean | null;
  athletes?: number | null;
  teams?: string | null;
  currentTool?: string | null;
  pain?: string | null;
  suggestedPlan?: string | null;
  notes?: string | null;
  status?: SalesMeetingStatus;
  outcomeNote?: string | null;
  countsForCommission?: boolean;
};

export type TurnoInput = { startedAt?: string; endedAt?: string | null; note?: string | null };

export type CondicoesInput = { hourlyCents: number; meetingsPerCommission: number; commissionCents: number };

@Injectable()
export class ComercialService {
  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly platform: PlatformService,
    private readonly contacts: ContactsService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Hoje                                                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * O que o ecrã "Hoje" precisa além da lista de clubes: o turno, os números do
   * dia e da semana, as próximas reuniões e como vai a comissão.
   */
  async hoje(admin: PlatformAdminContext) {
    const agora = new Date();
    const { dia, semana } = inicioDoDiaEDaSemana(agora);
    const soAsMinhas = admin.role === "COMERCIAL";

    const [turno, chamadasSemana, reunioesSemana, proximas, mes] = await Promise.all([
      this.prisma.salesShift.findFirst({ where: { adminId: admin.id, endedAt: null }, orderBy: { startedAt: "desc" } }),
      this.prisma.contactTouch.findMany({
        where: { byId: admin.id, channel: "CHAMADA", happenedAt: { gte: semana } },
        select: { outcome: true, happenedAt: true },
      }),
      this.prisma.salesMeeting.findMany({
        where: { bookedById: admin.id, createdAt: { gte: semana } },
        select: { createdAt: true },
      }),
      this.prisma.salesMeeting.findMany({
        where: {
          status: "MARCADA",
          scheduledAt: { gte: dia },
          ...(soAsMinhas ? { bookedById: admin.id } : {}),
        },
        orderBy: { scheduledAt: "asc" },
        take: 8,
        include: { contact: { select: { id: true, name: true, locality: true, association: true } } },
      }),
      this.resumoDoMes(admin.id, mesDe(agora), agora),
    ]);

    const deHoje = chamadasSemana.filter((c) => c.happenedAt >= dia);
    const minutosHoje = await this.minutosDesde(admin.id, dia, agora);

    return {
      turno: turno ? { id: turno.id, startedAt: turno.startedAt } : null,
      hoje: {
        chamadas: deHoje.length,
        atendidas: deHoje.filter((c) => atendeu(c.outcome)).length,
        reunioes: reunioesSemana.filter((r) => r.createdAt >= dia).length,
        minutos: minutosHoje,
      },
      semana: {
        chamadas: chamadasSemana.length,
        atendidas: chamadasSemana.filter((c) => atendeu(c.outcome)).length,
        reunioes: reunioesSemana.length,
      },
      proximas: proximas.map(reuniaoCurta),
      mes: {
        month: mes.month,
        minutos: mes.minutes,
        reunioes: mes.meetingsCounted,
        comissao: mes.commission,
        totalCents: mes.totalCents,
        configured: mes.configured,
      },
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Chamada                                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Regista uma chamada e faz ao clube o que ela implica.
   *
   * Numa transação: a linha do histórico, o estado do clube, o próximo
   * seguimento e, quando é o caso, a reunião. Quem regista num clube sem
   * responsável fica com ele.
   */
  async registarChamada(admin: PlatformAdminContext, contactId: string, dto: ChamadaInput) {
    const contacto = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: {
        id: true, status: true, noAnswerCount: true, ownerId: true, phone: true, email: true,
        personName: true, role: true, owner: { select: { name: true } },
      },
    });
    if (!contacto) throw new NotFoundException("Clube não encontrado");

    if (admin.role === "COMERCIAL" && contacto.ownerId && contacto.ownerId !== admin.id) {
      throw new ForbiddenException(`Este clube está a ser acompanhado por ${contacto.owner?.name ?? "outra pessoa"}.`);
    }

    const agora = new Date();
    const voltarEm = lerData(dto.voltarEm);
    if (dto.resultado === "LIGAR_MAIS_TARDE" && !voltarEm) throw new BadRequestException("Escolhe quando voltar a ligar.");
    if (voltarEm && voltarEm.getTime() < agora.getTime() - 60_000) throw new BadRequestException("A data para voltar a ligar já passou.");

    const efeito = efeitoDaChamada({
      resultado: dto.resultado,
      agora,
      estado: contacto.status,
      tentativas: contacto.noAnswerCount,
      nota: dto.nota,
      voltarEm,
      motivo: dto.motivo ?? null,
    });

    let reuniao: Prisma.SalesMeetingUncheckedCreateInput | null = null;
    if (dto.resultado === "REUNIAO") {
      const r = dto.reuniao;
      const quando = lerData(r?.scheduledAt);
      if (!r || !quando) throw new BadRequestException("Escolhe o dia e a hora da reunião.");
      if (quando.getTime() < agora.getTime() - 60_000) throw new BadRequestException("A reunião não pode ficar no passado.");
      const pessoa = (r.personName ?? contacto.personName ?? "").trim();
      if (pessoa.length < 2) throw new BadRequestException("Diz com quem é a reunião.");
      reuniao = {
        contactId,
        scheduledAt: quando,
        durationMin: r.durationMin ?? 45,
        mode: r.mode ?? "VIDEOCHAMADA",
        location: texto(r.location),
        personName: pessoa,
        personRole: texto(r.personRole) ?? contacto.role,
        personPhone: texto(r.personPhone) ?? contacto.phone,
        personEmail: texto(r.personEmail)?.toLowerCase() ?? contacto.email,
        decides: r.decides ?? null,
        athletes: r.athletes ?? null,
        teams: texto(r.teams),
        currentTool: texto(r.currentTool),
        pain: texto(r.pain),
        suggestedPlan: texto(r.suggestedPlan),
        notes: texto(r.notes),
        bookedById: admin.id,
        bookedByName: admin.name,
      };
    }

    const canal = dto.canal ?? "CHAMADA";
    const falou = atendeu(dto.resultado);

    await this.prisma.$transaction(async (tx) => {
      await tx.contactTouch.create({
        data: {
          contactId,
          channel: canal,
          note: efeito.nota,
          status: efeito.status !== contacto.status ? efeito.status : null,
          outcome: dto.resultado,
          byName: admin.name,
          byId: admin.id,
          happenedAt: agora,
        },
      });
      await tx.contact.update({
        where: { id: contactId },
        data: {
          status: efeito.status,
          noAnswerCount: efeito.tentativas,
          nextActionAt: efeito.nextActionAt,
          nextActionNote: efeito.nextActionNote,
          ...(efeito.lostReason !== undefined ? { lostReason: efeito.lostReason } : {}),
          ...(canal === "CHAMADA" ? { calledAt: agora } : {}),
          ...(canal === "EMAIL" ? { emailedAt: agora } : {}),
          lastContactAt: agora,
          // O que responderam fica à vista na lista. Só quando alguém atendeu.
          ...(falou && dto.nota?.trim() ? { replyNote: dto.nota.trim() } : {}),
          ...(contacto.ownerId ? {} : { ownerId: admin.id }),
        },
      });
      if (reuniao) await tx.salesMeeting.create({ data: reuniao });
    });

    return this.contacts.get(contactId);
  }

  /* ------------------------------------------------------------------------ */
  /* Reuniões                                                                  */
  /* ------------------------------------------------------------------------ */

  async reunioes(admin: PlatformAdminContext) {
    const desde = new Date(Date.now() - 120 * 86_400_000);
    const rows = await this.prisma.salesMeeting.findMany({
      where: {
        OR: [{ scheduledAt: { gte: desde } }, { status: "MARCADA" }],
        ...(admin.role === "COMERCIAL" ? { bookedById: admin.id } : {}),
      },
      orderBy: { scheduledAt: "asc" },
      include: { contact: { select: { id: true, name: true, locality: true, association: true, sport: true, status: true } } },
    });
    return rows.map(reuniaoCompleta);
  }

  /**
   * Mudar uma reunião: remarcar, completar a ficha, cancelar, marcar o resultado.
   *
   * O comercial mexe só nas suas e não marca resultados nem a comissão. Cada
   * mudança de estado ou de data fica no histórico do clube.
   */
  async editarReuniao(admin: PlatformAdminContext, id: string, dto: ReuniaoInput, ip?: string) {
    const antes = await this.prisma.salesMeeting.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException("Reunião não encontrada");

    const gere = admin.role === "OWNER" || admin.role === "ADMIN";
    if (admin.role === "COMERCIAL" && antes.bookedById !== admin.id) throw new ForbiddenException("Esta reunião não é tua.");
    if (!gere) {
      if (dto.status && dto.status !== "MARCADA" && dto.status !== "CANCELADA") {
        throw new ForbiddenException("O resultado da reunião marca-se por quem a faz.");
      }
      if (dto.countsForCommission !== undefined || dto.outcomeNote !== undefined) {
        throw new ForbiddenException("O teu papel não permite esta operação.");
      }
    }

    const quando = dto.scheduledAt !== undefined ? lerData(dto.scheduledAt) : undefined;
    if (dto.scheduledAt !== undefined && !quando) throw new BadRequestException("Data inválida");
    if (dto.personName !== undefined && dto.personName.trim().length < 2) throw new BadRequestException("Diz com quem é a reunião.");

    const status = dto.status ?? antes.status;
    const mudouEstado = status !== antes.status;
    const remarcou = quando && quando.getTime() !== antes.scheduledAt.getTime();

    const data: Prisma.SalesMeetingUncheckedUpdateInput = {
      ...(quando ? { scheduledAt: quando } : {}),
      ...(dto.durationMin !== undefined ? { durationMin: dto.durationMin } : {}),
      ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
      ...(dto.location !== undefined ? { location: texto(dto.location) } : {}),
      ...(dto.personName !== undefined ? { personName: dto.personName.trim() } : {}),
      ...(dto.personRole !== undefined ? { personRole: texto(dto.personRole) } : {}),
      ...(dto.personPhone !== undefined ? { personPhone: texto(dto.personPhone) } : {}),
      ...(dto.personEmail !== undefined ? { personEmail: texto(dto.personEmail)?.toLowerCase() ?? null } : {}),
      ...(dto.decides !== undefined ? { decides: dto.decides } : {}),
      ...(dto.athletes !== undefined ? { athletes: dto.athletes } : {}),
      ...(dto.teams !== undefined ? { teams: texto(dto.teams) } : {}),
      ...(dto.currentTool !== undefined ? { currentTool: texto(dto.currentTool) } : {}),
      ...(dto.pain !== undefined ? { pain: texto(dto.pain) } : {}),
      ...(dto.suggestedPlan !== undefined ? { suggestedPlan: texto(dto.suggestedPlan) } : {}),
      ...(dto.notes !== undefined ? { notes: texto(dto.notes) } : {}),
      ...(dto.outcomeNote !== undefined ? { outcomeNote: texto(dto.outcomeNote) } : {}),
      ...(mudouEstado ? { status, outcomeAt: status === "MARCADA" ? null : new Date() } : {}),
      // Cancelar tira da comissão; voltar a marcar repõe. O dono pode decidir à mão.
      ...(dto.countsForCommission !== undefined
        ? { countsForCommission: dto.countsForCommission }
        : mudouEstado && status === "CANCELADA"
          ? { countsForCommission: false }
          : mudouEstado && antes.status === "CANCELADA" && status === "MARCADA"
            ? { countsForCommission: true }
            : {}),
    };

    const linha = mudouEstado
      ? { MARCADA: "Reunião outra vez marcada", REALIZADA: "Reunião feita", FALTARAM: "Faltaram à reunião", CANCELADA: "Reunião cancelada" }[status]
      : remarcou
        ? `Reunião remarcada para ${quando!.toLocaleString("pt-PT", { timeZone: "Europe/Lisbon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
        : null;
    const nota = linha ? (dto.outcomeNote?.trim() ? `${linha}: ${dto.outcomeNote.trim()}` : linha) : null;

    await this.prisma.$transaction(async (tx) => {
      await tx.salesMeeting.update({ where: { id }, data });
      if (nota) {
        await tx.contactTouch.create({
          data: { contactId: antes.contactId, channel: "REUNIAO", note: nota, byName: admin.name, byId: admin.id },
        });
        await tx.contact.update({ where: { id: antes.contactId }, data: { lastContactAt: new Date() } });
      }
      // Sem reuniões marcadas, um clube que estava em "Reunião marcada" volta a "À espera de resposta".
      if (mudouEstado && status === "CANCELADA") {
        const outras = await tx.salesMeeting.count({ where: { contactId: antes.contactId, status: "MARCADA" } });
        if (outras === 0) {
          await tx.contact.updateMany({ where: { id: antes.contactId, status: "REUNIAO" }, data: { status: "CONTACTADO" } });
        }
      }
      if (mudouEstado && status === "MARCADA") {
        await tx.contact.updateMany({
          where: { id: antes.contactId, status: { in: ["NOVO", "CONTACTADO", "SEM_RESPOSTA", "PERDIDO"] } },
          data: { status: "REUNIAO" },
        });
      }
    });

    if (dto.countsForCommission !== undefined && dto.countsForCommission !== antes.countsForCommission) {
      await this.platform.audit(admin, "sales.meeting.commission", "salesMeeting", id, { counts: dto.countsForCommission }, ip);
    }

    const row = await this.prisma.salesMeeting.findUniqueOrThrow({
      where: { id },
      include: { contact: { select: { id: true, name: true, locality: true, association: true, sport: true, status: true } } },
    });
    return reuniaoCompleta(row);
  }

  /* ------------------------------------------------------------------------ */
  /* Turnos                                                                    */
  /* ------------------------------------------------------------------------ */

  async iniciarTurno(admin: PlatformAdminContext) {
    const aberto = await this.prisma.salesShift.findFirst({ where: { adminId: admin.id, endedAt: null } });
    if (aberto) return { id: aberto.id, startedAt: aberto.startedAt, endedAt: null };
    const t = await this.prisma.salesShift.create({ data: { adminId: admin.id, startedAt: new Date() } });
    return { id: t.id, startedAt: t.startedAt, endedAt: null };
  }

  async terminarTurno(admin: PlatformAdminContext, note?: string | null) {
    const aberto = await this.prisma.salesShift.findFirst({ where: { adminId: admin.id, endedAt: null }, orderBy: { startedAt: "desc" } });
    if (!aberto) throw new BadRequestException("Não há turno a correr.");
    const t = await this.prisma.salesShift.update({
      where: { id: aberto.id },
      data: { endedAt: new Date(), note: texto(note) },
    });
    return { id: t.id, startedAt: t.startedAt, endedAt: t.endedAt };
  }

  /** Corrigir um turno (esqueceu-se de terminar, começou mais cedo). Dono e administradores. */
  async editarTurno(admin: PlatformAdminContext, id: string, dto: TurnoInput, ip?: string) {
    const antes = await this.prisma.salesShift.findUnique({ where: { id } });
    if (!antes) throw new NotFoundException("Turno não encontrado");
    const startedAt = dto.startedAt !== undefined ? lerData(dto.startedAt) : antes.startedAt;
    const endedAt = dto.endedAt !== undefined ? lerData(dto.endedAt) : antes.endedAt;
    if (!startedAt) throw new BadRequestException("Falta a hora de início.");
    validarTurno(startedAt, endedAt);
    await this.mesAindaAberto(antes.adminId, startedAt);
    await this.mesAindaAberto(antes.adminId, antes.startedAt);

    const t = await this.prisma.salesShift.update({
      where: { id },
      data: { startedAt, endedAt, ...(dto.note !== undefined ? { note: texto(dto.note) } : {}) },
    });
    await this.platform.audit(admin, "sales.shift.update", "salesShift", id, {
      antes: { startedAt: antes.startedAt, endedAt: antes.endedAt },
      depois: { startedAt, endedAt },
    }, ip);
    return t;
  }

  async criarTurno(admin: PlatformAdminContext, adminId: string, dto: TurnoInput, ip?: string) {
    await this.comercialExiste(adminId);
    const startedAt = lerData(dto.startedAt);
    const endedAt = lerData(dto.endedAt);
    if (!startedAt || !endedAt) throw new BadRequestException("Diz quando começou e quando acabou.");
    validarTurno(startedAt, endedAt);
    await this.mesAindaAberto(adminId, startedAt);
    const t = await this.prisma.salesShift.create({ data: { adminId, startedAt, endedAt, note: texto(dto.note) } });
    await this.platform.audit(admin, "sales.shift.create", "salesShift", t.id, { adminId, startedAt, endedAt }, ip);
    return t;
  }

  async apagarTurno(admin: PlatformAdminContext, id: string, ip?: string) {
    const t = await this.prisma.salesShift.findUnique({ where: { id } });
    if (!t) throw new NotFoundException("Turno não encontrado");
    await this.mesAindaAberto(t.adminId, t.startedAt);
    await this.prisma.salesShift.delete({ where: { id } });
    await this.platform.audit(admin, "sales.shift.delete", "salesShift", id, { adminId: t.adminId, startedAt: t.startedAt, endedAt: t.endedAt }, ip);
    return { ok: true };
  }

  /* ------------------------------------------------------------------------ */
  /* Mês                                                                       */
  /* ------------------------------------------------------------------------ */

  async mes(admin: PlatformAdminContext, alvo: string | undefined, ym: string | undefined) {
    const gere = admin.role === "OWNER" || admin.role === "ADMIN";
    const adminId = gere && alvo ? alvo : admin.id;
    if (!gere && alvo && alvo !== admin.id) throw new ForbiddenException("Só vês o teu mês.");
    const mes = ym && mesValido(ym) ? ym : mesDe(new Date());
    return this.resumoDoMes(adminId, mes, new Date());
  }

  /**
   * O mês de uma pessoa: turnos, chamadas, reuniões, comissões e quanto se paga.
   *
   * Um mês aprovado mostra os números da aprovação (o que se pagou), e não os de
   * hoje: um turno corrigido depois não muda o que já entrou nas Contas.
   */
  async resumoDoMes(adminId: string, mes: string, agora: Date) {
    const { inicio, fim } = limitesDoMes(mes);

    const [pessoa, comp, turnos, reunioes, antes, chamadas, payout] = await Promise.all([
      this.prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { id: true, name: true, role: true } }),
      this.prisma.salesCompensation.findUnique({ where: { adminId } }),
      this.prisma.salesShift.findMany({ where: { adminId, startedAt: { gte: inicio, lt: fim } }, orderBy: { startedAt: "asc" } }),
      this.prisma.salesMeeting.findMany({
        where: { bookedById: adminId, createdAt: { gte: inicio, lt: fim } },
        orderBy: { createdAt: "asc" },
        include: { contact: { select: { id: true, name: true, locality: true, association: true, sport: true, status: true } } },
      }),
      this.prisma.salesMeeting.count({ where: { bookedById: adminId, countsForCommission: true, createdAt: { lt: inicio } } }),
      this.prisma.contactTouch.findMany({
        where: { byId: adminId, channel: "CHAMADA", happenedAt: { gte: inicio, lt: fim } },
        select: { outcome: true },
      }),
      this.prisma.salesPayout.findUnique({ where: { adminId_month: { adminId, month: mes } }, include: { approvedBy: { select: { name: true } } } }),
    ]);
    if (!pessoa) throw new NotFoundException("Pessoa não encontrada");

    const condicoes = comp
      ? { hourlyCents: comp.hourlyCents, meetingsPerCommission: comp.meetingsPerCommission, commissionCents: comp.commissionCents }
      : DEFAULTS;

    const minutos = turnos.reduce((s, t) => s + minutosDoTurno(t, agora), 0);
    const contam = reunioes.filter((r) => r.countsForCommission).length;
    const com = comissoes(antes, contam, condicoes.meetingsPerCommission);
    const pago = pagamento(minutos, condicoes.hourlyCents, com.novas, condicoes.commissionCents);

    return {
      admin: { id: pessoa.id, name: pessoa.name, role: pessoa.role },
      month: mes,
      monthLabel: nomeDoMes(mes),
      configured: Boolean(comp),
      compensation: condicoes,
      shifts: turnos.map((t) => ({
        id: t.id,
        startedAt: t.startedAt,
        endedAt: t.endedAt,
        note: t.note,
        minutes: minutosDoTurno(t, agora),
        tooLong: minutosDoTurno(t, agora) > TURNO_MAXIMO_MIN,
      })),
      openShift: turnos.some((t) => !t.endedAt),
      minutes: payout ? payout.minutes : minutos,
      calls: chamadas.length,
      answered: chamadas.filter((c) => atendeu(c.outcome)).length,
      meetings: reunioes.map(reuniaoCompleta),
      meetingsCounted: payout ? payout.meetings : contam,
      commission: { ...com, novas: payout ? payout.commissions : com.novas },
      hoursCents: payout ? payout.hoursCents : pago.hoursCents,
      commissionCents: payout ? payout.commissionCents : pago.commissionCents,
      totalCents: payout ? payout.totalCents : pago.totalCents,
      payout: payout
        ? { approvedAt: payout.approvedAt, approvedBy: payout.approvedBy?.name ?? null, transactionId: payout.transactionId }
        : null,
    };
  }

  /** Quem tem papel Comercial (ou já teve condições), com o mês corrente de cada um. */
  async equipa() {
    const pessoas = await this.prisma.platformAdmin.findMany({
      where: { OR: [{ role: "COMERCIAL" }, { compensation: { isNot: null } }] },
      select: { id: true, name: true, email: true, role: true, isActive: true },
      orderBy: { name: "asc" },
    });
    const agora = new Date();
    const mes = mesDe(agora);
    return Promise.all(
      pessoas.map(async (p) => {
        const r = await this.resumoDoMes(p.id, mes, agora);
        const aberto = await this.prisma.salesShift.findFirst({ where: { adminId: p.id, endedAt: null }, select: { startedAt: true } });
        return {
          ...p,
          configured: r.configured,
          compensation: r.compensation,
          minutes: r.minutes,
          calls: r.calls,
          meetingsCounted: r.meetingsCounted,
          totalCents: r.totalCents,
          shiftStartedAt: aberto?.startedAt ?? null,
        };
      }),
    );
  }

  async condicoes(admin: PlatformAdminContext, adminId: string, dto: CondicoesInput, ip?: string) {
    await this.comercialExiste(adminId);
    const data = {
      hourlyCents: dto.hourlyCents,
      meetingsPerCommission: dto.meetingsPerCommission,
      commissionCents: dto.commissionCents,
    };
    const row = await this.prisma.salesCompensation.upsert({ where: { adminId }, create: { adminId, ...data }, update: data });
    await this.platform.audit(admin, "sales.compensation", "admin", adminId, data, ip);
    return row;
  }

  /**
   * Aprovar o mês: congela os números e lança o total nas Contas como gasto.
   *
   * Não se aprova com um turno a correr nem um mês que ainda não acabou de
   * começar (o futuro). Desaprovar apaga o gasto e volta a abrir o mês.
   */
  async aprovar(admin: PlatformAdminContext, adminId: string, mes: string, ip?: string) {
    if (!mesValido(mes)) throw new BadRequestException("Mês inválido");
    if (mes > mesDe(new Date())) throw new BadRequestException("Esse mês ainda não começou.");
    const existe = await this.prisma.salesPayout.findUnique({ where: { adminId_month: { adminId, month: mes } } });
    if (existe) throw new ConflictException("Esse mês já está aprovado.");

    const r = await this.resumoDoMes(adminId, mes, new Date());
    if (r.openShift) throw new BadRequestException("Há um turno por terminar neste mês. Termina-o ou corrige-o primeiro.");

    const payout = await this.prisma.$transaction(async (tx) => {
      const transacao =
        r.totalCents > 0
          ? await tx.platformTransaction.create({
              data: {
                kind: "EXPENSE",
                status: "COMPLETED",
                description: `Comercial: ${r.admin.name}, ${r.monthLabel}`,
                amountCents: r.totalCents,
                vatRate: 0,
                occurredAt: new Date(new Date().toISOString().slice(0, 10)),
                category: "Comercial",
                counterparty: r.admin.name,
                notes: `${horasEMinutos(r.minutes)} de turnos e ${r.commission.novas} ${r.commission.novas === 1 ? "comissão" : "comissões"} (${r.meetingsCounted} reuniões marcadas no mês).`,
                createdById: admin.id,
              },
            })
          : null;
      return tx.salesPayout.create({
        data: {
          adminId,
          month: mes,
          minutes: r.minutes,
          meetings: r.meetingsCounted,
          commissions: r.commission.novas,
          hoursCents: r.hoursCents,
          commissionCents: r.commissionCents,
          totalCents: r.totalCents,
          approvedById: admin.id,
          transactionId: transacao?.id ?? null,
        },
      });
    });

    await this.platform.audit(admin, "sales.payout.approve", "admin", adminId, { month: mes, totalCents: r.totalCents }, ip);
    return payout;
  }

  async desaprovar(admin: PlatformAdminContext, adminId: string, mes: string, ip?: string) {
    const p = await this.prisma.salesPayout.findUnique({ where: { adminId_month: { adminId, month: mes } } });
    if (!p) throw new NotFoundException("Esse mês não está aprovado.");
    await this.prisma.$transaction(async (tx) => {
      await tx.salesPayout.delete({ where: { id: p.id } });
      if (p.transactionId) await tx.platformTransaction.deleteMany({ where: { id: p.transactionId } });
    });
    await this.platform.audit(admin, "sales.payout.reopen", "admin", adminId, { month: mes, totalCents: p.totalCents }, ip);
    return { ok: true };
  }

  /* ------------------------------------------------------------------------ */

  private async minutosDesde(adminId: string, desde: Date, agora: Date) {
    const turnos = await this.prisma.salesShift.findMany({
      where: { adminId, OR: [{ endedAt: null }, { endedAt: { gte: desde } }] },
      select: { startedAt: true, endedAt: true },
    });
    return turnos.reduce((s, t) => {
      const inicio = t.startedAt < desde ? desde : t.startedAt;
      return s + minutosDoTurno({ startedAt: inicio, endedAt: t.endedAt }, agora);
    }, 0);
  }

  private async comercialExiste(adminId: string) {
    const p = await this.prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { id: true } });
    if (!p) throw new NotFoundException("Pessoa não encontrada");
  }

  /** Um mês aprovado já foi pago: os turnos dele não se mexem sem o desaprovar. */
  private async mesAindaAberto(adminId: string, quando: Date) {
    const p = await this.prisma.salesPayout.findUnique({ where: { adminId_month: { adminId, month: mesDe(quando) } } });
    if (p) throw new ConflictException("Esse mês já está aprovado. Desaprova-o primeiro para mexer nos turnos.");
  }
}

/* ---------------------------------------------------------------------------- */

type ReuniaoRow = Prisma.SalesMeetingGetPayload<{
  include: { contact: { select: { id: true; name: true; locality: true; association: true; sport: true; status: true } } };
}>;

function reuniaoCompleta(r: ReuniaoRow) {
  return {
    id: r.id,
    contact: r.contact,
    scheduledAt: r.scheduledAt,
    durationMin: r.durationMin,
    mode: r.mode,
    location: r.location,
    personName: r.personName,
    personRole: r.personRole,
    personPhone: r.personPhone,
    personEmail: r.personEmail,
    decides: r.decides,
    athletes: r.athletes,
    teams: r.teams,
    currentTool: r.currentTool,
    pain: r.pain,
    suggestedPlan: r.suggestedPlan,
    notes: r.notes,
    status: r.status,
    outcomeNote: r.outcomeNote,
    outcomeAt: r.outcomeAt,
    countsForCommission: r.countsForCommission,
    bookedById: r.bookedById,
    bookedByName: r.bookedByName,
    createdAt: r.createdAt,
  };
}

function reuniaoCurta(r: { id: string; scheduledAt: Date; mode: SalesMeetingMode; personName: string; bookedByName: string | null; contact: { id: string; name: string; locality: string | null; association: string | null } }) {
  return {
    id: r.id,
    scheduledAt: r.scheduledAt,
    mode: r.mode,
    personName: r.personName,
    bookedByName: r.bookedByName,
    contact: r.contact,
  };
}

function texto(v: string | null | undefined): string | null {
  return v?.trim() || null;
}

function lerData(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Data inválida");
  return d;
}

function validarTurno(inicio: Date, fim: Date | null) {
  if (fim && fim.getTime() <= inicio.getTime()) throw new BadRequestException("O turno tem de acabar depois de começar.");
  if (fim && fim.getTime() - inicio.getTime() > TURNO_MAXIMO_MIN * 60_000) throw new BadRequestException("Um turno não pode passar de 16 horas.");
  if (inicio.getTime() > Date.now() + 60_000) throw new BadRequestException("O turno não pode começar no futuro.");
}
