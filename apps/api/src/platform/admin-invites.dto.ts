import { Type } from "class-transformer";
import { IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { PlatformRole, SalesPayModel } from "@prisma/client";

/** Como vai receber um comercial. Os mesmos limites de Mês → Condições. */
export class CondicoesDoConviteDto {
  @IsEnum(SalesPayModel)
  payModel!: SalesPayModel;

  @IsInt() @Min(0) @Max(100_00)
  hourlyCents!: number;

  @IsInt() @Min(1) @Max(100)
  meetingsPerCommission!: number;

  @IsInt() @Min(0) @Max(10_000_00)
  commissionCents!: number;

  @IsInt() @Min(1) @Max(100)
  weeklyGoal!: number;
}

/**
 * Classes e não interfaces — a `ValidationPipe` global (`whitelist: true,
 * forbidNonWhitelisted: true`) só fecha mass-assignment com metadados de
 * decoradores, que uma interface não tem em runtime. Ver o cabeçalho de
 * `invites.dto.ts`, que é o mesmo raciocínio.
 */
export class InviteAdminDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsEnum(PlatformRole)
  role!: PlatformRole;

  /** Só no papel Comercial; nos outros papéis é ignorado. */
  @IsOptional() @ValidateNested() @Type(() => CondicoesDoConviteDto)
  compensation?: CondicoesDoConviteDto;
}

export class RedeemAdminInviteDto {
  @IsString()
  @Length(8, 200)
  password!: string;
}

export class SetAdminActiveDto {
  @IsBoolean()
  active!: boolean;
}

export class SetAdminRoleDto {
  @IsEnum(PlatformRole)
  role!: PlatformRole;
}
