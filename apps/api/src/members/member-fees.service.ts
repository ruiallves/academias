import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MemberFeePeriod, PaymentMethod } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * Quotas — o lado da consola.
 *
 * ## Como uma quota nasce
 *
 * Da categoria: `MemberTier.feeCents` diz quanto, `MemberTier.period` diz com
 * que frequência. "Gerar quotas" cria, para cada sócio **activo** com categoria
 * com preço, a quota do período corrente que ainda não exista — o unique
 * `(memberId, period)` faz de gerar duas vezes um gesto inofensivo, tal como o
 * `ensureCharges` das mensalidades.
 *
 * ## Períodos
 *
 * O rótulo do período segue a frequência da categoria: `"2026"` para anuais,
 * `"2026-09"` para mensais, `"2026-T3"` para trimestrais, `"vitalicia"` (uma
 * vez) para as pagas uma só vez. Sócios de categorias diferentes geram períodos
 * diferentes na mesma passagem — é essa a razão de "gerar" não pedir período
 * nenhum: o clube carrega no botão e cada sócio recebe a quota que a sua
 * categoria dita.
 */
@Injectable()
export class MemberFeesService {
  constructor(private readonly prisma: PrismaService) {}

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "member:read")) throw new ForbiddenException("Sem acesso aos sócios");
  }
  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para gerir sócios");
  }

  /** As quotas de um sócio, mais recentes primeiro. */
  async doSocio(ctx: RequestContext, memberId: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({ where: { id: memberId }, select: { id: true } });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      return db.memberFee.findMany({
        where: { memberId },
        orderBy: [{ period: "desc" }],
        select: {
          id: true, period: true, label: true, amountCents: true, dueOn: true,
          status: true, settledAt: true, method: true, notes: true,
        },
      });
    });
  }

  /**
   * Gerar as quotas do período corrente de cada categoria.
   *
   * Idempotente por construção: só cria o que falta, e diz quantas criou.
   */
  async gerar(ctx: RequestContext) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const socios = await db.member.findMany({
        where: { status: "ACTIVE", tier: { feeCents: { not: null }, archivedAt: null } },
        select: {
          id: true,
          tier: { select: { name: true, feeCents: true, period: true } },
        },
      });

      const agora = new Date();
      const existentes = new Set(
        (
          await db.memberFee.findMany({
            where: { memberId: { in: socios.map((s) => s.id) } },
            select: { memberId: true, period: true },
          })
        ).map((f) => `${f.memberId}::${f.period}`),
      );

      let criadas = 0;
      for (const socio of socios) {
        const tier = socio.tier;
        if (!tier?.feeCents) continue;

        const period = periodoCorrente(tier.period, agora);
        if (existentes.has(`${socio.id}::${period}`)) continue;

        await db.memberFee.create({
          data: {
            academyId: ctx.academyId,
            memberId: socio.id,
            period,
            label: rotulo(tier.period, period, tier.name),
            amountCents: tier.feeCents,
            dueOn: prazo(tier.period, agora),
            updatedAt: new Date(),
          },
        });
        criadas += 1;
      }

      return { created: criadas, members: socios.length };
    });
  }

  /**
   * Registar um pagamento à mão — numerário ao balcão, transferência.
   *
   * O caminho online não passa por aqui: esse liquida pelo webhook, como as
   * mensalidades, e é o único que pode dizer "o dinheiro entrou mesmo".
   */
  async liquidar(ctx: RequestContext, feeId: string, method?: string) {
    this.mustWrite(ctx);

    const metodo = method === "TRANSFER" ? "TRANSFER" : "CASH";

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const fee = await this.viva(db, feeId);
      if (fee.status === "SETTLED") throw new BadRequestException("Já está paga");

      await db.memberFee.update({
        where: { id: fee.id },
        data: { status: "SETTLED", settledAt: new Date(), method: metodo as PaymentMethod },
      });
      return { ok: true as const };
    });
  }

  /** Anular — o sócio saiu a meio do ano, a quota foi gerada por engano. */
  async anular(ctx: RequestContext, feeId: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const fee = await this.viva(db, feeId);
      if (fee.status === "SETTLED") {
        throw new BadRequestException("Está paga — anular dinheiro recebido é um estorno, não um clique");
      }

      await db.memberFee.update({ where: { id: fee.id }, data: { status: "VOID" } });
      return { ok: true as const };
    });
  }

  /** Reabrir uma liquidada à mão por engano (as online reabrem pelo estorno). */
  async reabrir(ctx: RequestContext, feeId: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const fee = await this.viva(db, feeId);
      await db.memberFee.update({
        where: { id: fee.id },
        data: { status: "OPEN", settledAt: null, method: null },
      });
      return { ok: true as const };
    });
  }

  private async viva(db: ScopedClient, feeId: string) {
    const fee = await db.memberFee.findFirst({
      where: { id: feeId },
      select: { id: true, status: true },
    });
    if (!fee) throw new NotFoundException("Quota não encontrada");
    return fee;
  }
}

/* -------------------------------------------------------------------------- */

/** O rótulo do período corrente para uma frequência. */
export function periodoCorrente(freq: MemberFeePeriod, agora: Date): string {
  const ano = agora.getFullYear();
  if (freq === "MONTHLY") return `${ano}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
  if (freq === "QUARTERLY") return `${ano}-T${Math.floor(agora.getMonth() / 3) + 1}`;
  if (freq === "ONCE") return "vitalicia";
  return String(ano);
}

function rotulo(freq: MemberFeePeriod, period: string, tierName: string): string {
  if (freq === "MONTHLY") {
    const [ano, mes] = period.split("-");
    return `Quota de ${MESES[Number(mes) - 1]} ${ano}`;
  }
  if (freq === "QUARTERLY") return `Quota do ${period.split("-T")[1]}.º trimestre ${period.slice(0, 4)}`;
  if (freq === "ONCE") return `Jóia — ${tierName}`;
  return `Quota anual ${period}`;
}

/**
 * O prazo: fim do período a que a quota diz respeito. Não é configurável nesta
 * fase — quando um clube pedir outro, é uma coluna no tier, não uma constante.
 */
function prazo(freq: MemberFeePeriod, agora: Date): Date {
  const ano = agora.getFullYear();
  if (freq === "MONTHLY") return new Date(Date.UTC(ano, agora.getMonth() + 1, 0));
  if (freq === "QUARTERLY") return new Date(Date.UTC(ano, (Math.floor(agora.getMonth() / 3) + 1) * 3, 0));
  return new Date(Date.UTC(ano, 11, 31));
}

const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
