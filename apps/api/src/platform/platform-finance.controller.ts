import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsBoolean, IsEnum, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { PlatformFinanceKind, PlatformFinanceStatus, PlatformRecurrence } from "@prisma/client";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { PlatformFinanceService } from "./platform-finance.service";
import { PlatformService } from "./platform.service";

/** O corpo de um movimento. O valor vem em cêntimos, como todo o dinheiro do produto. */
class TransactionDto {
  @IsEnum(PlatformFinanceKind) kind!: PlatformFinanceKind;
  @IsOptional() @IsEnum(PlatformFinanceStatus) status?: PlatformFinanceStatus;
  @IsString() @Length(2, 200) description!: string;
  @IsInt() @Min(1) @Max(100_000_000) amountCents!: number;
  @IsOptional() @IsIn([0, 6, 13, 23]) vatRate?: number;
  @IsISO8601() occurredAt!: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsString() @Length(0, 60) category?: string;
  @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @IsOptional() @IsString() @Length(0, 40) academyId?: string;
}

class TransactionPatchDto {
  @IsOptional() @IsEnum(PlatformFinanceStatus) status?: PlatformFinanceStatus;
  @IsOptional() @IsString() @Length(2, 200) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) amountCents?: number;
  @IsOptional() @IsIn([0, 6, 13, 23]) vatRate?: number;
  @IsOptional() @IsISO8601() occurredAt?: string;
  @IsOptional() @IsISO8601() dueDate?: string;
  @IsOptional() @IsString() @Length(0, 60) category?: string;
  @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @IsOptional() @IsString() @Length(0, 40) academyId?: string;
}

class RecurringDto {
  @IsString() @Length(2, 200) description!: string;
  @IsInt() @Min(1) @Max(100_000_000) amountCents!: number;
  @IsOptional() @IsIn([0, 6, 13, 23]) vatRate?: number;
  @IsEnum(PlatformRecurrence) recurrence!: PlatformRecurrence;
  @IsOptional() @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsString() @Length(0, 60) category?: string;
  @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @IsISO8601() startsOn!: string;
  @IsOptional() @IsISO8601() endsOn?: string;
}

class RecurringPatchDto {
  @IsOptional() @IsString() @Length(2, 200) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) amountCents?: number;
  @IsOptional() @IsIn([0, 6, 13, 23]) vatRate?: number;
  @IsOptional() @IsEnum(PlatformRecurrence) recurrence?: PlatformRecurrence;
  @IsOptional() @IsInt() @Min(1) @Max(28) dayOfMonth?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @IsString() @Length(0, 60) category?: string;
  @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @IsOptional() @IsISO8601() startsOn?: string;
  @IsOptional() @IsISO8601() endsOn?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class SettingsDto {
  @IsOptional() @IsInt() @Min(-100_000_000) @Max(100_000_000) openingBalanceCents?: number;
  @IsOptional() @IsISO8601() openingBalanceAt?: string;
  @IsOptional() @IsIn([0, 6, 13, 23]) subscriptionVatRate?: number;
  @IsOptional() @IsBoolean() subscriptionVatIncluded?: boolean;
}

class PagoDto {
  @IsOptional() @IsISO8601() paidAt?: string;
  @IsOptional() @IsString() @Length(0, 300) note?: string;
}

/**
 * As contas do negócio, no painel da plataforma.
 *
 * `OWNER` e `ADMIN`, como a faturação: quem dá apoio (`SUPPORT`) acompanha
 * clubes e não vê quanto é que a empresa ganha ou gasta. É a mesma fronteira de
 * `academies` e de `billing/emitir`.
 *
 * Cada gesto que mexe em dinheiro fica no registo de auditoria: estas contas são
 * a fonte do que se declara, e um lançamento sem autor é um lançamento que
 * ninguém explica seis meses depois.
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform/contas")
@PlatformRoles("OWNER", "ADMIN")
export class PlatformFinanceController {
  constructor(
    private readonly contas: PlatformFinanceService,
    private readonly platform: PlatformService,
  ) {}

  /* ------------------------------------------------------------------ leituras */

  @Get("resumo")
  resumo() {
    return this.contas.resumo();
  }

  @Get("previsao")
  previsao(
    @Query("meses") meses?: string,
    @Query("novosPorMes") novosPorMes?: string,
    @Query("valorNovoCents") valorNovoCents?: string,
  ) {
    return this.contas.previsao({
      meses: Number(meses) || undefined,
      novosPorMes: Number(novosPorMes) || undefined,
      valorNovoCents: Number(valorNovoCents) || undefined,
    });
  }

  @Get("movimentos")
  movimentos(
    @Query("de") de?: string,
    @Query("ate") ate?: string,
    @Query("tipo") tipo?: string,
    @Query("limite") limite?: string,
  ) {
    return this.contas.listTransactions({
      from: de,
      to: ate,
      kind: tipo === "INCOME" || tipo === "EXPENSE" ? (tipo as PlatformFinanceKind) : undefined,
      limit: Number(limite) || undefined,
    });
  }

  @Get("fixos")
  fixos() {
    return this.contas.listRecurring();
  }

  @Get("mensalidades")
  mensalidades(@Query("estado") estado?: string, @Query("limite") limite?: string) {
    const e = estado === "por-pagar" || estado === "pagos" ? estado : "todos";
    return this.contas.listNotices({ estado: e, limit: Number(limite) || undefined });
  }

  @Get("definicoes")
  definicoes() {
    return this.contas.settings();
  }

  /* ------------------------------------------------------------------ escritas */

  @Post("movimentos")
  async criar(@Req() req: PlatformRequest, @Body() dto: TransactionDto) {
    const t = await this.contas.createTransaction(req.admin.id, dto);
    await this.platform.audit(req.admin, "finance.transaction", "transaction", t.id, {
      kind: t.kind,
      cents: t.amountCents,
      descricao: t.description,
    });
    return t;
  }

  @Patch("movimentos/:id")
  async editar(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: TransactionPatchDto) {
    const t = await this.contas.updateTransaction(id, dto as Record<string, unknown>);
    await this.platform.audit(req.admin, "finance.transaction.edit", "transaction", id, { cents: t.amountCents });
    return t;
  }

  @Delete("movimentos/:id")
  async apagar(@Req() req: PlatformRequest, @Param("id") id: string) {
    const r = await this.contas.deleteTransaction(id);
    await this.platform.audit(req.admin, "finance.transaction.delete", "transaction", id);
    return r;
  }

  @Post("fixos")
  async criarFixo(@Req() req: PlatformRequest, @Body() dto: RecurringDto) {
    const f = await this.contas.createRecurring(dto);
    await this.platform.audit(req.admin, "finance.recurring", "recurring", f.id, {
      descricao: f.description,
      cents: f.amountCents,
      periodicidade: f.recurrence,
    });
    return f;
  }

  @Patch("fixos/:id")
  async editarFixo(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: RecurringPatchDto) {
    const f = await this.contas.updateRecurring(id, dto as Record<string, unknown>);
    await this.platform.audit(req.admin, "finance.recurring.edit", "recurring", id);
    return f;
  }

  @Delete("fixos/:id")
  async apagarFixo(@Req() req: PlatformRequest, @Param("id") id: string) {
    const r = await this.contas.deleteRecurring(id);
    await this.platform.audit(req.admin, "finance.recurring.delete", "recurring", id);
    return r;
  }

  /** Lançar no livro um gasto fixo deste mês, sem o reescrever. */
  @Post("fixos/:id/lancar")
  async lancarFixo(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: { occurredAt?: string }) {
    const t = await this.contas.lancarRecorrente(req.admin.id, id, dto?.occurredAt);
    await this.platform.audit(req.admin, "finance.recurring.post", "transaction", t.id, { fixo: id });
    return t;
  }

  @Post("mensalidades/:id/pago")
  async marcarPago(@Req() req: PlatformRequest, @Param("id") id: string, @Body() dto: PagoDto) {
    const r = await this.contas.marcarNoticePaga(req.admin.id, id, dto ?? {});
    await this.platform.audit(req.admin, "finance.notice.paid", "notice", id);
    return r;
  }

  @Delete("mensalidades/:id/pago")
  async desmarcarPago(@Req() req: PlatformRequest, @Param("id") id: string) {
    const r = await this.contas.desmarcarNotice(id);
    await this.platform.audit(req.admin, "finance.notice.unpaid", "notice", id);
    return r;
  }

  @Patch("definicoes")
  async guardarDefinicoes(@Req() req: PlatformRequest, @Body() dto: SettingsDto) {
    const s = await this.contas.saveSettings(dto);
    await this.platform.audit(req.admin, "finance.settings", "settings", s.id, { ...dto });
    return s;
  }
}
