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
  @IsOptional() @IsString() @Length(0, 40) trainingSessionId?: string;

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

/**
 * Apagar um movimento.
 *
 * Existe ao lado de cancelar porque são coisas diferentes, e confundi-las
 * estraga as contas nos dois sentidos:
 *
 * - **Cancelar** é "estava previsto e não se concretizou" — o autocarro que se
 *   desmarcou. Aconteceu na vida do clube, e por isso fica no histórico,
 *   riscado, com quem lhe mexeu.
 * - **Apagar** é "isto nunca devia ter existido" — a linha lançada a dobrar, o
 *   engano de quem estava a aprender a usar o produto. Deixá-la riscada para
 *   sempre é sujar o extracto com uma coisa que não é história de nada.
 *
 * `series` estende a "este e os meses seguintes", como no editar — para quem
 * criou uma série de trinta e seis meses por engano não ter de apagar trinta e
 * seis linhas à mão.
 */
export class DeleteTransactionDto {
  @IsOptional() @IsIn(["one", "series"]) scope?: string;
}

/** O ponto de partida do saldo, e o que conta para ele. */
export class SettingsDto {
  @IsOptional() @IsInt() @Min(-1_000_000_000) @Max(1_000_000_000) initialBalanceCents?: number;
  @IsOptional() @ValidateIf((o: SettingsDto) => o.initialBalanceAt !== "") @IsISO8601() initialBalanceAt?: string;
  @IsOptional() @IsBoolean() includeFees?: boolean;
  @IsOptional() @IsBoolean() includeQuotas?: boolean;
}

/** Um orçamento: categoria + época + tecto. Zero apaga a linha. */
/** Copiar o orçamento de uma época para outra. Ver `copiarOrcamento`. */
export class CopyBudgetDto {
  @IsString() @Length(1, 40) fromSeasonId!: string;
  @IsString() @Length(1, 40) toSeasonId!: string;
}

export class BudgetDto {
  @IsString() @Length(1, 40) seasonId!: string;
  @IsString() @Length(1, 40) categoryId!: string;
  @IsInt() @Min(0) @Max(1_000_000_000) amountCents!: number;
}

/* -------------------------------------------------------------------------- */
/* Vencimentos                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Definir o vencimento de uma pessoa — alguém do staff (`membershipId`) ou um
 * atleta (`athleteId`), nunca os dois.
 *
 * `startsOn` é o primeiro mês em que vale: aceita-se qualquer dia e guarda-se
 * o dia 1. Se já houver um vencimento em vigor, fecha-se no mês anterior a
 * este: é a maneira de dizer "subiu em janeiro" sem apagar o que valia antes.
 */
export class SalaryDto {
  @IsOptional() @IsString() @Length(1, 40) membershipId?: string;
  @IsOptional() @IsString() @Length(1, 40) athleteId?: string;
  @IsInt() @Min(1) @Max(100_000_000) amountCents!: number;
  @IsISO8601() startsOn!: string;
  /** 1–28; ausente ou vazio = o último dia do mês. */
  @IsOptional() @ValidateIf((o: SalaryDto) => o.payDay !== null) @IsInt() @Min(1) @Max(28) payDay?: number | null;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

/** Corrigir um período já escrito. Tudo opcional; `endsOn` vazio volta a "em vigor". */
export class UpdateSalaryDto {
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) amountCents?: number;
  @IsOptional() @IsISO8601() startsOn?: string;
  @IsOptional() @ValidateIf((o: UpdateSalaryDto) => o.endsOn !== "" && o.endsOn !== null) @IsISO8601() endsOn?: string | null;
  @IsOptional() @ValidateIf((o: UpdateSalaryDto) => o.payDay !== null) @IsInt() @Min(1) @Max(28) payDay?: number | null;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

/**
 * Pagar um mês de um vencimento. O mês é `AAAA-MM`; o valor, quando vem, é o
 * que de facto se pagou (um prémio, um mês incompleto) e vence o do contrato.
 */
export class PaySalaryDto {
  @IsString() @Length(7, 7) period!: string;
  @IsOptional() @ValidateIf((o: PaySalaryDto) => o.paidOn !== "") @IsISO8601() paidOn?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) amountCents?: number;
  @IsOptional() @ValidateIf((o: PaySalaryDto) => o.method !== "") @IsIn(METHODS as unknown as string[]) method?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

/** Pagar o mês a várias pessoas de uma vez: só as que ainda não o têm pago. */
export class PayMonthDto {
  @IsString() @Length(7, 7) period!: string;
  @IsOptional() @IsString({ each: true }) salaryIds?: string[];
  @IsOptional() @ValidateIf((o: PayMonthDto) => o.paidOn !== "") @IsISO8601() paidOn?: string;
  @IsOptional() @ValidateIf((o: PayMonthDto) => o.method !== "") @IsIn(METHODS as unknown as string[]) method?: string;
}
