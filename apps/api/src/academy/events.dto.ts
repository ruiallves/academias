import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

/**
 * Repetir um evento.
 *
 * `weekdays` só se aplica a `WEEKLY`: 0 é domingo, como `Date.getDay()`. Vazio
 * ou ausente repete no mesmo dia da semana do primeiro evento.
 *
 * Não há "de duas em duas semanas" nem "última sexta do mês": são as duas regras
 * que quase ninguém usa e que dobram a complexidade de um gerador de datas. Ver
 * `occurrences` em `academy.service.ts`.
 */
export class RepeatDto {
  @IsIn(["DAILY", "WEEKLY", "MONTHLY"])
  freq!: "DAILY" | "WEEKLY" | "MONTHLY";

  /** O último dia da série, inclusive. */
  @IsISO8601()
  until!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  weekdays?: number[];
}

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

  /*
     O erro deste campo chega ao ecrã tal e qual — por isso é escrito para se
     ler, e em português. "venue must be longer than or equal to 1 characters"
     por cima de um formulário com o local visivelmente escolhido não ajuda
     ninguém a perceber o que fazer a seguir.
  */
  @IsString()
  @Length(1, 80, { message: "Escolhe o local do evento" })
  venue!: string;

  /**
   * O balneário. **Substituído por `dressingRooms`.**
   *
   * Fica a ser aceite enquanto houver clientes antigos em serviço a mandá-lo —
   * o serviço junta-o à lista. Ver a migração `20260908120000`.
   */
  @IsOptional()
  @IsString()
  @Length(0, 80)
  dressingRoom?: string;

  /**
   * Os balneários — nenhum, um, ou vários.
   *
   * Um clube que leve duas equipas ao mesmo jogo usa dois balneários, e antes
   * só podia dizer um. O tecto de 12 é o de um pavilhão grande; acima disso é
   * engano de quem clicou.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @Length(1, 80, { each: true })
  dressingRooms?: string[];

  /**
   * O tipo escolhido no catálogo "Tipos de evento" das Definições.
   *
   * O `kind` continua a decidir a **estrutura** (que tabela, que ecrãs abre);
   * isto guarda o **vocabulário do clube** — "Estágio", "Reunião de pais". O
   * servidor confirma que o id é mesmo de um tipo de evento por arquivar, e
   * ignora-o num treino ou num jogo, que vivem em tabelas próprias e já dizem
   * o que são.
   */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  typeId?: string;

  /**
   * Repetir. Ausente é um evento só.
   *
   * Cada ocorrência é criada como uma linha própria — ver `createEvent`. Um
   * treino repetido abre uma folha de presenças por dia, e desmarcar um dia não
   * mexe nos outros.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => RepeatDto)
  repeat?: RepeatDto;

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

  /** A prova deste jogo, das que a equipa disputa. Só faz sentido em `MATCH`. */
  @IsOptional()
  @IsString()
  @Length(1, 40)
  competitionId?: string;
}

/** Por agora só se cancela e reativa — a edição de um evento vem depois. */
export class UpdateEventDto {
  @IsBoolean()
  cancelled!: boolean;
}

/**
 * Uma falta na folha de presenças.
 *
 * `present` não é um valor possível: a presença é a **ausência** de marca, e é
 * isso que faz a folha de um treino guardar duas linhas em vez de dezoito. O
 * motivo só acompanha a justificada — o serviço deita fora o resto, para não
 * ficar um texto órfão preso a um estado que já não o explica.
 */
export class AbsenceDto {
  @IsString()
  @Length(1, 40)
  athleteId!: string;

  @IsIn(["absent", "justified", "late"])
  kind!: "absent" | "justified" | "late";

  @IsOptional()
  @IsString()
  @Length(0, 200)
  note?: string;
}

/**
 * A folha de presenças de um treino, inteira.
 *
 * Uma lista vazia é uma afirmação — *estiveram todos* — e não um corpo por
 * preencher: é diferente de nunca ter sido registada, que é o que a ausência de
 * `attendanceClosedAt` diz. É a distinção que impede um treino por verificar de
 * inflacionar a assiduidade de toda a gente.
 *
 * O tecto de 60 é o plantel mais generoso que faz sentido num treino; acima
 * disso é engano ou abuso, e recusa-se aqui em vez de escrever sessenta linhas.
 */
export class AttendanceDto {
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AbsenceDto)
  absences!: AbsenceDto[];
}

/**
 * Editar um evento que já existe.
 *
 * **Sem `kind` e sem `teamId`**, de propósito: o tipo decide em que tabela o
 * evento vive e a equipa decide de quem ele é. Mudar qualquer um deles não é
 * editar — é apagar e criar outro, com outra folha de presenças e outra
 * convocatória. Aqui muda-se o quando, o onde, e o que é próprio de cada tipo.
 *
 * Tudo opcional: a interface manda o que o formulário mexeu, e o que não vier
 * fica como está.
 */
export class EditEventDto {
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsString() @Length(1, 120, { message: "Escolhe o local do evento" }) venue?: string;
  /** String vazia limpa o balneário — é como se diz "nenhum". */
  @IsOptional() @IsString() @Length(0, 80) dressingRoom?: string;
  /** Lista vazia tira todos os balneários. Ver `CreateEventDto.dressingRooms`. */
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 80, { each: true }) dressingRooms?: string[];
  /** String vazia tira o tipo. Ver `CreateEventDto.typeId`. */
  @IsOptional() @IsString() @Length(0, 40) typeId?: string;
  @IsOptional() @IsString() @Length(1, 80) opponent?: string;
  @IsOptional() @IsBoolean() isHome?: boolean;
  @IsOptional() @IsString() @Length(1, 40) competitionId?: string;
}
