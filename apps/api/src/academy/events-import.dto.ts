import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

/**
 * Uma linha da folha do calendário.
 *
 * **Nomes, e não ids.** A folha é escrita por uma pessoa: lá está "Sub-13
 * Futebol" e "Campeonato Distrital", e é o servidor que os resolve. Mandar ids
 * obrigaria o cliente a ser a única coisa capaz de montar o pedido, e um nome
 * por resolver deixaria de ser um erro de linha para passar a ser um pedido
 * mal formado.
 *
 * A data e a hora vão separadas e em texto de relógio (`2026-10-07`, `18:00`),
 * nunca um instante: quem escreve a folha escreve "18:00", e as 18:00 de Março
 * e as de Novembro não são o mesmo instante UTC. A conversão é do servidor, no
 * fuso do clube. Ver `common/fuso.ts`.
 */
export class LinhaDoCalendarioDto {
  @IsInt() @Min(1) @Max(100_000) linha!: number;
  @IsString() @Length(1, 40) folha!: string;

  @IsOptional() @IsIn(["TRAINING", "MATCH", "TOURNAMENT", "OTHER"]) kind?: string;
  @IsOptional() @IsString() @Length(0, 80) team?: string;
  @IsOptional() @IsString() @Length(0, 120) title?: string;

  @IsString() @Length(10, 10) date!: string;
  @IsString() @Length(3, 5) start!: string;
  @IsString() @Length(3, 5) end!: string;

  @IsString() @Length(1, 80) venue!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  dressingRooms?: string[];

  @IsOptional() @IsString() @Length(0, 80) type?: string;
  @IsOptional() @IsString() @Length(0, 80) opponent?: string;
  @IsOptional() @IsBoolean() isHome?: boolean;
  @IsOptional() @IsString() @Length(0, 80) competition?: string;
  @IsOptional() @IsIn(["GUARDIAN", "ATHLETE"]) respondBy?: string;

  /** O último dia da repetição, incluído. Ausente é um evento só. */
  @IsOptional() @IsString() @Length(10, 10) repeatUntil?: string;
  @IsOptional() @IsIn(["DAILY", "WEEKLY", "MONTHLY"]) freq?: string;

  /** 0 é domingo, como `Date.getDay()`. Só no semanal. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];
}

/**
 * O calendário inteiro de uma vez.
 *
 * O tecto de 800 linhas é sobre as **linhas da folha**, não sobre os eventos:
 * uma linha com repetição semanal até Junho é uma linha e são quarenta eventos.
 * O tecto dos eventos vive no serviço, que é quem os conta depois de expandir.
 */
export class ImportarCalendarioDto {
  @IsArray()
  @ArrayMaxSize(800)
  @ValidateNested({ each: true })
  @Type(() => LinhaDoCalendarioDto)
  rows!: LinhaDoCalendarioDto[];

  /**
   * Correr sem escrever nada, para o ecrã poder dizer o que vai acontecer.
   *
   * É o passo que falta a qualquer importação de calendário: os eventos ficam
   * espalhados por doze meses e ninguém os relê, por isso o que se vê antes de
   * confirmar é a única oportunidade de apanhar um engano.
   */
  @IsOptional() @IsBoolean() ensaio?: boolean;
}
