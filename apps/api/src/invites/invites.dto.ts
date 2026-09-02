import { ArrayMaxSize, IsArray, IsEmail, IsOptional, IsString, Length, MaxLength } from "class-validator";

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
