import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { AuthedRequest } from "../auth/auth.guard";
import { Public } from "../auth/auth.guard";
import { MembersService } from "./members.service";
import { MemberFeesService } from "./member-fees.service";
import { MemberInvitesService } from "./member-invites.service";
import {
  MemberCreateDto,
  MemberImportDto,
  MemberSignupDto,
  MemberTierInputDto,
  MemberUpdateDto,
} from "./members.dto";

/**
 * A gestão de sócios — atrás de `member:read` / `member:write`.
 *
 * Controlador fino: nenhuma decisão de permissão acontece aqui.
 */
@Controller("api/members")
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly fees: MemberFeesService,
    private readonly invites: MemberInvitesService,
  ) {}

  /*
   * As rotas com prefixo literal vêm ANTES de `:id` — a lição do `por-tratar`
   * dos tickets: o Nest casa por ordem de declaração, e um `:id` guloso
   * engoliria `card/...` e `fees/...` inteiros.
   */

  /** O leitor do QR na portaria: token → quem é, e se está activo. */
  @Get("card/:token")
  card(@Req() req: AuthedRequest, @Param("token") token: string) {
    return this.members.cardInfo(req.ctx, token);
  }

  /** Gerar as quotas do período corrente — idempotente, diz quantas criou. */
  @Post("fees/generate")
  generateFees(@Req() req: AuthedRequest) {
    return this.fees.gerar(req.ctx);
  }

  @Post("fees/:id/settle")
  settleFee(@Req() req: AuthedRequest, @Param("id") id: string, @Body() body: { method?: string }) {
    return this.fees.liquidar(req.ctx, id, body?.method);
  }

  @Post("fees/:id/void")
  voidFee(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.fees.anular(req.ctx, id);
  }

  @Post("fees/:id/reopen")
  reopenFee(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.fees.reabrir(req.ctx, id);
  }

  @Get()
  list(
    @Req() req: AuthedRequest,
    @Query("status") status?: string,
    @Query("tierId") tierId?: string,
    @Query("q") q?: string,
  ) {
    return this.members.list(req.ctx, { status, tierId, q });
  }

  /** Um sócio inscrito na secretaria, com a pessoa à frente. */
  @Post()
  create(@Req() req: AuthedRequest, @Body() dto: MemberCreateDto) {
    return this.members.create(req.ctx, dto);
  }

  /**
   * O livro de sócios que o clube já tinha.
   *
   * A folha é lida no browser e chega aqui como linhas — o servidor nunca vê o
   * ficheiro. Um .xlsx é um formato com macros e zip bombs lá dentro; abri-lo no
   * servidor era acrescentar essa superfície ao produto para não ganhar nada.
   */
  @Post("import")
  importMembers(@Req() req: AuthedRequest, @Body() dto: MemberImportDto) {
    return this.members.importMembers(req.ctx, dto.rows, dto.createTiers ?? false);
  }

  @Get("tiers")
  tiers(@Req() req: AuthedRequest) {
    return this.members.tiers(req.ctx);
  }

  @Post("tiers")
  createTier(@Req() req: AuthedRequest, @Body() dto: MemberTierInputDto) {
    return this.members.createTier(req.ctx, dto);
  }

  @Patch("tiers/:id")
  updateTier(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: MemberTierInputDto) {
    return this.members.updateTier(req.ctx, id, dto);
  }

  @Delete("tiers/:id")
  archiveTier(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.members.archiveTier(req.ctx, id);
  }

  @Get(":id")
  detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.members.detail(req.ctx, id);
  }

  @Get(":id/fees")
  memberFees(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.fees.doSocio(req.ctx, id);
  }

  /** (Re)enviar o convite para a app — o botão da ficha. */
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post(":id/invite")
  invite(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.invites.enviar(req.ctx, id);
  }

  /** Ligar a ficha a uma conta que já existe neste clube — sem mandar email. */
  @Post(":id/link-account")
  linkAccount(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.invites.ligarConta(req.ctx, id);
  }

  @Delete(":id/link-account")
  unlinkAccount(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.invites.desligarConta(req.ctx, id);
  }

  @Patch(":id")
  update(@Req() req: AuthedRequest, @Param("id") id: string, @Body() dto: MemberUpdateDto) {
    return this.members.update(req.ctx, id, dto);
  }

  /** Ver `MembersService.remove`: só sai quem nunca chegou a ter número. */
  @Delete(":id")
  remove(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.members.remove(req.ctx, id);
  }
}

/**
 * A inscrição pública.
 *
 * ## Porquê um controlador à parte
 *
 * Porque a fronteira é outra. Tudo o resto do produto exige uma sessão; isto
 * aceita um pedido de alguém que o produto nunca viu, e o clube vem do endereço.
 * Separar os dois torna essa diferença visível na estrutura dos ficheiros — e
 * torna difícil acrescentar por distracção um endpoint autenticado no meio dos
 * públicos.
 *
 * ## O tecto
 *
 * Cinco por minuto, como o resgate de convites. Um formulário público sem tecto é
 * uma porta para encher a base de dados de um clube com inscrições falsas, e o
 * limite global de 120/min é largo de mais para isso.
 */
@Public()
@Controller("api/clubes/:slug")
export class PublicMembersController {
  constructor(private readonly members: MembersService) {}

  /** As categorias que o clube publica — é o que o formulário mostra. */
  @Get("tipos-socio")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  tiers(@Param("slug") slug: string) {
    return this.members.publicTiers(slug);
  }

  @Post("socios")
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signup(@Param("slug") slug: string, @Body() dto: MemberSignupDto) {
    return this.members.signup(slug, dto);
  }
}
