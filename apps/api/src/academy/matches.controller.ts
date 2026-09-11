import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import type { AuthedRequest } from "../auth/auth.guard";
import { MatchesService } from "./matches.service";

/**
 * Corpos validados. Classes e não interfaces — ver `invites.dto.ts` para o porquê.
 */
class SaveCallUpsDto {
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  athleteIds!: string[];
}

/**
 * A logística perguntada ao submeter. Tudo opcional — ver `CallUpLogistics`.
 */
class SubmitCallUpsDto {
  @IsOptional() @IsString() @Length(0, 80)
  roundLabel?: string;

  @IsOptional() @IsString() @Length(0, 160)
  meetingPoint?: string;

  /** `HH:MM`. A data é a do jogo — ver `horaNoDia` no serviço. */
  @IsOptional() @IsString() @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: "Hora inválida (HH:MM)" })
  meetingTime?: string;

  @IsOptional() @IsString() @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/, { message: "Hora inválida (HH:MM)" })
  arrivalTime?: string;

  @IsOptional() @IsString() @Length(0, 600)
  notes?: string;

  @IsOptional() @IsBoolean()
  confirmationRequired?: boolean;
}

/** A resposta de uma família a uma convocatória. */
class CallUpReplyDto {
  @IsString()
  athleteId!: string;

  /** Verdadeiro = vai (confirma). Falso = não vai, e aí o motivo é obrigatório. */
  @IsBoolean()
  going!: boolean;

  @IsOptional() @IsString() @Length(0, 300)
  reason?: string;
}

class SetMaxDto {
  @IsInt()
  @Min(1)
  @Max(60)
  max!: number;
}

/**
 * Uma linha da ficha de jogo.
 *
 * Os limites estão aqui **e** no serviço, de propósito e não por esquecimento: o
 * DTO recusa o disparate óbvio com uma mensagem que se percebe, e o `clamp` do
 * serviço é a rede por baixo — nenhum caminho até à base fica sem ela, nem os
 * que um dia venham de um importador em vez de um formulário.
 */
class AppearanceDto {
  @IsString() athleteId!: string;
  /**
   * Aceite por compatibilidade, **ignorado** no cálculo.
   *
   * Os minutos jogados saem da titularidade, da entrada e da saída — ver
   * `minutosEmCampo` no serviço. Deixou de ser obrigatório para um cliente não
   * ter de inventar um número que não vai a lado nenhum, e continua a ser aceite
   * para não partir quem ainda o manda.
   */
  @IsOptional() @IsInt() @Min(0) @Max(300) minutes?: number;
  @IsOptional() @IsBoolean() started?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(99) tally?: number;
  @IsOptional() @IsInt() @Min(0) @Max(99) assists?: number;
  /** Dois é o máximo que existe: o segundo amarelo é a expulsão. */
  @IsOptional() @IsInt() @Min(0) @Max(2) yellowCards?: number;
  @IsOptional() @IsBoolean() redCard?: boolean;

  /*
   * O detalhe dos minutos — tudo opcional.
   *
   * O tecto de 130 não é o de `minutes` (300, que acomoda desportos de outra
   * duração): é um **instante** do jogo, e um jogo de futebol com
   * prolongamento acaba aos 120 e pouco. Um 250 aqui é um dedo escorregado.
   */
  @IsOptional() @IsInt() @Min(0) @Max(130) onMinute?: number;
  @IsOptional() @IsInt() @Min(0) @Max(130) offMinute?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(2) @IsInt({ each: true }) yellowAt?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(130) redAt?: number;
  /** Os minutos dos golos e das assistências. Opcionais, como o resto. */
  @IsOptional() @IsArray() @ArrayMaxSize(99) @IsInt({ each: true }) tallyAt?: number[];
  @IsOptional() @IsArray() @ArrayMaxSize(99) @IsInt({ each: true }) assistsAt?: number[];
}

class SaveAppearancesDto {
  @IsArray()
  @ArrayMaxSize(60)
  @ValidateNested({ each: true })
  @Type(() => AppearanceDto)
  rows!: AppearanceDto[];
}

/**
 * O resultado.
 *
 * `null` nos dois limpa e devolve o jogo a agendado — é como se desfaz um
 * resultado escrito por engano, sem um segundo endpoint só para isso.
 */
class SaveResultDto {
  @IsOptional() @IsInt() @Min(0) @Max(99) ourScore?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(99) theirScore?: number | null;
}

class MatchStaffRowDto {
  @IsString() membershipId!: string;
  @IsString() @Length(1, 60) role!: string;
}

class SaveStaffDto {
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => MatchStaffRowDto)
  rows!: MatchStaffRowDto[];
}

/**
 * Jogos e convocatórias.
 *
 * Controlador fino: quem pode o quê decide-se no serviço, com `can()` e
 * `teamScopeFilter`. Um treinador só chega aos jogos das equipas dele porque o
 * âmbito é aplicado lá, e não porque a interface só lhe mostra esses.
 */
@Controller("api/matches")
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get()
  list(@Req() req: AuthedRequest, @Query("from") from?: string, @Query("to") to?: string) {
    return this.matches.list(req.ctx, from ? new Date(from) : undefined, to ? new Date(to) : undefined);
  }

  /**
   * Quem pode entrar na ficha técnica de um jogo.
   *
   * Antes do `:id` de propósito — o Nest resolve rotas por ordem de declaração, e
   * `equipa-tecnica` seria apanhado por `:id` se viesse depois.
   */
  @Get("equipa-tecnica")
  staffPool(@Req() req: AuthedRequest) {
    return this.matches.staffPool(req.ctx);
  }

  /** A página do jogo: detalhes, convocados, ficha e staff, de uma vez. */
  @Get(":id")
  get(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.matches.get(req.ctx, id);
  }

  /** Atletas de escalões inferiores elegíveis para subir a este jogo. */
  @Get(":id/convidados-elegiveis")
  guestPool(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.matches.guestPool(req.ctx, id);
  }

  /** Guardar não avisa ninguém. Só submeter avisa. */
  @Post(":id/convocatoria")
  save(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SaveCallUpsDto) {
    return this.matches.saveCallUps(req.ctx, id, body.athleteIds);
  }

  /**
   * Submeter — e, no mesmo gesto, dizer a logística do dia.
   *
   * As perguntas eram do diálogo de exportar o PDF e viviam no `localStorage` de
   * quem exportava; agora entram aqui, porque é este o momento em que alguém
   * decide a que horas a malta se junta — e é este o momento em que as famílias
   * são avisadas. Ver `MatchesService.submitCallUps`.
   */
  @Post(":id/convocatoria/submeter")
  submit(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body?: SubmitCallUpsDto) {
    return this.matches.submitCallUps(req.ctx, id, body ?? {});
  }

  /**
   * A resposta da família: vai, ou não vai e porquê.
   *
   * Vive no controlador dos jogos e não num de família à parte porque é a mesma
   * convocatória — e a autorização não é "sou do clube", é "este atleta é meu"
   * (`athleteScopeFilter`). Ver `MatchesService.responderConvocatoria`.
   */
  @Post(":id/convocatoria/resposta")
  reply(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: CallUpReplyDto) {
    return this.matches.responderConvocatoria(req.ctx, id, body.athleteId, {
      going: body.going,
      reason: body.reason ?? null,
    });
  }

  /**
   * Corrigir os detalhes de uma convocatória já enviada — sem a reabrir.
   *
   * Reabrir desfaz a convocatória e ressubmeter avisa toda a gente outra vez;
   * mudar uma hora não é isso. As famílias dos convocados recebem um aviso que
   * **nomeia** a mudança. Ver `MatchesService.actualizarLogistica`.
   */
  @Patch(":id/convocatoria/logistica")
  updateLogistics(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SubmitCallUpsDto) {
    return this.matches.actualizarLogistica(req.ctx, id, body);
  }

  /**
   * As respostas das famílias, e mais nada.
   *
   * A consola sonda isto enquanto tem a convocatória aberta — é o que faz a
   * confirmação de um pai aparecer sem recarregar a página. Estreito de
   * propósito: recarregar a academia para o saber são nove pedidos. Ver
   * `MatchesService.respostasDaConvocatoria`.
   */
  @Get(":id/convocatoria/respostas")
  callUpReplies(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.matches.respostasDaConvocatoria(req.ctx, id);
  }

  @Post(":id/convocatoria/reabrir")
  reopen(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.matches.reopenCallUps(req.ctx, id);
  }

  /**
   * O plantel retroactivo de um jogo já disputado.
   *
   * Só existe na página do jogo — o ecrã de convocatórias continua a recusar
   * jogos passados. Ver `saveRetroSquad` para o porquê da separação.
   */
  @Get(":id/plantel-elegivel")
  retroPool(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.matches.retroPool(req.ctx, id);
  }

  @Post(":id/plantel")
  saveRetroSquad(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SaveCallUpsDto) {
    return this.matches.saveRetroSquad(req.ctx, id, body.athleteIds);
  }

  @Post(":id/resultado")
  saveResult(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SaveResultDto) {
    return this.matches.saveResult(req.ctx, id, {
      ourScore: body.ourScore ?? null,
      theirScore: body.theirScore ?? null,
    });
  }

  /** A ficha inteira de cada vez. Ver `saveAppearances` para o porquê. */
  @Post(":id/ficha")
  saveAppearances(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SaveAppearancesDto) {
    return this.matches.saveAppearances(req.ctx, id, body.rows);
  }

  @Post(":id/staff")
  saveStaff(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SaveStaffDto) {
    return this.matches.saveStaff(req.ctx, id, body.rows);
  }

  @Patch("equipas/:teamId/max-convocados")
  setMax(@Req() req: AuthedRequest, @Param("teamId") teamId: string, @Body() body: SetMaxDto) {
    return this.matches.setMaxCallUps(req.ctx, teamId, body.max);
  }
}
