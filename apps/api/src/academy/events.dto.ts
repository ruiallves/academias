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

  /**
   * O balneário.
   *
   * Opcional: uma academia que treina num campo sem balneários atribuídos não tem
   * nada para preencher, e obrigá-la a inventar um seria pior do que o campo
   * vazio. Quem os gere é que ganha com ele.
   */
  @IsOptional()
  @IsString()
  @Length(0, 80)
  dressingRoom?: string;

  /**
   * Só para `kind: "MATCH"`.
   *
   * Um jogo não é um evento genérico: tem adversário, tem convocatória e acaba com
   * um resultado. Por isso um evento com este `kind` é gravado como `Match` — a
   * tabela rica — e não como `CalendarEvent`, e é isso que o faz aparecer no ecrã
   * de Convocatórias. O adversário é o mínimo que distingue um jogo de um treino,
   * e o serviço exige-o quando o tipo é jogo.
   */
  @IsOptional()
  @IsString()
  @Length(1, 80)
  opponent?: string;

  /** Só para `kind: "MATCH"`. Em casa por omissão — é o caso mais frequente. */
  @IsOptional()
  @IsBoolean()
  isHome?: boolean;
}

/** Por agora só se cancela e reativa — a edição de um evento vem depois. */
export class UpdateEventDto {
  @IsBoolean()
  cancelled!: boolean;
}
