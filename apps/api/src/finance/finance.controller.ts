import { Body, Controller, Delete, Get, Patch, Post, Put, Query, Param, Req } from "@nestjs/common";
import type { AuthedRequest } from "../auth/auth.guard";
import { FinanceService } from "./finance.service";
import { BudgetDto, CreateTransactionDto, DeleteTransactionDto, SettingsDto, UpdateTransactionDto } from "./finance.dto";

/**
 * Contas. As permissões vivem no serviço, como em todo o produto — o
 * controlador só traduz HTTP.
 */
@Controller("api/finance")
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  @Get("overview")
  overview(@Req() req: AuthedRequest, @Query("horizon") horizon?: string) {
    const dias = Number(horizon);
    return this.finance.overview(req.ctx, Number.isFinite(dias) && dias >= 7 && dias <= 365 ? dias : 30);
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
    @Query("athleteId") athleteId?: string,
    @Query("teamId") teamId?: string,
  ) {
    return this.finance.transactions(req.ctx, { kind, status, categoryId, q, from, to, matchId, calendarEventId, athleteId, teamId });
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

  @Put("budgets")
  setBudget(@Req() req: AuthedRequest, @Body() dto: BudgetDto) {
    return this.finance.setBudget(req.ctx, dto);
  }
}
