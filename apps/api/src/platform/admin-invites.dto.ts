import { IsBoolean, IsEmail, IsEnum, IsString, Length, MaxLength } from "class-validator";
import { PlatformRole } from "@prisma/client";

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
