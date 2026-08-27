import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
import { ChargeStatus } from "@prisma/client";
import type { AuthedRequest } from "../auth/auth.guard";
import { AcademyService } from "./academy.service";
import { AthletesService } from "./athletes.service";
import { AthleteInputDto, AthleteTaxIdDto, AthleteUpdateDto, ImportAthletesDto } from "./athletes.dto";
import { CreateTeamDto, ImportTeamsDto } from "./teams.dto";
import { CreateEventDto, UpdateEventDto } from "./events.dto";
import { BillingService, periodoActual, type AplicarEm } from "../billing/billing.service";

/** O estado a atribuir manualmente a uma mensalidade. Validado — só os três reais. */
class SetChargeStatusDto {
  @IsIn(["OPEN", "SETTLED", "VOID"])
  status!: "OPEN" | "SETTLED" | "VOID";
}

/** O preço, em cêntimos — entre 1 € e 1000 €, validado outra vez no serviço. */
class SetFeeDto {
  @IsInt()
  @Min(100)
  @Max(100_000)
  amountCents!: number;

  /**
   * A partir de quando se cobra. Omitido é "atual", que era o que sempre fez —
   * quem já chamava isto antes desta opção existir não muda de comportamento.
   */
  @IsOptional()
  @IsIn(["atual", "proximo"])
  aplicarEm?: AplicarEm;
}

/** O mesmo preço para vários atletas de uma vez — até 200, o mesmo tecto da importação. */
class SetAthleteFeeBulkDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  athleteIds!: string[];

  @IsInt()
  @Min(100)
  @Max(100_000)
  amountCents!: number;

  @IsOptional()
  @IsIn(["atual", "proximo"])
  aplicarEm?: AplicarEm;
}

/** As excepções de acesso a gravar para uma pessoa. Validadas — ver `invites.dto.ts`. */
/**
 * O que o clube escreve na página de adesão.
 *
 * Limites curtos de propósito: uma frase de abertura com 200 caracteres não é uma
 * frase, é um parágrafo — e desenha mal em qualquer ecrã.
 */
class MembershipCopyDto {
  @IsOptional() @IsString() @Length(0, 90) headline?: string;
  @IsOptional() @IsString() @Length(0, 240) intro?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(6) @IsString({ each: true }) points?: string[];
}

/** A cor e o símbolo do clube — o white-label, gravado. Ver `setIdentity`. */
class IdentityDto {
  @IsOptional() @IsString() @Length(7, 7) signalColor?: string;
  @IsOptional() @IsString() @Length(0, 500) logoUrl?: string;
}

/** Desactivar ou reactivar uma conta — de staff ou de encarregado. */
class SetActiveDto {
  @IsBoolean() active!: boolean;
}

/**
 * Uma modalidade.
 *
 * As posições e as competências são listas escritas pelo clube: "Guarda-redes"
 * no futebol, "Bruços" na natação. Um enum aqui obrigaria a uma migração por
 * cada desporto novo que um cliente tivesse.
 */
class SportDto {
  @IsOptional() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) positions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(40) @IsString({ each: true }) skills?: string[];
  @IsOptional() @IsString() @Length(0, 40) dominantSideLabel?: string;
  @IsOptional() @IsInt() @Min(1) @Max(300) matchMinutes?: number;
}

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
 * As equipas de uma pessoa do staff.
 *
 * Lista completa e não um "juntar"/"tirar": é o estado final da lista de
 * selecção do diálogo, e mandá-la inteira é o que torna o pedido idempotente.
 * Vinte equipas é folgado para um treinador — quem trabalha com mais do que isso
 * é coordenador, e esses vêem a academia toda por papel.
 */
class SetTeamsDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  teamIds!: string[];
}

/**
 * O calendário de cobrança do clube.
 *
 * Os dois campos são opcionais e independentes: o ecrã grava o que a pessoa
 * acabou de mexer, e não o formulário todo de cada vez.
 */
class BillingSettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(28) dueDay?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(12, { each: true })
  months?: number[];
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

  /**
   * Importar equipas de um ficheiro. Devolve o resultado linha a linha.
   *
   * Mesma forma que a importação de atletas: o que falha volta com o número da
   * linha e o motivo, e o resto entra na mesma.
   */
  @Post("teams/import")
  importTeams(@Req() req: AuthedRequest, @Body() body: ImportTeamsDto) {
    return this.academy.importTeams(req.ctx, body.rows);
  }

  /**
   * O preço por omissão da equipa — todos os atletas sem ajuste individual pagam
   * isto. Ver `BillingService.setTeamFee`.
   */
  /**
   * A página pública de adesão a sócio — a frase, a explicação e os pontos.
   *
   * Vive aqui e não em `/api/members` de propósito: é configuração da academia,
   * como a cor e o nome, e não gestão de sócios. Quem a muda tem `settings:write`,
   * não `member:write`.
   */
  @Patch("membership-page")
  setMembershipCopy(@Req() req: AuthedRequest, @Body() body: MembershipCopyDto) {
    return this.academy.setMembershipCopy(req.ctx, body);
  }

  /**
   * A cor e o símbolo do clube.
   *
   * `settings:write`, verificado no serviço. Atravessa o produto inteiro — o
   * manifest da app, a landing, a página de sócios — e é por isso que é da
   * academia e não uma preferência de quem a escolhe.
   */
  @Patch("identity")
  setIdentity(@Req() req: AuthedRequest, @Body() body: IdentityDto) {
    return this.academy.setIdentity(req.ctx, body);
  }

  /* --- Desportos ---------------------------------------------------------- */

  @Post("sports")
  createSport(@Req() req: AuthedRequest, @Body() body: SportDto) {
    return this.academy.createSport(req.ctx, body);
  }

  @Patch("sports/:id")
  updateSport(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SportDto) {
    return this.academy.updateSport(req.ctx, id, body);
  }

  /** Só quando não há nada agarrado — ver o serviço. */
  @Delete("sports/:id")
  removeSport(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.academy.removeSport(req.ctx, id);
  }

  @Patch("teams/:id/fee")
  setTeamFee(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SetFeeDto) {
    return this.billing.setTeamFee(req.ctx, id, body.amountCents, body.aplicarEm);
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

  /**
   * O NIF de um atleta que já existe.
   *
   * Endpoint estreito e não um `PATCH` genérico de atleta — ver `setTaxId`. É o que
   * permite a uma academia que já importou o plantel preencher a coluna que liga as
   * famílias à app.
   */
  /**
   * Editar a ficha de um atleta.
   *
   * A lista de campos é fechada em `AthleteUpdateDto`, e o que é clínico não está
   * lá — vive em `ClinicalEntry`, com autor e permissão próprios.
   */
  @Patch("athletes/:id")
  updateAthlete(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: AthleteUpdateDto) {
    return this.athletes.update(req.ctx, id, body);
  }

  @Patch("athletes/:id/nif")
  setAthleteTaxId(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: AthleteTaxIdDto) {
    return this.athletes.setTaxId(req.ctx, id, body.taxId);
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
   * As equipas de uma pessoa — o `TeamStaff` dela.
   *
   * Também exige `access:write`: as equipas de um treinador são o âmbito dos
   * dados dele, não uma etiqueta na ficha. A regra e as guardas estão no serviço.
   */
  @Patch("staff/:id/teams")
  setTeams(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SetTeamsDto) {
    return this.academy.setTeams(req.ctx, id, body.teamIds);
  }

  /**
   * Desactivar ou reactivar uma conta.
   *
   * Serve staff e encarregados — é a mesma `Membership` nos dois casos, e a
   * pergunta ("esta pessoa ainda entra?") é a mesma. As guardas contra escalada
   * e contra o auto-lockout estão no serviço.
   */
  @Patch("memberships/:id/active")
  setMembershipActive(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SetActiveDto) {
    return this.academy.setMembershipActive(req.ctx, id, body.active);
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

  /**
   * Gerar as mensalidades em falta de um período.
   *
   * Cria só o que **falta** — nunca reescreve uma mensalidade já emitida, nem
   * uma que alguém tenha marcado como paga. Por isso pode ser chamado à vontade:
   * ao abrir o mês, ou para apanhar atletas que ficaram sem preço à inscrição e
   * cujo preço foi definido depois. Ver `BillingService.ensureCharges`.
   *
   * Sem `?periodo=`, o mês corrente — que é o caso de quase todas as vezes.
   */
  /**
   * O calendário de cobrança — dia de vencimento e meses em que se cobra.
   *
   * Gera o mês corrente a seguir a gravar: ligar Agosto e continuar sem
   * mensalidades era o buraco que isto veio tapar. Ver `setBillingSettings`.
   */
  @Patch("pagamentos")
  setBillingSettings(@Req() req: AuthedRequest, @Body() body: BillingSettingsDto) {
    return this.academy.setBillingSettings(req.ctx, body);
  }

  /**
   * Quem não tem mensalidade num período, e porquê.
   *
   * Só leitura — é o relatório que o ecrã de Mensalidades mostra por baixo da
   * tabela para a ausência deixar de ser um mistério. Ver `missingCharges`.
   */
  @Get("charges/em-falta")
  missingCharges(@Req() req: AuthedRequest, @Query("periodo") periodo?: string) {
    return this.billing.missingCharges(req.ctx, periodo ?? periodoActual());
  }

  @Post("charges/gerar")
  ensureCharges(@Req() req: AuthedRequest, @Query("periodo") periodo?: string) {
    return this.billing.ensureCharges(req.ctx, periodo ?? periodoActual());
  }

  /**
   * Lembrete a quem tem uma mensalidade vencida — sem escolha de destinatários:
   * é sempre "toda a gente vencida agora", nunca uma lista vinda do cliente. Ver
   * `BillingService.sendOverdueReminders`.
   */
  @Post("charges/reminders")
  sendOverdueReminders(@Req() req: AuthedRequest) {
    return this.billing.sendOverdueReminders(req.ctx);
  }

  /** O que este atleta paga hoje — individual, da equipa, ou nenhum dos dois. */
  @Get("athletes/:id/fee")
  getAthleteFee(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.billing.getAthleteFee(req.ctx, id);
  }

  /** Ajuste individual — sobrepõe-se ao preço da equipa para este atleta. */
  @Put("athletes/:id/fee")
  setAthleteFee(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: SetFeeDto) {
    return this.billing.setAthleteFee(req.ctx, id, body.amountCents, body.aplicarEm);
  }

  /** O mesmo ajuste individual, para vários atletas escolhidos de uma vez. */
  @Put("athletes/fee")
  setAthleteFeeBulk(@Req() req: AuthedRequest, @Body() body: SetAthleteFeeBulkDto) {
    return this.billing.setAthleteFeeBulk(req.ctx, body.athleteIds, body.amountCents, body.aplicarEm);
  }

  /** Remove o ajuste individual — volta a pagar o preço da equipa. */
  @Delete("athletes/:id/fee")
  clearAthleteFee(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.billing.clearAthleteFee(req.ctx, id);
  }
}
