import { ArrayMaxSize, ArrayMinSize, IsArray, IsEmail, IsOptional, IsString, Length, MaxLength, IsBoolean, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

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

  /**
   * O cargo. Substitui o par `role` + `title` + `department` que existia aqui:
   * o cargo já os carrega os três, e o servidor lê-os dele. Ver `CreateInvite`
   * em `invites.service.ts`.
   */
  @IsString()
  @Length(1, 40)
  academyRoleId!: string;

  /**
   * Os cargos secundários, se os houver.
   *
   * Dez chegam e sobram: quem precisa de mais do que isso não tem cargos, tem
   * um clube inteiro numa pessoa — e nesse caso o que falta é um cargo que diga
   * isso, não uma lista mais comprida.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  extraRoleIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  teamIds?: string[];

  /** `false` guarda a pessoa sem enviar o convite. Omitido, envia logo. */
  @IsOptional()
  @IsBoolean()
  enviar?: boolean;
}

/** Enviar vários convites guardados de uma vez. */
export class SendInvitesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  ids!: string[];
}

/** Uma linha da importação de staff: o mesmo que um convite, sem a decisão de enviar. */
export class ImportInviteRowDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Length(1, 40)
  academyRoleId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  teamIds?: string[];
}

export class ImportInvitesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportInviteRowDto)
  rows!: ImportInviteRowDto[];

  /** Mandar já o convite a cada um. Desligado por omissão. */
  @IsOptional()
  @IsBoolean()
  enviar?: boolean;
}

export class AcceptInviteDto {
  @IsString()
  @Length(8, 200)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  /** Aceita os documentos legais em vigor para quem entra por este convite. */
  @IsOptional()
  @IsBoolean()
  acceptLegal?: boolean;

  /** "Confirmo que estou autorizado a representar o clube" — só quando o cargo vincula o clube. */
  @IsOptional()
  @IsBoolean()
  confirmAuthority?: boolean;
}
