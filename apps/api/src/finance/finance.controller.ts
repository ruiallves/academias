import { Body, Controller, Delete, Get, Patch, Post, Put, Query, Param, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { FinanceService } from "./finance.service";
import {
  BudgetDto,
  CopyBudgetDto,
  CreateTransactionDto,
  DeleteTransactionDto,
  PayMonthDto,
  PaySalaryDto,
  SalaryDto,
  SettingsDto,
  UpdateSalaryDto,
  UpdateTransactionDto,
} from "./finance.dto";

/**
 * Contas. As permissões vivem no serviço, como em todo o produto — o
 * controlador só traduz HTTP.
 */
@Controller("api/finance")
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("overview")
  overview(@Req() req: AuthedRequest, @Query("horizon") horizon?: string, @Query("meses") meses?: string) {
    const dias = Number(horizon);
    const n = Number(meses);
    return this.finance.overview(
      req.ctx,
      Number.isFinite(dias) && dias >= 7 && dias <= 365 ? dias : 30,
      n === 12 || n === 24 ? n : 6,
    );
  }

  /* --------------------------------------------------------- vencimentos --- */

  /** A folha: toda a gente com vencimento, o que está pago e o que falta. */
  @Get("salaries")
  salaries(@Req() req: AuthedRequest, @Query("membershipId") membershipId?: string, @Query("athleteId") athleteId?: string) {
    return this.finance.salaries(req.ctx, { membershipId: membershipId || undefined, athleteId: athleteId || undefined });
  }

  @Post("salaries")
  createSalary(@Req() req: AuthedRequest, @Body() dto: SalaryDto) {
    return this.finance.createSalary(req.ctx, dto);
  }

  /** Pagar o mês a toda a gente (ou aos escolhidos) de uma vez. */
  @Post("salaries/pagar-mes")
  payMonth(@Req() req: AuthedRequest, @Body() dto: PayMonthDto) {
    return this.finance.payMonth(req.ctx, dto);
  }

  @Patch("salaries/:id")
  updateSalary(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateSalaryDto) {
    return this.finance.updateSalary(req.ctx, id, dto);
  }

  @Delete("salaries/:id")
  deleteSalary(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.finance.deleteSalary(req.ctx, id);
  }

  /** Pagar um mês deste vencimento: nasce uma despesa concluída ligada à pessoa. */
  @Post("salaries/:id/pagar")
  paySalary(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: PaySalaryDto) {
    return this.finance.paySalary(req.ctx, id, dto);
  }

  @Get("transactions")
  transactions(
    @Req() req: AuthedRequest,
    @Query("kind") kind?: string,
    @Query("status") status?: string,
    @Query("categoryId") categoryId?: string,
    @Query("q") q?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("matchId") matchId?: string,
    @Query("calendarEventId") calendarEventId?: string,
    @Query("trainingSessionId") trainingSessionId?: string,
    @Query("athleteId") athleteId?: string,
    @Query("teamId") teamId?: string,
  ) {
    return this.finance.transactions(req.ctx, { kind, status, categoryId, q, from, to, matchId, calendarEventId, trainingSessionId, athleteId, teamId });
  }

  @Post("transactions")
  create(@Req() req: AuthedRequest, @Body() dto: CreateTransactionDto) {
    return this.finance.createTransaction(req.ctx, dto);
  }

  /** Editar, confirmar um previsto, ou cancelar. */
  @Patch("transactions/:id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: UpdateTransactionDto) {
    return this.finance.updateTransaction(req.ctx, id, dto);
  }

  /**
   * Apagar o que nunca devia ter sido lançado.
   *
   * À parte de cancelar de propósito — cancelar conta uma história, apagar
   * admite um engano. Ver a regra 3 no cabeçalho do serviço. O `scope` vai no
   * corpo (um DELETE com corpo é legal em HTTP) para não pendurar a decisão na
   * query, onde ficaria escrita nos registos do servidor.
   */
  @Delete("transactions/:id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: DeleteTransactionDto) {
    return this.finance.deleteTransaction(req.ctx, id, dto ?? {});
  }

  @Get("settings")
  settings(@Req() req: AuthedRequest) {
    return this.finance.settings(req.ctx);
  }

  @Put("settings")
  updateSettings(@Req() req: AuthedRequest, @Body() dto: SettingsDto) {
    return this.finance.updateSettings(req.ctx, dto);
  }

  @Get("budgets")
  budgets(@Req() req: AuthedRequest, @Query("seasonId") seasonId?: string) {
    return this.finance.budgets(req.ctx, seasonId);
  }

  /** O orçamento de todas as épocas, em totais: o planeado contra o gasto. */
  @Get("budgets/historico")
  budgetHistory(@Req() req: AuthedRequest) {
    return this.finance.historicoDoOrcamento(req.ctx);
  }

  /** Começar uma época com o orçamento de outra — só as categorias ainda sem valor. */
  @Post("budgets/copiar")
  copyBudget(@Req() req: AuthedRequest, @Body() dto: CopyBudgetDto) {
    return this.finance.copiarOrcamento(req.ctx, dto.fromSeasonId, dto.toSeasonId);
  }

  @Put("budgets")
  setBudget(@Req() req: AuthedRequest, @Body() dto: BudgetDto) {
    return this.finance.setBudget(req.ctx, dto);
  }
}
