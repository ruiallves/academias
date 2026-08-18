import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Matches,
  ValidateNested,
} from "class-validator";

/**
 * Os corpos de criação e importação de atletas — classes, não interfaces.
 *
 * Sem uma classe decorada, a `ValidationPipe` global não filtra nada e um campo a
 * mais no corpo (`academyId`, `status` escondido) passa inteiro. Ver a auditoria
 * de segurança, VULN-005. Aqui a forma é validada antes de qualquer lógica correr;
 * as regras de negócio — a equipa existir, a data ser plausível — ficam no serviço.
 *
 * ## Porque é que não há encarregado aqui
 *
 * Um encarregado é uma conta (User + Membership + Supabase Auth). Criá-lo por
 * importação seria criar contas sem consentimento. Um atleta importa-se sozinho; a
 * família liga-se depois pelo fluxo de Famílias, que é o que a app existe para
 * fazer. Ver `docs/03-estado.md`.
 */
export class AthleteInputDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  /** ISO `YYYY-MM-DD`. O serviço rejeita datas fora de um intervalo plausível. */
  @IsISO8601()
  birthdate!: string;

  @IsString()
  @Length(1, 40)
  teamId!: string;

  @IsOptional()
  @IsString()
  @Length(1, 40)
  position?: string;

  @IsOptional()
  @IsISO8601()
  medicalValidUntil?: string;

  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(250)
  heightCm?: number;

  @IsOptional()
  @IsInt()
  @Min(200) // 20,0 kg em décimas
  @Max(2000) // 200,0 kg — guardamos em décimas de kg para casar com o Decimal(4,1)
  weightDg?: number;

  @IsOptional()
  @Matches(/^(RIGHT|LEFT|BOTH)$/)
  dominantSide?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  squadNumber?: number;
}

/**
 * A importação em lote.
 *
 * O tecto de 400 linhas por pedido não é arbitrário: é maior do que qualquer
 * academia real de uma vez, e pequeno o suficiente para não deixar um único pedido
 * abrir 400 escritas numa transação sem fim. Uma academia com mais divide em dois
 * ficheiros — que é raro e aceitável.
 */
export class ImportAthletesDto {
  @IsArray()
  @ArrayMaxSize(400)
  @ValidateNested({ each: true })
  @Type(() => AthleteInputDto)
  rows!: AthleteInputDto[];
}
