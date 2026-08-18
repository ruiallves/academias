import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, Length } from "class-validator";

/**
 * Os corpos de criação e alteração de um evento do calendário.
 *
 * A **forma** é validada aqui; as **regras** — a equipa estar no âmbito de quem
 * cria, "toda a academia" só para a direção, o fim ser depois do início — ficam no
 * serviço, como em `athletes.dto.ts` e `teams.dto.ts`. O tipo chega em maiúsculas,
 * como o enum da base (`CalendarEventKind`); a consola faz a tradução para as suas
 * etiquetas.
 */
const KINDS = ["TRAINING", "MATCH", "TOURNAMENT", "OTHER"] as const;

export class CreateEventDto {
  @IsIn(KINDS)
  kind!: string;

  /** Ausente é "toda a academia". Só a direção o pode fazer — verificado no serviço. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  teamId?: string;

  @IsString()
  @Length(1, 120)
  title!: string;

  @IsISO8601()
  startsAt!: string;

  @IsISO8601()
  endsAt!: string;

  @IsString()
  @Length(1, 80)
  venue!: string;
}

/** Por agora só se cancela e reativa — a edição de um evento vem depois. */
export class UpdateEventDto {
  @IsBoolean()
  cancelled!: boolean;
}
