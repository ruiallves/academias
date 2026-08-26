import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Um dia do horário regular de treinos: `{ weekday: 2, start: "17:30", end: "19:00", venue: "Campo 1" }`.
 *
 * Classe decorada e não um objeto solto: sem isto a `ValidationPipe` deixava passar
 * um `weekday: "amanhã"` ou um campo a mais, e o horário é `Json` na base — não há
 * uma segunda barreira de tipos depois desta. As horas são validadas como `HH:MM`
 * para o calendário não ter de adivinhar o formato.
 */
export class ScheduleSlotDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Hora de início inválida (HH:MM)" })
  start!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: "Hora de fim inválida (HH:MM)" })
  end!: string;

  @IsString()
  @Length(1, 80)
  venue!: string;
}

/**
 * O corpo de criação de uma equipa.
 *
 * A **forma** é validada aqui, na fronteira; as **regras** — a modalidade existir, a
 * época resolver-se, o treinador ser desta academia — ficam no serviço, tal como em
 * `athletes.dto.ts`. A época chega como rótulo (`"2026/27"`) e não como id: é assim
 * que o diretor pensa nela, e o serviço encontra-a ou cria-a.
 */
export class CreateTeamDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsString()
  @Length(1, 40)
  sportId!: string;

  /**
   * A idade máxima da equipa: 11 num "Sub-11".
   *
   * Substituiu o escalão em texto. O tecto de 99 não é um número redondo à toa —
   * é o que uma equipa sem limite de idade (seniores) usa, e mantém a coluna
   * como um inteiro sempre presente em vez de um nulo a tratar em cada consulta.
   * O piso de 4 trava o dedo escorregado que transformaria "Sub-2015" — alguém a
   * escrever o ano de nascimento — num limite de idade real.
   */
  @IsInt()
  @Min(4)
  @Max(99)
  maxAge!: number;

  @IsString()
  @Length(4, 20)
  season!: string;

  /** Membership do treinador principal. Opcional — uma equipa pode nascer sem treinador. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  coachId?: string;

  @IsArray()
  @ArrayMaxSize(14)
  @ValidateNested({ each: true })
  @Type(() => ScheduleSlotDto)
  schedule!: ScheduleSlotDto[];
}


/** Uma linha do ficheiro de equipas. A modalidade e a época chegam escritas. */
export class ImportTeamRowDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsString()
  @Length(1, 60)
  sport!: string;

  /** A idade máxima. Ver `CreateTeamDto.maxAge`. */
  @IsInt()
  @Min(4)
  @Max(99)
  maxAge!: number;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  season?: string;
}

/**
 * O ficheiro inteiro.
 *
 * Duzentas linhas é o mesmo tecto da importação de atletas — um clube não tem
 * duzentas equipas, e o limite existe para travar o ficheiro colado por engano.
 */
export class ImportTeamsDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportTeamRowDto)
  rows!: ImportTeamRowDto[];
}
