import { randomUUID } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { formatarNoFuso, partesNoFuso } from "../common/fuso";
import type { FinanceKind, FinanceStatus, PaymentMethod } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";
import { currentSeason } from "../common/seasons";
import type {
  BudgetDto,
  CreateTransactionDto,
  DeleteTransactionDto,
  PayMonthDto,
  PaySalaryDto,
  SalaryDto,
  SettingsDto,
  UpdateSalaryDto,
  UpdateTransactionDto,
} from "./finance.dto";
import { chaveDoMes, mesDaReceita, nomeDoMes } from "./mes-da-receita";
import {
  chaveDoDia,
  dataDoDia,
  estadoDoMes,
  mesDaData,
  mesesDevidos,
  periodoValido,
  somarMeses,
  type Dia,
  type EstadoDoMes,
  type MesDevido,
  type PeriodoDeVencimento,
} from "./vencimentos";

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
 * 2. **Os pagamentos derivam-se, não se copiam.** As mensalidades e as
 *    cobranças avulsas (`Charge`: equipamento, inscrições, estágios) e as
 *    quotas dos sócios (`MemberFee`) já são a verdade delas; a euPago confirma
 *    lá, os estornos acontecem lá, marcar à mão acontece lá. Este módulo lê —
 *    e por isso "nunca duplicar movimentos" é trivialmente verdade, e desligar
 *    uma fonte no saldo não apaga pagamento nenhum. Tudo o que o clube recebe
 *    por aí cai nos movimentos (decisão do Rui, 13/10/2026: "tudo que seja
 *    pagamentos deve cair nos movimentos do clube").
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
  async overview(ctx: RequestContext, horizonDays = 30, meses = 6) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const settings = await this.settingsRow(db, ctx.academyId);
      const desde = settings.initialBalanceAt ?? undefined;

      const hoje = new Date();
      const inicioDoMes = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
      const desdeOMes = maisTarde(inicioDoMes, desde);
      /*
       * A série: 6, 12 ou 24 meses, a escolha de quem olha. O período também
       * manda no "por categoria", que deixou de ser só o mês corrente: um
       * clube que quer saber em que gastou na época olha para a época.
       */
      const inicioDaSerie = new Date(hoje.getFullYear(), hoje.getMonth() - (meses - 1), 1);
      const serieDesde = maisTarde(inicioDaSerie, desde);
      const diaDeHoje = partesNoFuso(hoje);
      /*
       * As mensalidades e as quotas contam no mês em que foram pagas: o
       * dinheiro entra nas contas do clube no dia em que entrou. A de julho
       * paga hoje é receita deste mês, como no saldo.
       *
       * Entre 25/10 e 28/10/2026 contaram no mês a que respeitavam; o Rui
       * voltou a pô-las no mês do pagamento (28/10). Para registar uma
       * mensalidade antiga no mês certo, escolhe-se a data do pagamento ao
       * marcá-la paga (ver `billing/dia-do-pagamento.ts`).
       *
       * Lêem-se as pagas nos seis meses da série, sempre depois do saldo
       * inicial: o que foi pago antes dele já está nele.
       */
      const pagasNaSerie = { settledAt: { gte: serieDesde } };

      const [totais, porVir, movimentosDaSerie, chargesDaSerie, autoTotal, catalogo, quotasDaSerie, quotasTotal] = await Promise.all([
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
            trainingSession: { select: { id: true, startsAt: true, team: { select: { name: true } } } },
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
              where: { status: "SETTLED", ...pagasNaSerie },
              select: { amountCents: true, settledAt: true, period: true },
            })
          : Promise.resolve([]),
        /*
         * O total das mensalidades desde o saldo inicial, pelo dia do pagamento:
         * é o que entra no saldo. Já não sai das linhas acima, que agora se
         * escolhem pelo mês a que respeitam.
         */
        settings.includeFees ? this.autoIncomeSum(db, desde) : Promise.resolve(0),
        // Os rótulos, incluindo arquivados: um movimento antigo pode apontar
        // para uma categoria que o clube entretanto arrumou.
        db.catalogItem.findMany({
          where: { kind: { in: ["financeIncome", "financeExpense"] } },
          select: { id: true, label: true },
        }),
        // As quotas dos sócios pagas: a outra fonte automática, com a mesma regra.
        settings.includeQuotas
          ? db.memberFee.findMany({
              where: { status: "SETTLED", ...pagasNaSerie },
              select: { amountCents: true, settledAt: true, period: true, coversFrom: true },
            })
          : Promise.resolve([]),
        settings.includeQuotas
          ? db.memberFee
              .aggregate({ where: { status: "SETTLED", ...(desde ? { settledAt: { gte: desde } } : {}) }, _sum: { amountCents: true } })
              .then((r) => r._sum.amountCents ?? 0)
          : Promise.resolve(0),
      ]);

      /*
       * Os vencimentos: o que se deve e o que já se pagou. Ver `folha` — é a
       * mesma conta da página dos vencimentos, para os dois ecrãs dizerem o
       * mesmo número. E o orçamento da época em curso, para avisar do que
       * passou do tecto.
       */
      const [folha, epoca] = await Promise.all([this.folha(db, diaDeHoje), currentSeason(db)]);
      const [orcamentos, gastosDaEpoca] = epoca
        ? await Promise.all([
            db.financialBudget.findMany({
              where: { seasonId: epoca.id },
              select: { categoryId: true, amountCents: true, category: { select: { label: true } } },
            }),
            db.financialTransaction.groupBy({
              by: ["categoryId"],
              where: { kind: "EXPENSE", status: "COMPLETED", occurredAt: { gte: epoca.startsOn, lte: epoca.endsOn } },
              _sum: { amountCents: true },
            }),
          ])
        : [[], []];

      const doTipo = (k: FinanceKind) => totais.find((t) => t.kind === k)?._sum.amountCents ?? 0;
      const receitas = doTipo("INCOME");
      const despesas = doTipo("EXPENSE");

      const somaCharges = (rows: { amountCents: number }[]) => rows.reduce((s, c) => s + c.amountCents, 0);
      const autoDesdeOInicial = autoTotal;
      /* O mês em que cada uma foi paga, na hora do clube. */
      const mesDe = (c: { settledAt: Date | null }) => (c.settledAt ? chaveDoMes(c.settledAt) : null);
      const mesAtual = chaveDoMes(hoje);
      const autoMes = somaCharges(chargesDaSerie.filter((c) => mesDe(c) === mesAtual));
      const quotasMes = somaCharges(quotasDaSerie.filter((q) => mesDe(q) === mesAtual));
      /*
       * Das receitas deste mês, quanto é de mensalidades e quotas de meses
       * anteriores (a de julho paga hoje). Já está nas receitas; diz-se à
       * parte para se perceber de onde veio.
       */
      const deMesesAnteriores = somaCharges(
        [...chargesDaSerie, ...quotasDaSerie].filter(
          (c: { period: string; settledAt: Date | null; coversFrom?: Date | null }) =>
            mesDe(c) === mesAtual && (mesDaReceita(c.period, { coversFrom: c.coversFrom ?? null, pagaEm: c.settledAt }) ?? mesAtual) < mesAtual,
        ),
      );

      /* --------------------------------------------------------- o mês --- */
      const doMes = movimentosDaSerie.filter((t) => t.occurredAt >= desdeOMes);
      const receitasMes = doMes.filter((t) => t.kind === "INCOME").reduce((s, t) => s + t.amountCents, 0);
      const despesasMes = doMes.filter((t) => t.kind === "EXPENSE").reduce((s, t) => s + t.amountCents, 0);

      /*
       * Em que entrou e em que saiu, por categoria, no período da série.
       *
       * Era só o mês corrente; passou a ser o período que se escolheu em cima,
       * porque "em que gastámos esta época" é a pergunta que a direção faz, e o
       * mês corrente a dia 3 não responde a nada. As mensalidades e as quotas
       * entram como categorias de receita: são quase sempre a maior, e um
       * gráfico de receitas sem elas mentia por omissão.
       */
      const acumulado = new Map<string, { kind: FinanceKind; amountCents: number }>();
      for (const t of movimentosDaSerie) {
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

      const saldo = settings.initialBalanceCents + receitas + autoDesdeOInicial + quotasTotal - despesas;

      /* ----------------------------------------------------- o previsto --- */
      /*
       * Os vencimentos por pagar entram nas previsões como qualquer despesa
       * prevista: o deste mês vence no dia marcado, os em atraso já venceram
       * (contam em todos os horizontes), os dos meses seguintes na data deles.
       */
      const vencimentosPorVir = folha.pessoas.flatMap((p) =>
        p.meses
          .filter((m) => m.estado !== "pago")
          .map((m) => ({
            id: `salary_${m.salaryId}_${m.period}`,
            kind: "EXPENSE" as FinanceKind,
            description: `Vencimento de ${nomeDoMes(m.period)} · ${p.nome}`,
            amountCents: m.amountCents,
            occurredAt: new Date(`${m.vence}T00:00:00.000Z`),
            status: "PLANNED" as FinanceStatus,
            category: { label: "Vencimentos" },
            match: null,
            calendarEvent: null,
            trainingSession: null,
          })),
      );
      const tudoPorVir = [...porVir, ...vencimentosPorVir].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

      const somaAte = (kind: FinanceKind, dias: number) => {
        const limite = new Date(hoje.getTime() + dias * 86_400_000);
        return tudoPorVir.filter((t) => t.kind === kind && t.occurredAt <= limite).reduce((s, t) => s + t.amountCents, 0);
      };
      const forecast = HORIZONTES.map((days) => ({
        days,
        income: somaAte("INCOME", days),
        expense: somaAte("EXPENSE", days),
      }));
      const receitasPrevistas = somaAte("INCOME", horizonDays);
      const despesasPrevistas = somaAte("EXPENSE", horizonDays);

      const proximasReceitas = tudoPorVir.filter((t) => t.kind === "INCOME").slice(0, 6).map(serializeCurto);
      const proximasDespesas = tudoPorVir.filter((t) => t.kind === "EXPENSE").slice(0, 6).map(serializeCurto);

      /* ------------------------------------------------- a série mensal --- */
      const serie = new Map<string, { income: number; expense: number }>();
      for (let i = meses - 1; i >= 0; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        serie.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { income: 0, expense: 0 });
      }
      const balde = (d: Date) => serie.get(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
      for (const t of movimentosDaSerie) {
        const b = balde(t.occurredAt);
        if (b) b[t.kind === "INCOME" ? "income" : "expense"] += t.amountCents;
      }
      // As mensalidades e as quotas no mês em que foram pagas.
      for (const c of [...chargesDaSerie, ...quotasDaSerie]) {
        const chave = mesDe(c);
        const b = chave ? serie.get(chave) : undefined;
        if (b) b.income += c.amountCents;
      }

      const rotulos = new Map(catalogo.map((c) => [c.id, c.label]));

      /* ------------------------------------------- o que precisa de atenção --- */
      /*
       * A lista que abre a página: o que está fora do sítio. Só o que existe —
       * uma página que diz "nada a assinalar" em quatro linhas é ruído.
       */
      const inicioDeHoje = new Date(`${dataDoDia(diaDeHoje)}T00:00:00.000Z`);
      const vencidos = porVir.filter((t) => t.occurredAt < inicioDeHoje);
      const gastoPorCategoria = new Map(gastosDaEpoca.map((g) => [g.categoryId, g._sum.amountCents ?? 0]));
      const acimaDoOrcamento = orcamentos
        .map((o) => ({ label: o.category.label, budgetCents: o.amountCents, spentCents: gastoPorCategoria.get(o.categoryId) ?? 0 }))
        .filter((o) => o.budgetCents > 0 && o.spentCents > o.budgetCents)
        .sort((a, b) => b.spentCents - b.budgetCents - (a.spentCents - a.budgetCents));

      const atencao: Atencao[] = [];
      if (folha.resumo.emAtraso.n > 0) atencao.push({ tipo: "vencimentos-atraso", n: folha.resumo.emAtraso.n, amountCents: folha.resumo.emAtraso.amountCents });
      if (folha.resumo.porPagarEsteMes.n > 0) {
        atencao.push({ tipo: "vencimentos-mes", n: folha.resumo.porPagarEsteMes.n, amountCents: folha.resumo.porPagarEsteMes.amountCents });
      }
      if (vencidos.length > 0) {
        atencao.push({
          tipo: "previstos-vencidos",
          n: vencidos.length,
          amountCents: vencidos.reduce((s, t) => s + (t.kind === "EXPENSE" ? t.amountCents : 0), 0),
          receitasCents: vencidos.reduce((s, t) => s + (t.kind === "INCOME" ? t.amountCents : 0), 0),
        });
      }
      if (acimaDoOrcamento.length > 0) atencao.push({ tipo: "orcamento", categorias: acimaDoOrcamento.slice(0, 4), epoca: epoca?.label ?? "" });
      const projetado30 = saldo + forecast[0].income - forecast[0].expense;
      if (projetado30 < 0 && saldo >= 0) atencao.push({ tipo: "saldo-projetado", amountCents: projetado30 });

      return {
        saldo,
        saldoInicial: settings.initialBalanceCents,
        receitasMes: receitasMes + autoMes + quotasMes,
        despesasMes,
        resultadoMes: receitasMes + autoMes + quotasMes - despesasMes,
        mensalidadesMes: autoMes,
        quotasMes,
        /** Das receitas deste mês, o que é de mensalidades e quotas de meses anteriores. */
        recebidoDeMesesAnteriores: deMesesAnteriores,
        receitasPrevistas,
        despesasPrevistas,
        saldoProjetado: saldo + receitasPrevistas - despesasPrevistas,
        horizonDays,
        /** Os quatro horizontes de uma vez — trocar de horizonte não volta cá. */
        forecast,
        includeFees: settings.includeFees,
        includeQuotas: settings.includeQuotas,
        /** Quantos meses tem a série (e o "por categoria"). */
        meses,
        mesAtual: chaveDoDia(diaDeHoje),
        monthly: [...serie.entries()].map(([month, v]) => ({ month, ...v })),
        proximasDespesas,
        proximasReceitas,
        porCategoria: [
          ...porCategoria.map((c) => ({
            kind: c.kind,
            label: c.categoryId ? (rotulos.get(c.categoryId) ?? "Sem categoria") : "Sem categoria",
            amountCents: c._sum.amountCents ?? 0,
          })),
          ...(chargesDaSerie.length ? [{ kind: "INCOME" as FinanceKind, label: "Mensalidades e cobranças", amountCents: somaCharges(chargesDaSerie) }] : []),
          ...(quotasDaSerie.length ? [{ kind: "INCOME" as FinanceKind, label: "Quotas de sócios", amountCents: somaCharges(quotasDaSerie) }] : []),
        ].sort((a, b) => b.amountCents - a.amountCents),
        /** A folha de vencimentos, em resumo. A página dos vencimentos tem o resto. */
        vencimentos: folha.resumo,
        /** O orçamento da época em curso, em totais, para o painel ligar ao separador. */
        orcamento: epoca
          ? {
              epoca: epoca.label,
              budgetCents: orcamentos.reduce((s, o) => s + o.amountCents, 0),
              spentCents: orcamentos.reduce((s, o) => s + (gastoPorCategoria.get(o.categoryId) ?? 0), 0),
              categorias: orcamentos.length,
              acima: acimaDoOrcamento.length,
            }
          : null,
        atencao,
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
      from?: string; to?: string; matchId?: string; calendarEventId?: string; trainingSessionId?: string;
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
          ...(p.trainingSessionId ? { trainingSessionId: p.trainingSessionId } : {}),
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
          salaryId: true, salaryPeriod: true,
          category: { select: { id: true, label: true } },
          athlete: { select: { id: true, name: true } },
          member: { select: { id: true, name: true } },
          team: { select: { id: true, name: true } },
          staff: { select: { id: true, user: { select: { name: true } } } },
          match: { select: { id: true, opponent: true, isHome: true, team: { select: { name: true } } } },
          calendarEvent: { select: { id: true, title: true } },
          trainingSession: { select: { id: true, startsAt: true, team: { select: { name: true } } } },
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
        /** Quando paga um mês de vencimento: o mês (`AAAA-MM`). */
        salaryPeriod: t.salaryPeriod,
        salaryId: t.salaryId,
        category: t.category,
        athlete: t.athlete,
        member: t.member,
        team: t.team,
        staffId: t.staff?.id ?? null,
        staffName: t.staff?.user.name ?? null,
        match: t.match ? { id: t.match.id, label: `${t.match.isHome ? "vs" : "@"} ${t.match.opponent}`, teamName: t.match.team.name } : null,
        // Um treino aparece onde aparece um evento, com o nome que tem no calendário.
        calendarEvent: t.calendarEvent ?? eventoDoTreino(t.trainingSession),
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
        !p.categoryId && !p.matchId && !p.calendarEventId && !p.trainingSessionId && !p.teamId;

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
              // Sem data no fim: eram as primeiras, e num clube com muitas empurravam as pagas de hoje para fora das 300.
              orderBy: { settledAt: { sort: "desc", nulls: "last" } },
              take: 300,
              select: {
                id: true, amountCents: true, period: true, settledAt: true, kind: true, title: true,
                athlete: { select: { id: true, name: true } },
                /*
                 * O pagamento que a liquidou: é dele que vem o método (MB WAY,
                 * Multibanco, numerário…) e quem pagou. Uma paga sem pagamento
                 * registado (marcada antes de se guardarem os manuais, ou uma
                 * de 0 €) fica sem método.
                 */
                payments: {
                  where: { status: "PAID" },
                  orderBy: { paidAt: "desc" },
                  take: 1,
                  select: { method: true, payerName: true, payerRelation: true },
                },
              },
            })
          )
            .map((c) => ({ c, descricao: `${c.kind === "EXTRA" && c.title ? c.title : `Mensalidade de ${nomeDoMes(c.period)}`} · ${c.athlete.name}` }))
            .filter(({ descricao }) => !termo || descricao.toLowerCase().includes(termo.toLowerCase()))
            .map(({ c, descricao }) => ({
              id: `charge_${c.id}`,
              source: "fees" as const,
              kind: "INCOME" as const,
              status: "COMPLETED" as const,
              description: descricao,
              amountCents: c.amountCents,
              occurredAt: c.settledAt ?? new Date(),
              /** O mês a que respeita (`AAAA-MM`). A data é a do pagamento. */
              referenteA: mesDaReceita(c.period, { pagaEm: c.settledAt }),
              dueDate: null,
              method: c.payments[0]?.method ?? null,
              counterparty: c.payments[0]?.payerName
                ? `${c.payments[0].payerName}${c.payments[0].payerRelation ? ` (${c.payments[0].payerRelation})` : ""}`
                : null,
              notes: null,
              seriesId: null,
              salaryPeriod: null,
              salaryId: null,
              // A avulsa (equipamento, inscrição) diz-se pelo nome; a mensalidade, "Mensalidades".
              category: c.kind === "EXTRA" ? { id: "auto-extra", label: "Cobranças" } : { id: "auto-fees", label: "Mensalidades" },
              athlete: c.athlete,
              member: null,
              team: null,
              staffId: null,
              staffName: null,
              match: null,
              calendarEvent: null,
              createdBy: null,
            }))
        : [];

      /* As quotas dos sócios pagas, com a mesma regra. Um filtro por atleta não as tem. */
      const querQuotas =
        settings.includeQuotas &&
        (!p.kind || p.kind === "INCOME") &&
        (!p.status || p.status === "COMPLETED") &&
        !p.categoryId && !p.matchId && !p.calendarEventId && !p.trainingSessionId && !p.teamId && !p.athleteId;

      const quotas = querQuotas
        ? (
            await db.memberFee.findMany({
              where: {
                status: "SETTLED",
                ...(p.from || p.to
                  ? { settledAt: { ...(p.from ? { gte: new Date(p.from) } : {}), ...(p.to ? { lte: new Date(p.to) } : {}) } }
                  : {}),
              },
              orderBy: { settledAt: { sort: "desc", nulls: "last" } },
              take: 300,
              select: {
                id: true, amountCents: true, period: true, label: true, settledAt: true, method: true, updatedAt: true, coversFrom: true,
                member: { select: { id: true, name: true } },
              },
            })
          )
            .map((q) => ({ q, descricao: `${q.label?.trim() || `Quota ${q.period}`} · ${q.member.name}` }))
            .filter(({ descricao }) => !termo || descricao.toLowerCase().includes(termo.toLowerCase()))
            .map(({ q, descricao }) => ({
              id: `quota_${q.id}`,
              source: "quotas" as const,
              kind: "INCOME" as const,
              status: "COMPLETED" as const,
              description: descricao,
              amountCents: q.amountCents,
              occurredAt: q.settledAt ?? q.updatedAt,
              /** O mês a que respeita (`AAAA-MM`). A data é a do pagamento. */
              referenteA: mesDaReceita(q.period, { coversFrom: q.coversFrom, pagaEm: q.settledAt ?? q.updatedAt }),
              dueDate: null,
              method: q.method ?? null,
              counterparty: null,
              notes: null,
              seriesId: null,
              salaryPeriod: null,
              salaryId: null,
              category: { id: "auto-quotas", label: "Quotas" },
              athlete: null,
              member: q.member,
              team: null,
              staffId: null,
              staffName: null,
              match: null,
              calendarEvent: null,
              createdBy: null,
            }))
        : [];

      return [...manuais, ...automaticas, ...quotas]
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
      if (dto.trainingSessionId) {
        // Dentro do runAs: um treino de outro clube não aparece, e não se liga.
        const treino = await db.trainingSession.findFirst({ where: { id: dto.trainingSessionId }, select: { id: true } });
        if (!treino) throw new BadRequestException("O treino não existe neste clube");
      }

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
        trainingSessionId: dto.trainingSessionId || null,
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

  /**
   * O orçamento de cada época, em totais — o histórico do planeamento.
   *
   * A página do Orçamento mostrava só a época em curso, e o que se planeou nas
   * outras ficava na base sem caminho para lá chegar. É a pergunta que se faz
   * ao planear a seguinte: "quanto orçámos no ano passado, e quanto gastámos
   * de facto?". O gasto é o mesmo que a página mostra — despesas concluídas
   * dentro das datas da época.
   *
   * Uma leitura por época para o gasto: um clube tem uma mão-cheia delas, e um
   * `groupBy` por intervalos de datas diferentes não existe.
   */
  async historicoDoOrcamento(ctx: RequestContext) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [epocas, emCurso, porEpoca] = await Promise.all([
        db.season.findMany({
          orderBy: { startsOn: "desc" },
          select: { id: true, label: true, startsOn: true, endsOn: true },
        }),
        currentSeason(db),
        db.financialBudget.groupBy({ by: ["seasonId"], _sum: { amountCents: true }, _count: { _all: true } }),
      ]);
      const orcado = new Map(porEpoca.map((b) => [b.seasonId, { cents: b._sum.amountCents ?? 0, linhas: b._count._all }]));

      const gastos = await Promise.all(
        epocas.map((e) =>
          db.financialTransaction.aggregate({
            where: { kind: "EXPENSE", status: "COMPLETED", occurredAt: { gte: e.startsOn, lte: e.endsOn } },
            _sum: { amountCents: true },
          }),
        ),
      );

      return epocas.map((e, i) => ({
        seasonId: e.id,
        label: e.label,
        startsOn: e.startsOn.toISOString().slice(0, 10),
        endsOn: e.endsOn.toISOString().slice(0, 10),
        current: e.id === emCurso?.id,
        budgetCents: orcado.get(e.id)?.cents ?? 0,
        categoriasOrcamentadas: orcado.get(e.id)?.linhas ?? 0,
        spentCents: gastos[i]._sum.amountCents ?? 0,
      }));
    });
  }

  /**
   * Começar o orçamento de uma época a partir de outra.
   *
   * Planear a época seguinte começa quase sempre pelo que se orçou na anterior,
   * e copiar vinte categorias à mão era o trabalho que fazia o orçamento ficar
   * por fazer. Copiam-se só as categorias que a época de destino **ainda não
   * tem**: um valor já escrito é uma decisão, e não se escreve por cima dela.
   * Categorias arquivadas ficam de fora — ninguém as vê na página.
   */
  async copiarOrcamento(ctx: RequestContext, fromSeasonId: string, toSeasonId: string) {
    this.mustWrite(ctx);
    if (fromSeasonId === toSeasonId) throw new BadRequestException("Escolhe outra época para copiar");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [de, para] = await Promise.all([
        db.season.findFirst({ where: { id: fromSeasonId }, select: { id: true } }),
        db.season.findFirst({ where: { id: toSeasonId }, select: { id: true } }),
      ]);
      if (!de || !para) throw new NotFoundException("Época não encontrada");

      const [origem, destino] = await Promise.all([
        db.financialBudget.findMany({
          where: { seasonId: fromSeasonId, category: { archivedAt: null } },
          select: { categoryId: true, amountCents: true },
        }),
        db.financialBudget.findMany({ where: { seasonId: toSeasonId }, select: { categoryId: true } }),
      ]);
      const jaTem = new Set(destino.map((d) => d.categoryId));
      const novas = origem.filter((o) => !jaTem.has(o.categoryId));
      if (novas.length) {
        await db.financialBudget.createMany({
          data: novas.map((o) => ({
            academyId: ctx.academyId,
            seasonId: toSeasonId,
            categoryId: o.categoryId,
            amountCents: o.amountCents,
          })),
          skipDuplicates: true,
        });
      }
      return { copiadas: novas.length, mantidas: origem.length - novas.length };
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
  /* Vencimentos                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * A folha de vencimentos: quem recebe, quanto, o que está pago e o que falta.
   *
   * ## Como se lê
   *
   * Cada pessoa tem um ou mais períodos (`Salary`); o que se deve em cada mês
   * sai de `mesesDevidos`, e o que está pago são os movimentos com
   * `salaryPeriod`. A janela vai de 12 meses atrás ao mês seguinte: o que
   * ficou por pagar há mais de um ano já não é folha, é história, e aparece na
   * ficha da pessoa pelos movimentos.
   *
   * Sem filtro é a academia toda; com `membershipId` ou `athleteId`, a ficha
   * de uma pessoa (com a mesma conta, para os dois ecrãs baterem certo).
   */
  async salaries(ctx: RequestContext, filtro: { membershipId?: string; athleteId?: string } = {}) {
    this.mustRead(ctx);
    return this.prisma.runAs(ctx.academyId, (db) => this.folha(db, partesNoFuso(new Date()), filtro));
  }

  private async folha(db: ScopedClient, hoje: Dia, filtro: { membershipId?: string; athleteId?: string } = {}) {
    const mesAtual = chaveDoDia(hoje);
    const janela = { desde: somarMeses(mesAtual, -12), ate: somarMeses(mesAtual, 1) };

    const [periodos, pagamentos] = await Promise.all([
      db.salary.findMany({
        where: {
          ...(filtro.membershipId ? { membershipId: filtro.membershipId } : {}),
          ...(filtro.athleteId ? { athleteId: filtro.athleteId } : {}),
        },
        orderBy: { startsOn: "desc" },
        select: {
          id: true, membershipId: true, athleteId: true, amountCents: true, startsOn: true, endsOn: true, payDay: true, notes: true,
          createdAt: true,
          membership: {
            select: { id: true, isActive: true, title: true, user: { select: { name: true } }, customRole: { select: { name: true } } },
          },
          athlete: {
            select: {
              id: true, name: true, status: true,
              teams: { where: { leftAt: null }, take: 1, select: { team: { select: { name: true } } } },
            },
          },
        },
      }),
      db.financialTransaction.findMany({
        where: {
          salaryId: { not: null },
          status: { not: "CANCELLED" },
          ...(filtro.membershipId ? { staffId: filtro.membershipId } : {}),
          ...(filtro.athleteId ? { athleteId: filtro.athleteId } : {}),
        },
        orderBy: { occurredAt: "desc" },
        select: { id: true, salaryId: true, salaryPeriod: true, amountCents: true, occurredAt: true, status: true, method: true },
      }),
    ]);

    /* Os pagamentos por pessoa e mês: a mesma pessoa pode ter pago um mês num período e o seguinte noutro. */
    const salarioDe = new Map(periodos.map((p) => [p.id, p]));
    const chavePessoa = (p: { membershipId: string | null; athleteId: string | null }) =>
      p.membershipId ? `staff:${p.membershipId}` : `atleta:${p.athleteId}`;
    const pagosPorPessoa = new Map<string, Map<string, (typeof pagamentos)[number]>>();
    for (const pg of pagamentos) {
      const s = pg.salaryId ? salarioDe.get(pg.salaryId) : undefined;
      if (!s || !pg.salaryPeriod) continue;
      const k = chavePessoa(s);
      const porMes = pagosPorPessoa.get(k) ?? new Map();
      // O mais recente ganha (a lista vem por data, do mais recente para trás).
      if (!porMes.has(pg.salaryPeriod)) porMes.set(pg.salaryPeriod, pg);
      pagosPorPessoa.set(k, porMes);
    }

    /* As pessoas, cada uma com os seus períodos (do mais recente para trás). */
    const porPessoa = new Map<string, typeof periodos>();
    for (const p of periodos) {
      const k = chavePessoa(p);
      porPessoa.set(k, [...(porPessoa.get(k) ?? []), p]);
    }

    const pessoas = [...porPessoa.entries()].map(([k, linhas]) => {
      const primeira = linhas[0];
      const tipo = primeira.membershipId ? ("staff" as const) : ("atleta" as const);
      const nome = primeira.membership?.user.name ?? primeira.athlete?.name ?? "—";
      const detalhe = primeira.membership
        ? primeira.membership.customRole?.name ?? primeira.membership.title ?? null
        : primeira.athlete?.teams[0]?.team.name ?? null;
      const ativo = primeira.membership ? primeira.membership.isActive : primeira.athlete?.status === "ACTIVE";

      /* O período em vigor no mês corrente, se houver. */
      const atual =
        linhas.find((l) => mesDaData(l.startsOn) <= mesAtual && (!l.endsOn || mesDaData(l.endsOn) >= mesAtual)) ?? null;

      const pagos = pagosPorPessoa.get(k) ?? new Map<string, (typeof pagamentos)[number]>();
      const devidos: MesDevido[] = linhas.flatMap((l) => mesesDevidos(l as PeriodoDeVencimento, janela));
      // Dois períodos no mesmo mês (uma correção mal fechada): fica o mais recente.
      const porMes = new Map<string, MesDevido>();
      for (const m of [...devidos].reverse()) porMes.set(m.period, m);
      const meses = [...porMes.values()]
        .sort((a, b) => (a.period < b.period ? -1 : 1))
        .map((m) => {
          const pago = pagos.get(m.period) ?? null;
          const estado: EstadoDoMes = estadoDoMes(m, Boolean(pago), hoje);
          return {
            ...m,
            estado,
            pagamento: pago
              ? { id: pago.id, amountCents: pago.amountCents, occurredAt: pago.occurredAt, method: pago.method }
              : null,
          };
        });

      const ultimoPagamento = [...pagos.values()].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0] ?? null;

      return {
        tipo,
        id: primeira.membershipId ?? primeira.athleteId ?? "",
        nome,
        detalhe,
        ativo,
        atual: atual ? serializeSalario(atual) : null,
        periodos: linhas.map(serializeSalario),
        meses,
        emAtraso: meses.filter((m) => m.estado === "atraso"),
        esteMes: meses.find((m) => m.period === mesAtual) ?? null,
        ultimoPagamento: ultimoPagamento
          ? { id: ultimoPagamento.id, period: ultimoPagamento.salaryPeriod, amountCents: ultimoPagamento.amountCents, occurredAt: ultimoPagamento.occurredAt }
          : null,
      };
    });

    pessoas.sort((a, b) => a.nome.localeCompare(b.nome, "pt"));

    const soma = (ms: { amountCents: number }[]) => ms.reduce((s, m) => s + m.amountCents, 0);
    const comAtual = pessoas.filter((p) => p.atual);
    const esteMes = pessoas.map((p) => p.esteMes).filter((m): m is NonNullable<typeof m> => Boolean(m));
    const pagosEsteMes = esteMes.filter((m) => m.estado === "pago");
    const porPagarEsteMes = esteMes.filter((m) => m.estado === "este-mes");
    const emAtraso = pessoas.flatMap((p) => p.emAtraso);

    return {
      hoje: dataDoDia(hoje),
      mesAtual,
      resumo: {
        pessoas: comAtual.length,
        /** A soma dos vencimentos em vigor: o que o clube paga por mês. */
        folhaMensal: soma(comAtual.map((p) => p.atual!)),
        pagoEsteMes: { n: pagosEsteMes.length, amountCents: soma(pagosEsteMes.map((m) => m.pagamento!)) },
        porPagarEsteMes: { n: porPagarEsteMes.length, amountCents: soma(porPagarEsteMes) },
        emAtraso: { n: emAtraso.length, amountCents: soma(emAtraso) },
      },
      pessoas,
    };
  }

  /**
   * Definir o vencimento de uma pessoa.
   *
   * Se já houver um período em vigor, fecha-se no mês anterior ao novo: "o
   * vencimento subiu em janeiro" fica escrito como dois períodos, e a ficha
   * mostra os dois. Um início no mesmo mês do período em vigor substitui-o
   * (foi um engano, não uma subida).
   */
  async createSalary(ctx: RequestContext, dto: SalaryDto) {
    this.mustWrite(ctx);
    if (Boolean(dto.membershipId) === Boolean(dto.athleteId)) {
      throw new BadRequestException("Escolhe uma pessoa do staff ou um atleta");
    }
    const inicio = primeiroDia(dto.startsOn);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      if (dto.membershipId) {
        const m = await db.membership.findFirst({ where: { id: dto.membershipId }, select: { id: true, role: true } });
        if (!m) throw new NotFoundException("Pessoa não encontrada");
        if (m.role === "GUARDIAN" || m.role === "ATHLETE") throw new BadRequestException("Um vencimento é de alguém do staff ou de um atleta");
      } else {
        const a = await db.athlete.findFirst({ where: { id: dto.athleteId! }, select: { id: true } });
        if (!a) throw new NotFoundException("Atleta não encontrado");
      }

      const quem = dto.membershipId ? { membershipId: dto.membershipId } : { athleteId: dto.athleteId! };
      const mesDoInicio = mesDaData(inicio);

      /* O período em vigor nesse mês, e os que começam depois (um início no passado por cima de outro). */
      const abertos = await db.salary.findMany({
        where: { ...quem, OR: [{ endsOn: null }, { endsOn: { gte: inicio } }] },
        select: { id: true, startsOn: true, endsOn: true },
      });
      for (const s of abertos) {
        if (mesDaData(s.startsOn) >= mesDoInicio) {
          // Começa no mesmo mês ou depois: era um engano — sai, e os pagamentos ficam.
          await db.salary.delete({ where: { id: s.id } });
        } else {
          // Fecha no último dia do mês anterior ao novo.
          await db.salary.update({ where: { id: s.id }, data: { endsOn: ultimoDiaAntes(inicio) } });
        }
      }

      const s = await db.salary.create({
        data: {
          academyId: ctx.academyId,
          ...quem,
          amountCents: dto.amountCents,
          startsOn: inicio,
          payDay: dto.payDay ?? null,
          notes: dto.notes?.trim() || null,
          createdById: ctx.membershipId ?? null,
        },
        select: { id: true },
      });
      return { id: s.id };
    });
  }

  /** Corrigir um período: o valor, as datas, o dia de pagamento, as notas. */
  async updateSalary(ctx: RequestContext, id: string, dto: UpdateSalaryDto) {
    this.mustWrite(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atual = await db.salary.findFirst({ where: { id }, select: { id: true, startsOn: true, endsOn: true } });
      if (!atual) throw new NotFoundException("Vencimento não encontrado");

      const startsOn = dto.startsOn !== undefined ? primeiroDia(dto.startsOn) : atual.startsOn;
      const endsOn = dto.endsOn === undefined ? atual.endsOn : dto.endsOn ? ultimoDia(dto.endsOn) : null;
      if (endsOn && endsOn < startsOn) throw new BadRequestException("O fim tem de ser depois do início");

      await db.salary.update({
        where: { id },
        data: {
          ...(dto.amountCents !== undefined ? { amountCents: dto.amountCents } : {}),
          startsOn,
          endsOn,
          ...(dto.payDay !== undefined ? { payDay: dto.payDay } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        },
      });
      return { ok: true };
    });
  }

  /** Apagar um período. Os meses já pagos ficam nos movimentos, sem ligação. */
  async deleteSalary(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const atual = await db.salary.findFirst({ where: { id }, select: { id: true } });
      if (!atual) throw new NotFoundException("Vencimento não encontrado");
      await db.salary.delete({ where: { id } });
      return { ok: true };
    });
  }

  /**
   * Pagar um mês de um vencimento.
   *
   * É registar uma despesa concluída, com a pessoa ligada e o mês escrito: o
   * saldo, a lista e o gráfico tratam-na como qualquer outra. O mesmo mês não
   * se paga duas vezes — um pagamento cancelado não conta, para o certo poder
   * entrar a seguir.
   */
  async paySalary(ctx: RequestContext, id: string, dto: PaySalaryDto) {
    this.mustWrite(ctx);
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const r = await this.pagarMes(db, ctx, id, dto);
      return { id: r.id, amountCents: r.amountCents };
    });
  }

  /** Pagar o mês a várias pessoas — por omissão, a todas as que ainda não o têm pago. */
  async payMonth(ctx: RequestContext, dto: PayMonthDto) {
    this.mustWrite(ctx);
    if (!periodoValido(dto.period)) throw new BadRequestException("O mês tem de ser AAAA-MM");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const folha = await this.folha(db, partesNoFuso(new Date()));
      const alvo = new Set(dto.salaryIds ?? []);
      const porPagar = folha.pessoas
        .map((p) => p.meses.find((m) => m.period === dto.period && m.estado !== "pago"))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .filter((m) => alvo.size === 0 || alvo.has(m.salaryId));

      const pagos: { id: string; amountCents: number }[] = [];
      for (const m of porPagar) {
        pagos.push(await this.pagarMes(db, ctx, m.salaryId, { period: dto.period, paidOn: dto.paidOn, method: dto.method }));
      }
      return { pagos: pagos.length, amountCents: pagos.reduce((s, p) => s + p.amountCents, 0) };
    });
  }

  private async pagarMes(db: ScopedClient, ctx: RequestContext, salaryId: string, dto: PaySalaryDto) {
    if (!periodoValido(dto.period)) throw new BadRequestException("O mês tem de ser AAAA-MM");

    const s = await db.salary.findFirst({
      where: { id: salaryId },
      select: {
        id: true, membershipId: true, athleteId: true, amountCents: true, startsOn: true, endsOn: true,
        membership: { select: { user: { select: { name: true } } } },
        athlete: { select: { name: true } },
      },
    });
    if (!s) throw new NotFoundException("Vencimento não encontrado");

    const primeiro = mesDaData(s.startsOn);
    const ultimo = s.endsOn ? mesDaData(s.endsOn) : null;
    if (dto.period < primeiro || (ultimo && dto.period > ultimo)) {
      throw new BadRequestException(`Este vencimento não vale para ${nomeDoMes(dto.period)}`);
    }
    const mesAtual = chaveDoMes(new Date());
    if (dto.period > somarMeses(mesAtual, 1)) throw new BadRequestException("Só se paga até ao mês seguinte");

    // Já pago? Pela pessoa e pelo mês, em qualquer período dela.
    const jaPago = await db.financialTransaction.findFirst({
      where: {
        salaryPeriod: dto.period,
        status: { not: "CANCELLED" },
        ...(s.membershipId ? { staffId: s.membershipId } : { athleteId: s.athleteId! }),
      },
      select: { id: true },
    });
    if (jaPago) throw new BadRequestException(`${nomeDoMes(dto.period)} já está pago`);

    const nome = s.membership?.user.name ?? s.athlete?.name ?? "";
    const categoria = await this.categoriaDeVencimentos(db, ctx.academyId);
    const amountCents = dto.amountCents ?? s.amountCents;
    const t = await db.financialTransaction.create({
      data: {
        academyId: ctx.academyId,
        kind: "EXPENSE",
        status: "COMPLETED",
        description: `Vencimento de ${nomeDoMes(dto.period)} · ${nome}`,
        amountCents,
        occurredAt: dto.paidOn ? new Date(dto.paidOn) : new Date(),
        categoryId: categoria,
        method: (dto.method as PaymentMethod) || null,
        counterparty: nome,
        notes: dto.notes?.trim() || null,
        staffId: s.membershipId,
        athleteId: s.athleteId,
        salaryId: s.id,
        salaryPeriod: dto.period,
        createdById: ctx.membershipId ?? null,
      },
      select: { id: true },
    });
    return { id: t.id, amountCents };
  }

  /**
   * A categoria dos pagamentos de vencimentos: a que o clube já tem com esse
   * nome ("Salários e prémios" vem semeada), ou uma nova se a arquivou.
   */
  private async categoriaDeVencimentos(db: ScopedClient, academyId: string): Promise<string> {
    const nomes = ["Salários e prémios", "Salários", "Vencimentos", "Salários e vencimentos"];
    const existente = await db.catalogItem.findFirst({
      where: { kind: "financeExpense", archivedAt: null, label: { in: nomes } },
      select: { id: true },
    });
    if (existente) return existente.id;
    const ultimo = await db.catalogItem.findFirst({ where: { kind: "financeExpense" }, orderBy: { order: "desc" }, select: { order: true } });
    const nova = await db.catalogItem.create({
      data: { academyId, kind: "financeExpense", label: "Salários e prémios", order: (ultimo?.order ?? 0) + 1 },
      select: { id: true },
    });
    return nova.id;
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

/** O que o painel aponta como "precisa de atenção". Só o que existe. */
type Atencao =
  | { tipo: "vencimentos-atraso"; n: number; amountCents: number }
  | { tipo: "vencimentos-mes"; n: number; amountCents: number }
  | { tipo: "previstos-vencidos"; n: number; amountCents: number; receitasCents: number }
  | { tipo: "orcamento"; epoca: string; categorias: { label: string; budgetCents: number; spentCents: number }[] }
  | { tipo: "saldo-projetado"; amountCents: number };

/** Um período de vencimento, como sai para o cliente. */
function serializeSalario(s: {
  id: string; amountCents: number; startsOn: Date; endsOn: Date | null; payDay: number | null; notes: string | null; createdAt: Date;
}) {
  return {
    id: s.id,
    amountCents: s.amountCents,
    startsOn: s.startsOn.toISOString().slice(0, 10),
    endsOn: s.endsOn ? s.endsOn.toISOString().slice(0, 10) : null,
    payDay: s.payDay,
    notes: s.notes,
    createdAt: s.createdAt,
  };
}

/** O dia 1 do mês de uma data `AAAA-MM-DD` (ou ISO), em UTC, como `@db.Date` guarda. */
function primeiroDia(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Data inválida");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

/** O último dia do mês de uma data. */
function ultimoDia(iso: string): Date {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new BadRequestException("Data inválida");
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** O último dia do mês anterior a esta data. */
function ultimoDiaAntes(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
}

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

/** Um treino ligado a um movimento, com o nome com que aparece no calendário. */
function eventoDoTreino(t?: { id: string; startsAt: Date; team: { name: string } } | null): { id: string; title: string } | null {
  if (!t) return null;
  const dia = formatarNoFuso(t.startsAt, { day: "2-digit", month: "2-digit" });
  return { id: t.id, title: `${t.team.name} - Treino ${dia}` };
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
  trainingSession?: { id: string; startsAt: Date; team: { name: string } } | null;
}) {
  return {
    id: t.id,
    description: t.description,
    amountCents: t.amountCents,
    occurredAt: t.occurredAt,
    status: t.status,
    category: t.category?.label ?? null,
    eventLabel: t.match ? `${t.match.isHome ? "vs" : "@"} ${t.match.opponent}` : (t.calendarEvent?.title ?? eventoDoTreino(t.trainingSession)?.title ?? null),
  };
}
