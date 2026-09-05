import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { FinanceKind, FinanceStatus, PaymentMethod } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";
import { currentSeason } from "../common/seasons";
import type { BudgetDto, CreateTransactionDto, DeleteTransactionDto, SettingsDto, UpdateTransactionDto } from "./finance.dto";

/**
 * Contas — a gestão financeira do clube.
 *
 * Não é contabilidade: é a ferramenta que responde em cinco segundos a "quanto
 * temos, quanto entrou, quanto saiu, e o que vem aí". Um contabilista continua
 * a ser um contabilista.
 *
 * ## As três regras que atravessam o ficheiro
 *
 * 1. **O saldo é derivado, nunca guardado.** Inicial + concluídos + fontes
 *    automáticas. Um saldo em coluna diverge do que o compõe à primeira escrita
 *    concorrente — é a regra do disponível do inventário, com mais zeros.
 *
 * 2. **As mensalidades pagas derivam-se, não se copiam.** `Charge` já é a
 *    verdade delas; a euPago confirma lá, os estornos acontecem lá. Este módulo
 *    lê — e por isso "nunca duplicar movimentos" é trivialmente verdade, e
 *    desligar a fonte no saldo não apaga pagamento nenhum.
 *
 * 3. **O que aconteceu não se apaga; o que nunca existiu, sim.** Um movimento
 *    que se concretizou e depois caiu — o autocarro desmarcado — **cancela-se**
 *    e fica riscado, com quem lhe mexeu: contas onde a história desaparece
 *    deixam de merecer confiança na primeira contagem que não bate certo.
 *
 *    Mas um lançamento **feito por engano** — a linha a dobrar, o treino do
 *    primeiro dia a usar o produto — não é história de nada, e obrigar o clube
 *    a viver com ela riscada para sempre é sujar o extracto para defender um
 *    princípio que ali não se aplica. Esse apaga-se (`deleteTransaction`), com
 *    confirmação e só com `finance:write`.
 *
 *    As mensalidades ficam de fora das duas: derivam de `Charge` (regra 2), não
 *    são linhas desta tabela, e um id delas não chega sequer a ser encontrado
 *    aqui.
 *
 * ## Previsto ≠ realizado
 *
 * `PLANNED` e `PENDING` vivem nas previsões; só `COMPLETED` mexe no saldo. O
 * custo estimado de um jogo entra como despesa prevista ligada ao jogo, e
 * confirma-se quando for pago — a distinção nunca se mistura, porque misturá-la
 * é a maneira mais rápida de um saldo mentir.
 */
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "finance:read")) throw new ForbiddenException("Sem acesso às contas");
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "finance:write")) throw new ForbiddenException("Sem permissão para mexer nas contas");
  }

  /* ---------------------------------------------------------------------- */
  /* O painel                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Tudo o que o painel mostra, numa resposta.
   *
   * ## Menos perguntas, não perguntas mais depressa
   *
   * `runAs` corre dentro de uma transação — uma ligação só — por isso as
   * leituras vão em fila mesmo dentro de um `Promise.all`: paralelizar não
   * poupa nada, **cada consulta é uma viagem até à base**. Com a base longe,
   * cada viagem custa uns bons duzentos milissegundos, e o painel eram treze.
   *
   * Por isso cada leitura aqui serve mais do que uma resposta:
   *
   * - um `groupBy` por tipo dá as receitas e as despesas do período inteiro;
   * - as linhas da série de seis meses trazem a categoria, e por isso dão
   *   também os totais do mês e o gasto do mês por categoria;
   * - as mensalidades dos últimos seis meses dão a série **e** o total do mês;
   * - os previstos vêm uma vez e servem os quatro horizontes e as duas listas.
   *
   * ## O horizonte não volta ao servidor
   *
   * Trocar "próximos 30 dias" por "próximos 90" é a mesma previsão vista de
   * outra maneira, não outra pergunta. Por isso vão os quatro horizontes na
   * mesma resposta (`forecast`) e o ecrã troca sem esperar por ninguém —
   * `receitasPrevistas`/`despesasPrevistas` continuam a responder ao horizonte
   * pedido, para quem lê a API directamente.
   */
  async overview(ctx: RequestContext, horizonDays = 30) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const settings = await this.settingsRow(db, ctx.academyId);
      const desde = settings.initialBalanceAt ?? undefined;

      const hoje = new Date();
      const inicioDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const desdeOMes = maisTarde(inicioDoMes, desde);
      const inicioDaSerie = new Date(hoje.getFullYear(), hoje.getMonth() - 5, 1);
      const serieDesde = maisTarde(inicioDaSerie, desde);

      const [totais, porVir, movimentosDaSerie, chargesDaSerie, autoTotal, catalogo] = await Promise.all([
        // Receitas e despesas do período inteiro, numa pergunta em vez de duas.
        db.financialTransaction.groupBy({
          by: ["kind"],
          where: { status: "COMPLETED", ...(desde ? { occurredAt: { gte: desde } } : {}) },
          _sum: { amountCents: true },
        }),
        /*
         * O que ainda não aconteceu, por inteiro.
         *
         * Eram quatro perguntas — duas somas por horizonte e duas listas de
         * próximos. São poucas linhas (um clube tem dezenas de previstos, não
         * milhares), por isso vêm uma vez e servem os quatro horizontes e as
         * duas listas.
         */
        db.financialTransaction.findMany({
          where: { status: { in: ["PLANNED", "PENDING"] } },
          orderBy: { occurredAt: "asc" },
          take: 500,
          select: {
            id: true, kind: true, description: true, amountCents: true, occurredAt: true, status: true,
            category: { select: { label: true } },
            match: { select: { id: true, opponent: true, isHome: true } },
            calendarEvent: { select: { id: true, title: true } },
          },
        }),
        // A série de seis meses — e, filtrada ao mês, também o mês por categoria.
        db.financialTransaction.findMany({
          where: { status: "COMPLETED", occurredAt: { gte: serieDesde } },
          select: { kind: true, amountCents: true, occurredAt: true, categoryId: true },
        }),
        // As mensalidades pagas — a fonte automática. Ver a regra 2 do topo.
        settings.includeFees
          ? db.charge.findMany({
              where: { status: "SETTLED", settledAt: { gte: serieDesde } },
              select: { amountCents: true, settledAt: true },
            })
          : Promise.resolve([]),
        /*
         * O total das mensalidades desde o saldo inicial.
         *
         * Só quando o saldo inicial é anterior à série: se for de dentro dos
         * seis meses, as linhas acima já são todas — e uma pergunta que se
         * responde com o que já temos não se faz.
         */
        settings.includeFees && desde && desde >= inicioDaSerie
          ? Promise.resolve(null)
          : settings.includeFees
            ? this.autoIncomeSum(db, desde)
            : Promise.resolve(0),
        // Os rótulos, incluindo arquivados: um movimento antigo pode apontar
        // para uma categoria que o clube entretanto arrumou.
        db.catalogItem.findMany({
          where: { kind: { in: ["financeIncome", "financeExpense"] } },
          select: { id: true, label: true },
        }),
      ]);

      const doTipo = (k: FinanceKind) => totais.find((t) => t.kind === k)?._sum.amountCents ?? 0;
      const receitas = doTipo("INCOME");
      const despesas = doTipo("EXPENSE");

      const somaCharges = (rows: { amountCents: number }[]) => rows.reduce((s, c) => s + c.amountCents, 0);
      const autoDesdeOInicial = autoTotal ?? somaCharges(chargesDaSerie);
      const autoMes = settings.includeFees
        ? somaCharges(chargesDaSerie.filter((c) => c.settledAt && c.settledAt >= desdeOMes))
        : 0;

      /* --------------------------------------------------------- o mês --- */
      const doMes = movimentosDaSerie.filter((t) => t.occurredAt >= desdeOMes);
      const receitasMes = doMes.filter((t) => t.kind === "INCOME").reduce((s, t) => s + t.amountCents, 0);
      const despesasMes = doMes.filter((t) => t.kind === "EXPENSE").reduce((s, t) => s + t.amountCents, 0);

      // O gasto do mês por categoria — o "em que estamos a gastar".
      const acumulado = new Map<string, { kind: FinanceKind; amountCents: number }>();
      for (const t of doMes) {
        const chave = `${t.kind}:${t.categoryId ?? ""}`;
        const linha = acumulado.get(chave) ?? { kind: t.kind, amountCents: 0 };
        linha.amountCents += t.amountCents;
        acumulado.set(chave, linha);
      }
      const porCategoria = [...acumulado.entries()].map(([chave, v]) => ({
        kind: v.kind,
        categoryId: chave.slice(chave.indexOf(":") + 1) || null,
        _sum: { amountCents: v.amountCents },
      }));

      const saldo = settings.initialBalanceCents + receitas + autoDesdeOInicial - despesas;

      /* ----------------------------------------------------- o previsto --- */
      const somaAte = (kind: FinanceKind, dias: number) => {
        const limite = new Date(hoje.getTime() + dias * 86_400_000);
        return porVir.filter((t) => t.kind === kind && t.occurredAt <= limite).reduce((s, t) => s + t.amountCents, 0);
      };
      const forecast = HORIZONTES.map((days) => ({
        days,
        income: somaAte("INCOME", days),
        expense: somaAte("EXPENSE", days),
      }));
      const receitasPrevistas = somaAte("INCOME", horizonDays);
      const despesasPrevistas = somaAte("EXPENSE", horizonDays);

      const proximasReceitas = porVir.filter((t) => t.kind === "INCOME").slice(0, 6).map(serializeCurto);
      const proximasDespesas = porVir.filter((t) => t.kind === "EXPENSE").slice(0, 6).map(serializeCurto);

      /* ------------------------------------------------- a série mensal --- */
      const meses = new Map<string, { income: number; expense: number }>();
      for (let i = 5; i >= 0; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        meses.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { income: 0, expense: 0 });
      }
      const balde = (d: Date) => meses.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      for (const t of movimentosDaSerie) {
        const b = balde(t.occurredAt);
        if (b) b[t.kind === "INCOME" ? "income" : "expense"] += t.amountCents;
      }
      for (const c of chargesDaSerie) {
        const b = c.settledAt ? balde(c.settledAt) : undefined;
        if (b) b.income += c.amountCents;
      }

      const rotulos = new Map(catalogo.map((c) => [c.id, c.label]));

      return {
        saldo,
        saldoInicial: settings.initialBalanceCents,
        receitasMes: receitasMes + autoMes,
        despesasMes,
        resultadoMes: receitasMes + autoMes - despesasMes,
        mensalidadesMes: autoMes,
        receitasPrevistas,
        despesasPrevistas,
        saldoProjetado: saldo + receitasPrevistas - despesasPrevistas,
        horizonDays,
        /** Os quatro horizontes de uma vez — trocar de horizonte não volta cá. */
        forecast,
        includeFees: settings.includeFees,
        monthly: [...meses.entries()].map(([month, v]) => ({ month, ...v })),
        proximasDespesas,
        proximasReceitas,
        porCategoria: porCategoria
          .map((c) => ({
            kind: c.kind,
            label: c.categoryId ? (rotulos.get(c.categoryId) ?? "Sem categoria") : "Sem categoria",
            amountCents: c._sum.amountCents ?? 0,
          }))
          .sort((a, b) => b.amountCents - a.amountCents),
      };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Movimentos                                                              */
  /* ---------------------------------------------------------------------- */

  /**
   * A lista de movimentos — os registados à mão e as mensalidades pagas,
   * fundidos por data.
   *
   * As linhas automáticas trazem `source: "fees"` e não se editam aqui: a
   * verdade delas vive nas Mensalidades, e é lá que um estorno acontece.
   */
  async transactions(
    ctx: RequestContext,
    p: {
      kind?: string; status?: string; categoryId?: string; q?: string;
      from?: string; to?: string; matchId?: string; calendarEventId?: string;
      athleteId?: string; teamId?: string;
    } = {},
  ) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const settings = await this.settingsRow(db, ctx.academyId);
      const termo = p.q?.trim();

      const rows = await db.financialTransaction.findMany({
        where: {
          ...(p.kind ? { kind: p.kind as FinanceKind } : {}),
          ...(p.status ? { status: p.status as FinanceStatus } : {}),
          ...(p.categoryId ? { categoryId: p.categoryId } : {}),
          ...(p.matchId ? { matchId: p.matchId } : {}),
          ...(p.calendarEventId ? { calendarEventId: p.calendarEventId } : {}),
          ...(p.athleteId ? { athleteId: p.athleteId } : {}),
          ...(p.teamId ? { teamId: p.teamId } : {}),
          ...(p.from || p.to
            ? { occurredAt: { ...(p.from ? { gte: new Date(p.from) } : {}), ...(p.to ? { lte: new Date(p.to) } : {}) } }
            : {}),
          ...(termo
            ? {
                OR: [
                  { description: { contains: termo, mode: "insensitive" as const } },
                  { counterparty: { contains: termo, mode: "insensitive" as const } },
                ],
              }
            : {}),
        },
        orderBy: { occurredAt: "desc" },
        take: 300,
        select: {
          id: true, kind: true, status: true, description: true, amountCents: true,
          occurredAt: true, dueDate: true, method: true, counterparty: true, notes: true, seriesId: true,
          category: { select: { id: true, label: true } },
          athlete: { select: { id: true, name: true } },
          member: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          staff: { select: { id: true, user: { select: { name: true } } } },
          match: { select: { id: true, opponent: true, isHome: true, team: { select: { name: true } } } },
          calendarEvent: { select: { id: true, title: true } },
          createdBy: { select: { user: { select: { name: true } } } },
        },
      });

      const manuais = rows.map((t) => ({
        id: t.id,
        source: "manual" as const,
        kind: t.kind,
        status: t.status,
        description: t.description,
        amountCents: t.amountCents,
        occurredAt: t.occurredAt,
        dueDate: t.dueDate,
        method: t.method,
        counterparty: t.counterparty,
        notes: t.notes,
        seriesId: t.seriesId,
        category: t.category,
        athlete: t.athlete,
        member: t.member,
        team: t.team,
        staffName: t.staff?.user.name ?? null,
        match: t.match ? { id: t.match.id, label: `${t.match.isHome ? "vs" : "@"} ${t.match.opponent}`, teamName: t.match.team.name } : null,
        calendarEvent: t.calendarEvent,
        createdBy: t.createdBy?.user.name ?? null,
      }));

      /*
       * As mensalidades, quando a fonte está ligada e os filtros não a excluem.
       * Um filtro por categoria, evento ou estado planeado não tem mensalidades
       * para mostrar — poupa-se a leitura inteira.
       */
      const querAutomaticas =
        settings.includeFees &&
        (!p.kind || p.kind === "INCOME") &&
        (!p.status || p.status === "COMPLETED") &&
        !p.categoryId && !p.matchId && !p.calendarEventId && !p.teamId;

      const automaticas = querAutomaticas
        ? (
            await db.charge.findMany({
              where: {
                status: "SETTLED",
                ...(p.athleteId ? { athleteId: p.athleteId } : {}),
                ...(p.from || p.to
                  ? { settledAt: { ...(p.from ? { gte: new Date(p.from) } : {}), ...(p.to ? { lte: new Date(p.to) } : {}) } }
                  : {}),
              },
              orderBy: { settledAt: "desc" },
              take: 300,
              select: {
                id: true, amountCents: true, period: true, settledAt: true,
                athlete: { select: { id: true, name: true } },
              },
            })
          )
            .filter((c) => !termo || `mensalidade ${c.period} ${c.athlete.name}`.toLowerCase().includes(termo.toLowerCase()))
            .map((c) => ({
              id: `charge_${c.id}`,
              source: "fees" as const,
              kind: "INCOME" as const,
              status: "COMPLETED" as const,
              description: `Mensalidade ${c.period} · ${c.athlete.name}`,
              amountCents: c.amountCents,
              occurredAt: c.settledAt ?? new Date(),
              dueDate: null,
              method: null,
              counterparty: null,
              notes: null,
              seriesId: null,
              category: { id: "auto-fees", label: "Mensalidades" },
              athlete: c.athlete,
              member: null,
              team: null,
              staffName: null,
              match: null,
              calendarEvent: null,
              createdBy: null,
            }))
        : [];

      return [...manuais, ...automaticas]
        .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        .slice(0, 300);
    });
  }

  /**
   * Registar um movimento — ou uma série fixa mensal, de X a Y.
   *
   * A série nasce toda de uma vez, em linhas próprias, porque é isso que
   * permite confirmá-la mês a mês: a renda de Outubro paga-se num dia e a de
   * Novembro noutro, e às vezes por outro valor. Uma regra avaliada na leitura
   * não teria onde guardar nada disso.
   */
  async createTransaction(ctx: RequestContext, dto: CreateTransactionDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await this.validarCategoria(db, dto.categoryId, dto.kind);

      const comum = {
        academyId: ctx.academyId,
        kind: dto.kind as FinanceKind,
        description: dto.description.trim(),
        amountCents: dto.amountCents,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        categoryId: dto.categoryId || null,
        method: (dto.method as PaymentMethod) || null,
        counterparty: dto.counterparty?.trim() || null,
        notes: dto.notes?.trim() || null,
        athleteId: dto.athleteId || null,
        memberId: dto.memberId || null,
        teamId: dto.teamId || null,
        staffId: dto.staffId || null,
        matchId: dto.matchId || null,
        calendarEventId: dto.calendarEventId || null,
        createdById: ctx.membershipId ?? null,
      };

      if (!dto.repeatMonthly) {
        const t = await db.financialTransaction.create({
          data: { ...comum, status: (dto.status as FinanceStatus) ?? "COMPLETED", occurredAt: new Date(dto.occurredAt) },
          select: { id: true },
        });
        return { id: t.id, created: 1 };
      }

      if (!dto.repeatUntil) throw new BadRequestException("Diz até quando é que a despesa se repete");
      const datas = mesesEntre(dto.occurredAt, dto.repeatUntil);

      /*
       * Uma escrita, não uma por mês.
       *
       * Doze inserções em fila dentro da transação são doze viagens à base — foi
       * o que já derrubou uma importação grande do inventário. Os ids geram-se
       * aqui para se poder devolver o primeiro sem voltar a perguntar.
       */
      const ids = datas.map(() => randomUUID());
      const serie = randomUUID();
      await db.financialTransaction.createMany({
        data: datas.map((occurredAt, i) => ({
          ...comum,
          id: ids[i],
          // Uma série é sempre previsão: nenhum mês por vir já foi pago, e
          // confirmar cada um é o gesto que faz o saldo dizer a verdade.
          status: "PLANNED" as FinanceStatus,
          occurredAt,
          seriesId: serie,
        })),
      });

      return { id: ids[0], created: ids.length, seriesId: serie };
    });
  }

  /**
   * Editar — inclusive confirmar um previsto (`PLANNED` → `COMPLETED`), que é o
   * gesto de "o autocarro foi pago". As linhas automáticas não passam por aqui:
   * têm ids `charge_…` que nenhuma rota aceita, de propósito.
   */
  async updateTransaction(ctx: RequestContext, id: string, dto: UpdateTransactionDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atual = await db.financialTransaction.findFirst({
        where: { id },
        select: { id: true, kind: true, status: true, seriesId: true, occurredAt: true },
      });
      if (!atual) throw new NotFoundException("Movimento não encontrado");

      // Um cancelado é história: fica como está. Reactivar seria reescrever o
      // passado — regista-se de novo, que é o que aconteceu na vida real.
      if (atual.status === "CANCELLED" && dto.status !== "CANCELLED") {
        throw new BadRequestException("Um movimento cancelado não se reactiva — regista um novo");
      }

      await this.validarCategoria(db, dto.categoryId, atual.kind);

      const texto = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);

      const data = {
        ...(dto.status !== undefined ? { status: dto.status as FinanceStatus } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(dto.amountCents !== undefined ? { amountCents: dto.amountCents } : {}),
        ...(dto.dueDate !== undefined ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
        ...(dto.method !== undefined ? { method: (dto.method as PaymentMethod) || null } : {}),
        ...(dto.counterparty !== undefined ? { counterparty: texto(dto.counterparty) } : {}),
        ...(dto.notes !== undefined ? { notes: texto(dto.notes) } : {}),
        ...(dto.athleteId !== undefined ? { athleteId: dto.athleteId || null } : {}),
        ...(dto.teamId !== undefined ? { teamId: dto.teamId || null } : {}),
        updatedById: ctx.membershipId ?? null,
      };

      /*
       * "E os meses seguintes."
       *
       * A renda sobe, o contrato acaba — e quem tem trinta e seis linhas de uma
       * série não vai lá corrigir trinta e seis. Alcança este mês e os que vêm
       * depois, e só os que ainda estão por acontecer: um mês já pago é
       * história, e cancelar em série não pode apagar o que se pagou.
       *
       * A data fica de fora de propósito — mudar a data "e seguintes" punha
       * todos os meses no mesmo dia, que nunca é o que se quer pedir.
       */
      if (dto.scope === "series" && atual.seriesId) {
        await db.financialTransaction.updateMany({
          where: {
            seriesId: atual.seriesId,
            occurredAt: { gte: atual.occurredAt },
            status: { in: ["PLANNED", "PENDING"] },
          },
          data,
        });
        return { ok: true };
      }

      await db.financialTransaction.update({
        where: { id },
        data: { ...data, ...(dto.occurredAt !== undefined ? { occurredAt: new Date(dto.occurredAt) } : {}) },
      });

      return { ok: true };
    });
  }

  /**
   * Apagar um movimento — a saída para o que nunca devia ter sido lançado.
   *
   * ## Porque é que apagar existe ao lado de cancelar
   *
   * Ver a regra 3 no cabeçalho: cancelar conta uma história ("estava previsto e
   * não se concretizou"), apagar admite um engano. Um clube que lançou a mesma
   * despesa duas vezes não quer a duplicada riscada no extracto para sempre —
   * quer o extracto certo.
   *
   * ## O que apaga, e o que nunca alcança
   *
   * Só linhas desta tabela, que são as **lançadas à mão**. As mensalidades pagas
   * derivam de `Charge` e nem sequer existem aqui: um id delas cai no 404, e o
   * estorno continua a acontecer onde a verdade delas vive.
   *
   * ## A série
   *
   * `scope: "series"` apaga este mês e os **seguintes** da mesma série — nunca
   * os anteriores, que já passaram e não são deste engano. Ao contrário do
   * cancelar em série, não filtra por estado: quem apaga está a dizer que a
   * série inteira foi um erro, e deixar de fora um mês já confirmado devolvia
   * uma limpeza pela metade, com uma linha órfã sem as irmãs. O número de linhas
   * apagadas volta na resposta para a interface o poder dizer.
   */
  async deleteTransaction(ctx: RequestContext, id: string, dto: DeleteTransactionDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atual = await db.financialTransaction.findFirst({
        where: { id },
        select: { id: true, seriesId: true, occurredAt: true },
      });
      if (!atual) throw new NotFoundException("Movimento não encontrado");

      if (dto.scope === "series" && atual.seriesId) {
        const { count } = await db.financialTransaction.deleteMany({
          where: { seriesId: atual.seriesId, occurredAt: { gte: atual.occurredAt } },
        });
        return { ok: true, deleted: count };
      }

      await db.financialTransaction.delete({ where: { id } });
      return { ok: true, deleted: 1 };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Definições e orçamento                                                  */
  /* ---------------------------------------------------------------------- */

  async settings(ctx: RequestContext) {
    this.mustRead(ctx);
    return this.prisma.runAs(ctx.academyId, (db) => this.settingsRow(db, ctx.academyId));
  }

  async updateSettings(ctx: RequestContext, dto: SettingsDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atual = await this.settingsRow(db, ctx.academyId);
      await db.financeSettings.update({
        where: { id: atual.id },
        data: {
          ...(dto.initialBalanceCents !== undefined ? { initialBalanceCents: dto.initialBalanceCents } : {}),
          ...(dto.initialBalanceAt !== undefined
            ? { initialBalanceAt: dto.initialBalanceAt ? new Date(dto.initialBalanceAt) : null }
            : {}),
          ...(dto.includeFees !== undefined ? { includeFees: dto.includeFees } : {}),
          ...(dto.includeQuotas !== undefined ? { includeQuotas: dto.includeQuotas } : {}),
        },
      });
      return { ok: true };
    });
  }

  /**
   * O orçamento de uma época: cada categoria de despesa com o tecto e o gasto.
   *
   * O gasto deriva-se dos concluídos dentro das datas da época — guardar um
   * acumulado seria a mesma verdade duas vezes.
   */
  async budgets(ctx: RequestContext, seasonId?: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      /*
       * Sem `seasonId`, a época em curso — e "em curso" não é `isCurrent`.
       *
       * Era `findFirst({ isCurrent: true })`, e a página do Orçamento não abria
       * em clube nenhum: as épocas nascem por marcar (ver `currentSeason`), e
       * uma academia inteira ficava a olhar para "Época não encontrada" sem
       * nada que pudesse fazer na consola para o resolver.
       */
      const season = seasonId
        ? await db.season.findFirst({ where: { id: seasonId }, select: { id: true, label: true, startsOn: true, endsOn: true } })
        : await currentSeason(db);
      /*
       * Sem época nenhuma é outro caso, e merece outra frase.
       *
       * Um clube fica sem épocas até criar a primeira equipa — é a equipa que
       * abre a época (`resolveSeason`). "Época não encontrada" mandava a
       * direcção procurar uma coisa que ainda não existe; a frase diz-lhe o que
       * fazer para ela passar a existir.
       */
      if (!season) {
        throw new NotFoundException(
          seasonId
            ? "Época não encontrada"
            : "Este clube ainda não tem épocas — a primeira abre com a primeira equipa.",
        );
      }

      const [orcamentos, gastos, categorias] = await Promise.all([
        db.financialBudget.findMany({ where: { seasonId: season.id }, select: { categoryId: true, amountCents: true } }),
        db.financialTransaction.groupBy({
          by: ["categoryId"],
          where: { kind: "EXPENSE", status: "COMPLETED", occurredAt: { gte: season.startsOn, lte: season.endsOn } },
          _sum: { amountCents: true },
        }),
        db.catalogItem.findMany({
          where: { kind: "financeExpense", archivedAt: null },
          orderBy: [{ order: "asc" }, { label: "asc" }],
          select: { id: true, label: true },
        }),
      ]);

      const tecto = new Map(orcamentos.map((b) => [b.categoryId, b.amountCents]));
      const gasto = new Map(gastos.map((g) => [g.categoryId, g._sum.amountCents ?? 0]));

      return {
        season: { id: season.id, label: season.label },
        rows: categorias.map((c) => ({
          categoryId: c.id,
          label: c.label,
          budgetCents: tecto.get(c.id) ?? 0,
          spentCents: gasto.get(c.id) ?? 0,
        })),
      };
    });
  }

  /** Fixar o tecto de uma categoria. Zero apaga a linha — sem tecto não há linha. */
  async setBudget(ctx: RequestContext, dto: BudgetDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const season = await db.season.findFirst({ where: { id: dto.seasonId }, select: { id: true } });
      if (!season) throw new NotFoundException("Época não encontrada");
      await this.validarCategoria(db, dto.categoryId, "EXPENSE");

      if (dto.amountCents === 0) {
        await db.financialBudget.deleteMany({ where: { seasonId: dto.seasonId, categoryId: dto.categoryId } });
        return { ok: true };
      }

      const existente = await db.financialBudget.findFirst({
        where: { seasonId: dto.seasonId, categoryId: dto.categoryId },
        select: { id: true },
      });
      if (existente) {
        await db.financialBudget.update({ where: { id: existente.id }, data: { amountCents: dto.amountCents } });
      } else {
        await db.financialBudget.create({
          data: { academyId: ctx.academyId, seasonId: dto.seasonId, categoryId: dto.categoryId, amountCents: dto.amountCents },
        });
      }
      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Miudezas                                                                */
  /* ---------------------------------------------------------------------- */

  /** A soma das mensalidades pagas — a fonte automática, derivada de `Charge`. */
  private async autoIncomeSum(db: ScopedClient, desde?: Date): Promise<number> {
    const r = await db.charge.aggregate({
      where: { status: "SETTLED", ...(desde ? { settledAt: { gte: desde } } : {}) },
      _sum: { amountCents: true },
    });
    return r._sum.amountCents ?? 0;
  }

  /** A linha de definições, criada à primeira leitura — como os catálogos. */
  private async settingsRow(db: ScopedClient, academyId: string) {
    const existente = await db.financeSettings.findFirst({ where: { academyId } });
    if (existente) return existente;
    return db.financeSettings.create({ data: { academyId } });
  }

  /**
   * A categoria tem de ser do catálogo certo: uma despesa em "Patrocínios" é
   * quase sempre um clique errado, e apanhá-lo aqui poupa um mês estranho no
   * relatório por categoria.
   */
  private async validarCategoria(db: ScopedClient, id: string | undefined, kind: string) {
    if (!id) return;
    const esperado = kind === "INCOME" ? "financeIncome" : "financeExpense";
    const item = await db.catalogItem.findFirst({ where: { id, kind: esperado }, select: { id: true } });
    if (!item) {
      throw new BadRequestException(
        kind === "INCOME" ? "Escolhe uma categoria de receita" : "Escolhe uma categoria de despesa",
      );
    }
  }
}

/** Os horizontes que o painel oferece. Vão todos na mesma resposta. */
const HORIZONTES = [30, 90, 180, 365] as const;

/** Cinco anos de renda. Depois disso é um contrato novo, não a mesma série. */
const MAX_OCORRENCIAS = 60;

/**
 * Os meses de uma despesa fixa, do primeiro ao último.
 *
 * ## O dia 31 encosta, não desaparece
 *
 * O calendário, nos treinos, **salta** os meses que não têm o dia escolhido —
 * e faz bem: não há treino num dia que não existe. Numa renda é o contrário:
 * uma renda que vence a 31 vence-se a 28 em Fevereiro, e saltar o mês era
 * perder uma renda inteira na previsão. Por isso aqui encosta-se ao último dia
 * do mês.
 *
 * Tudo em UTC porque `occurredAt` é uma data sem horas: com getters locais, um
 * clube a ocidente de Greenwich via o dia 1 virar dia 31 do mês anterior.
 */
function mesesEntre(desde: string, ate: string): Date[] {
  const inicio = new Date(desde);
  const fim = new Date(ate);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) throw new BadRequestException("Datas inválidas");
  if (fim < inicio) throw new BadRequestException("A repetição tem de acabar depois do primeiro mês");

  const dia = inicio.getUTCDate();
  const out: Date[] = [];

  for (let i = 0; out.length < MAX_OCORRENCIAS; i++) {
    const mes = inicio.getUTCMonth() + i;
    const ultimoDoMes = new Date(Date.UTC(inicio.getUTCFullYear(), mes + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(inicio.getUTCFullYear(), mes, Math.min(dia, ultimoDoMes)));
    if (d > fim) break;
    out.push(d);
  }

  return out;
}

/** O mais tardio de dois inícios — o mês corrente nunca conta antes do saldo inicial. */
function maisTarde(a: Date, b?: Date): Date {
  return b && b > a ? b : a;
}

function serializeCurto(t: {
  id: string; description: string; amountCents: number; occurredAt: Date; status: FinanceStatus;
  category: { label: string } | null;
  match: { id: string; opponent: string; isHome: boolean } | null;
  calendarEvent: { id: string; title: string } | null;
}) {
  return {
    id: t.id,
    description: t.description,
    amountCents: t.amountCents,
    occurredAt: t.occurredAt,
    status: t.status,
    category: t.category?.label ?? null,
    eventLabel: t.match ? `${t.match.isHome ? "vs" : "@"} ${t.match.opponent}` : (t.calendarEvent?.title ?? null),
  };
}
