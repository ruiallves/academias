import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ChargeStatus, PaymentMethod, PaymentStatus } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * Quotas — o lado da consola.
 *
 * ## Uma quota é um mês
 *
 * O período de uma quota é sempre `AAAA-MM`. Já foi mais flexível — a
 * categoria dizia se era mensal, trimestral, anual, uma vez — e a
 * flexibilidade custou o que se lê na migração `quotas_mensais`: uma ficha
 * que não sabia dizer "está em dia este mês", um ecrã de atrasos que mudava de
 * unidade conforme a categoria, e uma app que não conseguia oferecer "paga até
 * Julho". O clube fala em mensalidades; o produto fala a mesma língua.
 *
 * ## Como uma quota nasce
 *
 * Da categoria: `MemberTier.feeCents` é o valor **por mês**. "Gerar quotas"
 * cria, para cada sócio **activo** com categoria com preço, a quota do mês
 * corrente que ainda não exista — o unique `(memberId, period)` faz de gerar
 * duas vezes um gesto inofensivo, tal como o `ensureCharges` das mensalidades.
 *
 * As outras duas portas são `lancar` (a direcção, na ficha do sócio, para
 * acertar atrasos ou um valor à medida) e `garantirDoSocio` (a app, quando o
 * sócio quer pagar um mês que ainda ninguém lançou).
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
   * Gerar as quotas do mês corrente.
   *
   * Idempotente por construção: só cria o que falta, e diz quantas criou.
   */
  async gerar(ctx: RequestContext) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const socios = await db.member.findMany({
        where: { status: "ACTIVE", tier: { feeCents: { not: null }, archivedAt: null } },
        select: { id: true, tier: { select: { feeCents: true } } },
      });

      const period = periodoCorrente(new Date());
      const existentes = new Set(
        (
          await db.memberFee.findMany({
            where: { memberId: { in: socios.map((s) => s.id) }, period },
            select: { memberId: true },
          })
        ).map((f) => f.memberId),
      );

      let criadas = 0;
      for (const socio of socios) {
        if (!socio.tier?.feeCents || existentes.has(socio.id)) continue;
        await db.memberFee.create({
          data: novaQuota(ctx.academyId, socio.id, period, socio.tier.feeCents),
        });
        criadas += 1;
      }

      return { created: criadas, members: socios.length };
    });
  }

  /**
   * O que o ecrã de lançar precisa de saber: o valor por omissão e **que meses
   * já têm quota**.
   *
   * ## Porque é que não vem uma lista de meses
   *
   * Vinha — os doze mais recentes — e era um tecto disfarçado: em Setembro de
   * 2026 o sócio só podia receber atrasos até Outubro de 2025, e quem quisesse
   * acertar a época inteira de 2024 não tinha por onde. O intervalo é do
   * cliente, "de mês/ano até mês/ano"; daqui só sai o que ele não pode saber
   * sozinho.
   *
   * `taken` são **todos** os meses com quota, sem filtro de data: um sócio
   * tem dezenas de quotas, não milhares, e mandá-las todas evita a pergunta
   * "quais é que interessam?" — que é a pergunta que criou o tecto.
   */
  async periodosParaLancar(ctx: RequestContext, memberId: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id: memberId },
        select: { id: true, tier: { select: { feeCents: true } } },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      const taken = (
        await db.memberFee.findMany({ where: { memberId }, select: { period: true } })
      ).map((f) => f.period);

      return {
        hasTier: member.tier != null,
        defaultAmountCents: member.tier?.feeCents ?? null,
        taken,
      };
    });
  }

  /**
   * Lançar quotas a **um** sócio, à mão.
   *
   * ## O que isto resolve
   *
   * `gerar` trabalha sobre o livro todo e tira o valor da categoria. É o dia a
   * dia, e deixa três buracos que só se tapavam com ginástica:
   *
   * - o sócio **sem categoria com preço**, que a geração salta em silêncio;
   * - o **mês fora do corrente** — o acerto de quem entrou a meio do ano e
   *   deve três meses, que obrigava a gerar para a academia inteira só para
   *   apanhar um;
   * - o **valor diferente do da categoria** (uma quota reduzida acordada com
   *   aquele sócio), que não tinha onde ser escrito.
   *
   * Aqui a pergunta é directa: *este sócio, este valor, estes meses*.
   *
   * ## Vários meses de uma vez
   *
   * Porque o caso real nunca é um: é "faltam-lhe Setembro, Outubro e Novembro".
   * Um pedido por mês seriam três voltas iguais com o valor escrito três
   * vezes — e é assim que se engana um deles.
   *
   * ## Os que já existem saltam-se, não recusam
   *
   * O unique `(memberId, period)` é a rede; mas recusar tudo porque um dos seis
   * já lá estava era perder os cinco que faltavam. A intenção de quem escolheu
   * seis é ter os seis — devolve-se o que se criou e o que já cá estava.
   */
  async lancar(
    ctx: RequestContext,
    memberId: string,
    input: { periods: string[]; amountCents: number; notes?: string },
  ) {
    this.mustWrite(ctx);

    const periodos = [...new Set(input.periods.map((p) => p.trim()).filter(Boolean))];
    if (periodos.length === 0) throw new BadRequestException("Escolhe pelo menos um mês");
    const invalido = periodos.find((p) => !ehMes(p));
    if (invalido) throw new BadRequestException(`"${invalido}" não é um mês (AAAA-MM)`);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({ where: { id: memberId }, select: { id: true } });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      const jaExistiam = (
        await db.memberFee.findMany({
          where: { memberId, period: { in: periodos } },
          select: { period: true },
        })
      ).map((f) => f.period);
      const existentes = new Set(jaExistiam);

      let criadas = 0;
      for (const period of periodos) {
        if (existentes.has(period)) continue;
        await db.memberFee.create({
          data: {
            ...novaQuota(ctx.academyId, memberId, period, input.amountCents),
            ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
          },
        });
        criadas += 1;
      }

      return { created: criadas, alreadyExisted: jaExistiam };
    });
  }

  /**
   * Mudar o estado de uma quota à mão — o menu "Marcar como paga / Marcar por
   * pagar / Anular" da ficha, o mesmo das mensalidades dos atletas.
   *
   * ## Isto contradiz "o pagamento só muda pelo webhook"?
   *
   * Não — é a mesma resposta do `setChargeStatus`. Aquela regra protege o fluxo
   * euPago: o telemóvel de um sócio nunca pode declarar-se pago. Isto é uma
   * acção de **gestão**, atrás de `member:write`, e fica com rasto: marcar como
   * paga cria um `Payment` de método `CASH` e provedor `manual`, para o
   * histórico dizer *como* se soube que foi pago. Voltar atrás marca esse
   * pagamento manual como reembolsado, em vez de o apagar.
   *
   * Uma quota paga **online** não se volta a abrir por aqui: o dinheiro está
   * na euPago, e desfazer isso é um estorno, não um clique.
   */
  async mudarEstado(ctx: RequestContext, feeId: string, status: ChargeStatus) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const fee = await db.memberFee.findFirst({
        where: { id: feeId },
        select: {
          id: true, status: true, amountCents: true,
          payments: { where: { status: PaymentStatus.PAID }, select: { provider: true } },
        },
      });
      if (!fee) throw new NotFoundException("Quota não encontrada");

      if (status === ChargeStatus.SETTLED) {
        if (fee.status !== ChargeStatus.SETTLED) {
          await db.payment.create({
            data: {
              memberFeeId: fee.id,
              amountCents: fee.amountCents,
              method: PaymentMethod.CASH,
              status: PaymentStatus.PAID,
              provider: "manual",
              paidAt: new Date(),
            },
          });
        }
        await db.memberFee.update({
          where: { id: fee.id },
          data: { status, settledAt: new Date(), method: fee.status === ChargeStatus.SETTLED ? undefined : PaymentMethod.CASH },
        });
      } else {
        if (fee.status === ChargeStatus.SETTLED && fee.payments.some((p) => p.provider !== "manual")) {
          throw new BadRequestException("Foi paga online — desfazer isso é um estorno, não um clique");
        }
        await db.payment.updateMany({
          where: { memberFeeId: fee.id, provider: "manual", status: PaymentStatus.PAID },
          data: { status: PaymentStatus.REFUNDED },
        });
        await db.memberFee.update({
          where: { id: fee.id },
          data: { status, settledAt: null, method: null },
        });
      }

      return { id: fee.id, status };
    });
  }

  /**
   * A quota de um mês, para a app do sócio pagar — criada se ainda não existir.
   *
   * ## Porquê criar a partir da app
   *
   * O sócio quer pagar Outubro em Setembro, e a direcção ainda não gerou
   * Outubro — não tinha razão para o fazer. Mandá-lo esperar era recusar
   * dinheiro. A quota nasce aqui com o valor da categoria, exactamente como
   * `gerar` a criaria no dia 1; a única diferença é quem carregou no botão.
   *
   * Só nasce o que a categoria diz que existe: sem categoria com preço não há
   * valor que se possa afirmar, e a app diz isso em vez de inventar um.
   *
   * Não é uma rota de consola — a autorização é "é a quota do próprio", e
   * quem a garante é o `ClubAppService`, que chama isto já dentro do sócio.
   */
  async garantirDoSocio(db: ScopedClient, academyId: string, memberId: string, period: string) {
    if (!ehMes(period)) throw new BadRequestException("Mês inválido");

    const existente = await db.memberFee.findFirst({ where: { memberId, period }, select: { id: true } });
    if (existente) return existente.id;

    const member = await db.member.findFirst({
      where: { id: memberId },
      select: { tier: { select: { feeCents: true, archivedAt: true } } },
    });
    const preco = member?.tier && !member.tier.archivedAt ? member.tier.feeCents : null;
    if (!preco) throw new BadRequestException("A tua categoria ainda não tem valor de quota — fala com o clube");

    const criada = await db.memberFee.create({
      data: novaQuota(academyId, memberId, period, preco),
      select: { id: true },
    });
    return criada.id;
  }
}

/* -------------------------------------------------------------------------- */

/** Os campos de uma quota nova — o único sítio que sabe escrevê-la. */
function novaQuota(academyId: string, memberId: string, period: string, amountCents: number) {
  return {
    academyId,
    memberId,
    period,
    label: rotulo(period),
    amountCents,
    dueOn: fimDoMes(period),
    updatedAt: new Date(),
  };
}

/**
 * A situação de quotas de um sócio — a resposta a "está em dia?".
 *
 * A ficha dizia a **categoria** e mais nada: "Sócio efectivo, 5 €/mês". Isso é
 * o preço, não o estado — e quem abre a ficha de um sócio ao balcão quer saber
 * se ele deve alguma coisa, não quanto custa a categoria dele.
 *
 * Três factos, e são precisos os três:
 *
 * - **o mês corrente**, com o seu estado. `missing` é diferente de `open`:
 *   uma quota que ninguém lançou não é uma dívida do sócio, é trabalho por
 *   fazer do clube, e a ficha não pode dizer "deve" a quem nunca recebeu a
 *   cobrança.
 * - **o que está por pagar** no total, e quanto disso já passou do prazo. Um
 *   sócio com Setembro por pagar em Setembro está a horas; em Dezembro, não.
 * - **a última paga**, que é o que dá contexto quando não há nada em aberto.
 */
export type SituacaoQuotas = {
  currentPeriod: string;
  currentStatus: "settled" | "open" | "void" | "missing";
  openCount: number;
  openCents: number;
  overdueCount: number;
  lastSettled: { period: string; label: string | null; settledAt: Date | null } | null;
};

export async function situacaoDeQuotas(
  db: ScopedClient,
  memberId: string,
  agora = new Date(),
): Promise<SituacaoQuotas> {
  const fees = await db.memberFee.findMany({
    where: { memberId },
    orderBy: [{ period: "desc" }],
    select: { period: true, label: true, amountCents: true, status: true, dueOn: true, settledAt: true },
  });

  const abertas = fees.filter((f) => f.status === "OPEN");
  const pagas = fees.filter((f) => f.status === "SETTLED");
  const currentPeriod = periodoCorrente(agora);
  const corrente = fees.find((f) => f.period === currentPeriod);

  return {
    currentPeriod,
    currentStatus: !corrente
      ? "missing"
      : corrente.status === "SETTLED"
        ? "settled"
        : corrente.status === "VOID"
          ? "void"
          : "open",
    openCount: abertas.length,
    openCents: abertas.reduce((n, f) => n + f.amountCents, 0),
    overdueCount: abertas.filter((f) => f.dueOn && f.dueOn < agora).length,
    lastSettled: pagas[0]
      ? { period: pagas[0].period, label: pagas[0].label, settledAt: pagas[0].settledAt }
      : null,
  };
}

/** `AAAA-MM` do mês em que `agora` cai. */
export function periodoCorrente(agora: Date): string {
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
}

export function ehMes(period: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  return m != null && Number(m[2]) >= 1 && Number(m[2]) <= 12;
}

/** "Quota de Setembro 2026". Os rótulos antigos (`2026`, `2026-T3`) ficam como estão. */
export function rotulo(period: string): string {
  const [ano, mes] = period.split("-");
  return `Quota de ${MESES[Number(mes) - 1]} ${ano}`;
}

/**
 * O prazo é o fim do mês **escrito no rótulo** — e não o do mês corrente.
 *
 * Uma quota lançada à mão pode ser de Setembro em Dezembro, e o prazo dela é
 * o fim de Setembro — dizer 31 de Dezembro escondia precisamente o atraso que
 * se está a registar. Não é configurável nesta fase: quando um clube pedir
 * "até dia 8", é uma coluna na categoria, não uma constante.
 */
export function fimDoMes(period: string): Date {
  const [ano, mes] = period.split("-").map(Number);
  return new Date(Date.UTC(ano, mes, 0));
}

/**
 * Os meses do corrente até ao fim da época — o que a app oferece a pagar.
 *
 * A época desportiva fecha em **Julho**: de Agosto a Julho é uma, e o sócio
 * que quer "ficar em dia até ao fim da época" quer chegar a Julho. Em
 * Setembro de 2026 são onze meses (Set–Jul); em Julho de 2027 é um.
 */
export function mesesAteFimDaEpoca(agora = new Date()): string[] {
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  const anoFim = mes >= 8 ? ano + 1 : ano;
  const meses: string[] = [];
  for (let a = ano, m = mes; a < anoFim || (a === anoFim && m <= 7); m++) {
    if (m > 12) { m = 1; a++; }
    meses.push(`${a}-${String(m).padStart(2, "0")}`);
  }
  return meses;
}

export const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
