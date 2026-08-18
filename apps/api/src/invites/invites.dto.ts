import { ArrayMaxSize, IsArray, IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength } from "class-validator";
import { Role, StaffDepartment } from "@prisma/client";

/**
 * Os corpos dos pedidos de convite, como **classes** e não interfaces.
 *
 * A `ValidationPipe` global tem `whitelist: true, forbidNonWhitelisted: true` — mas
 * isso só funciona com classes decoradas. Uma interface TypeScript não existe em
 * runtime: a pipe não tem metadados, e o objecto passa inteiro. Convertê-las em
 * classes fecha o mass-assignment estruturalmente — qualquer campo a mais no corpo
 * (`academyId`, `role` escondido, `grants`) é **rejeitado**, não silenciosamente
 * ignorado.
 *
 * Os validadores não substituem as regras de negócio (o RANK do papel, a
 * elegibilidade do atleta) — essas continuam no serviço. Isto é a primeira porta:
 * garante que o que chega tem a forma certa antes de qualquer lógica correr.
 */
export class CreateInviteDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsEnum(Role)
  role!: Role;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsEnum(StaffDepartment)
  department?: StaffDepartment;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  teamIds?: string[];
}

export class AcceptInviteDto {
  @IsString()
  @Length(8, 200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
}
