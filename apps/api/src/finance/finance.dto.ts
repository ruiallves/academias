import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min, ValidateIf } from "class-validator";

/**
 * Os corpos das Contas.
 *
 * Dinheiro em **cêntimos inteiros**, como em todo o produto — um float que soma
 * 0.1+0.2 não fecha uma conta. E sempre positivo: o sentido está no tipo do
 * movimento, nunca no sinal.
 */

const KINDS = ["INCOME", "EXPENSE"] as const;
const STATUSES = ["PLANNED", "PENDING", "COMPLETED", "CANCELLED"] as const;
const METHODS = ["MBWAY", "MULTIBANCO", "CARD", "TRANSFER", "CASH"] as const;

export class CreateTransactionDto {
  @IsIn(KINDS as unknown as string[]) kind!: string;
  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;

  @IsString() @Length(2, 200) description!: string;
  @IsInt() @Min(1) @Max(1_000_000_000) amountCents!: number;
  @IsISO8601() occurredAt!: string;
  @IsOptional() @ValidateIf((o: CreateTransactionDto) => o.dueDate !== "") @IsISO8601() dueDate?: string;

  @IsOptional() @IsString() @Length(0, 40) categoryId?: string;
  @IsOptional() @IsIn(METHODS as unknown as string[]) method?: string;
  @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;

  @IsOptional() @IsString() @Length(0, 40) athleteId?: string;
  @IsOptional() @IsString() @Length(0, 40) memberId?: string;
  @IsOptional() @IsString() @Length(0, 40) teamId?: string;
  @IsOptional() @IsString() @Length(0, 40) staffId?: string;
  @IsOptional() @IsString() @Length(0, 40) matchId?: string;
  @IsOptional() @IsString() @Length(0, 40) calendarEventId?: string;

  /**
   * A repetição: fixa, mensal, de `occurredAt` até `repeatUntil`.
   *
   * Uma despesa fixa é o caso normal de um clube — a renda, o seguro, o
   * contrato do material. Fica só o mensal: semanal e anual não aparecem numa
   * conta de clube, e uma opção que ninguém escolhe é uma pergunta a mais no
   * formulário.
   */
  @IsOptional() @IsBoolean() repeatMonthly?: boolean;
  @IsOptional() @ValidateIf((o: CreateTransactionDto) => o.repeatUntil !== "") @IsISO8601() repeatUntil?: string;
}

/**
 * Editar. Tudo opcional; vazio limpa, ausente não mexe — a regra da casa.
 *
 * O `kind` não se edita: uma despesa que vira receita não é uma correcção, é
 * outro movimento. Cancela-se um e regista-se o outro, e o histórico conta a
 * história verdadeira.
 */
export class UpdateTransactionDto {
  /**
   * `series` estende a alteração aos meses seguintes da mesma série fixa —
   * "a renda subiu", "o contrato acabou". Nunca toca no que já aconteceu: um
   * mês concluído ou cancelado é história, e história não se reescreve.
   */
  @IsOptional() @IsIn(["one", "series"]) scope?: string;

  @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
  @IsOptional() @IsString() @Length(2, 200) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000_000) amountCents?: number;
  @IsOptional() @IsISO8601() occurredAt?: string;
  @IsOptional() @ValidateIf((o: UpdateTransactionDto) => o.dueDate !== "") @IsISO8601() dueDate?: string;
  @IsOptional() @IsString() @Length(0, 40) categoryId?: string;
  @IsOptional() @ValidateIf((o: UpdateTransactionDto) => o.method !== "") @IsIn(METHODS as unknown as string[]) method?: string;
  @IsOptional() @IsString() @Length(0, 120) counterparty?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
  @IsOptional() @IsString() @Length(0, 40) athleteId?: string;
  @IsOptional() @IsString() @Length(0, 40) teamId?: string;
}

/** O ponto de partida do saldo, e o que conta para ele. */
export class SettingsDto {
  @IsOptional() @IsInt() @Min(-1_000_000_000) @Max(1_000_000_000) initialBalanceCents?: number;
  @IsOptional() @ValidateIf((o: SettingsDto) => o.initialBalanceAt !== "") @IsISO8601() initialBalanceAt?: string;
  @IsOptional() @IsBoolean() includeFees?: boolean;
  @IsOptional() @IsBoolean() includeQuotas?: boolean;
}

/** Um orçamento: categoria + época + tecto. Zero apaga a linha. */
export class BudgetDto {
  @IsString() @Length(1, 40) seasonId!: string;
  @IsString() @Length(1, 40) categoryId!: string;
  @IsInt() @Min(0) @Max(1_000_000_000) amountCents!: number;
}
