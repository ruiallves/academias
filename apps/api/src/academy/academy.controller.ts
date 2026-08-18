import { Body, Controller, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsIn, IsString } from "class-validator";
import { ChargeStatus } from "@prisma/client";
import type { AuthedRequest } from "../auth/auth.guard";
import { AcademyService } from "./academy.service";
import { AthletesService } from "./athletes.service";
import { AthleteInputDto, ImportAthletesDto } from "./athletes.dto";
import { CreateTeamDto } from "./teams.dto";
import { CreateEventDto, UpdateEventDto } from "./events.dto";
import { BillingService } from "../billing/billing.service";

/** O estado a atribuir manualmente a uma mensalidade. Validado — só os três reais. */
class SetChargeStatusDto {
  @IsIn(["OPEN", "SETTLED", "VOID"])
  status!: "OPEN" | "SETTLED" | "VOID";
}

/** As excepções de acesso a gravar para uma pessoa. Validadas — ver `invites.dto.ts`. */
class SetAccessDto {
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  grants!: string[];

  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  revokes!: string[];
}

/**
 * As leituras da consola.
 *
 * Controlador fino: nem uma decisão de permissão aqui dentro. Quem decide é o
 * serviço, com `can()` — um controlador que decide permissões é um controlador que
 * as decide de forma diferente do próximo.
 *
 * Todas estas rotas passam pelo `AuthGuard`, que resolve **quem** e **de que
 * academia** antes de qualquer uma correr. Não estão marcadas `@Public()` e é por
 * isso que estão fechadas: esquecer-se de proteger uma rota deixa-a fechada, não
 * aberta.
 */
@Controller("api")
export class AcademyController {
  constructor(
    private readonly academy: AcademyService,
    private readonly athletes: AthletesService,
    private readonly billing: BillingService,
  ) {}

  @Get("bootstrap")
  bootstrap(@Req() req: AuthedRequest) {
    return this.academy.bootstrap(req.ctx);
  }

  @Get("teams")
  teams(@Req() req: AuthedRequest) {
    return this.academy.teams(req.ctx);
  }

  /** Criar equipa. A permissão (`team:write`) é verificada no serviço. */
  @Post("teams")
  createTeam(@Req() req: AuthedRequest, @Body() body: CreateTeamDto) {
    return this.academy.createTeam(req.ctx, body);
  }

  @Get("athletes")
  listAthletes(@Req() req: AuthedRequest) {
    return this.academy.athletes(req.ctx);
  }

  /** Inscrever um atleta. A permissão (`athlete:write`) é verificada no serviço. */
  @Post("athletes")
  createAthlete(@Req() req: AuthedRequest, @Body() body: AthleteInputDto) {
    return this.athletes.create(req.ctx, body);
  }

  /** Importação em lote a partir de um ficheiro. Devolve o resultado linha a linha. */
  @Post("athletes/import")
  importAthletes(@Req() req: AuthedRequest, @Body() body: ImportAthletesDto) {
    return this.athletes.importMany(req.ctx, body.rows);
  }

  @Get("staff")
  staff(@Req() req: AuthedRequest) {
    return this.academy.staff(req.ctx);
  }

  /**
   * Definir o acesso de uma pessoa. Exige `access:write` (verificado no serviço).
   *
   * É a persistência do painel "Acesso" da ficha de staff — o que era só local
   * passa a ter efeito no servidor. As guardas contra escalada estão no serviço.
   */
  @Patch("staff/:id/access")
  setAccess(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SetAccessDto) {
    return this.academy.setAccess(req.ctx, id, body.grants, body.revokes);
  }

  /**
   * Treinos num intervalo.
   *
   * O intervalo é obrigatório na prática — sem ele devolvem-se três semanas à
   * volta de hoje, que é o que os ecrãs de presenças e calendário pedem. Devolver
   * a época inteira por omissão era mandar milhares de linhas para o browser
   * porque alguém se esqueceu de um parâmetro.
   */
  @Get("sessions")
  sessions(@Req() req: AuthedRequest, @Query("from") from?: string, @Query("to") to?: string) {
    const now = new Date();
    const start = from ? new Date(from) : new Date(now.getTime() - 21 * 86_400_000);
    const end = to ? new Date(to) : new Date(now.getTime() + 21 * 86_400_000);
    return this.academy.sessions(req.ctx, start, end);
  }

  /** Eventos pontuais do calendário num intervalo (mesmo padrão de `sessions`). */
  @Get("events")
  events(@Req() req: AuthedRequest, @Query("from") from?: string, @Query("to") to?: string) {
    const now = new Date();
    const start = from ? new Date(from) : new Date(now.getTime() - 21 * 86_400_000);
    const end = to ? new Date(to) : new Date(now.getTime() + 21 * 86_400_000);
    return this.academy.events(req.ctx, start, end);
  }

  /** Criar evento. A permissão (`calendar:write`) e o âmbito são verificados no serviço. */
  @Post("events")
  createEvent(@Req() req: AuthedRequest, @Body() body: CreateEventDto) {
    return this.academy.createEvent(req.ctx, body);
  }

  /** Cancelar ou reativar um evento. */
  @Patch("events/:id")
  updateEvent(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: UpdateEventDto) {
    return this.academy.setEventCancelled(req.ctx, id, body.cancelled);
  }

  @Get("charges")
  charges(@Req() req: AuthedRequest, @Query("period") period?: string) {
    return this.academy.charges(req.ctx, period);
  }

  /**
   * Ajuste manual do estado de uma mensalidade (paga / por pagar / anulada).
   *
   * É uma ação de gestão da direção (`billing:write`), não um pagamento — o fluxo
   * euPago continua a ser o único que liquida um pagamento online. Ver
   * `BillingService.setChargeStatus`.
   */
  @Patch("charges/:id/status")
  setChargeStatus(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SetChargeStatusDto) {
    return this.billing.setChargeStatus(req.ctx, id, body.status as ChargeStatus);
  }
}
