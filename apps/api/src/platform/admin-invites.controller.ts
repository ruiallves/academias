import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../auth/auth.guard";
import { PlatformGuard, PlatformRoles, type PlatformRequest } from "./platform.guard";
import { AdminInvitesService } from "./admin-invites.service";
import { InviteAdminDto, RedeemAdminInviteDto, SetAdminActiveDto, SetAdminRoleDto } from "./admin-invites.dto";

/**
 * Administradores da plataforma — do lado de quem já é dono disto.
 *
 * Tudo aqui fechado a `OWNER`. Um `ADMIN` gere academias e subscrições; gerir
 * *quem gere a plataforma* é um nível acima, e é o schema que o diz: a
 * documentação de `PlatformRole.OWNER` é literalmente "tudo, incluindo gerir
 * administradores e planos".
 */
@Public()
@UseGuards(PlatformGuard)
@Controller("api/platform/admins")
export class AdminsController {
  constructor(private readonly invites: AdminInvitesService) {}

  @Get()
  @PlatformRoles("OWNER")
  list() {
    return this.invites.list();
  }

  @Post("convite")
  @PlatformRoles("OWNER")
  invite(@Req() req: PlatformRequest, @Ip() ip: string, @Body() body: InviteAdminDto) {
    return this.invites.invite(req.admin, body, ip);
  }

  @Patch(":id/estado")
  @PlatformRoles("OWNER")
  setActive(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string, @Body() body: SetAdminActiveDto) {
    return this.invites.setActive(req.admin, id, body.active, ip);
  }

  @Patch(":id/papel")
  @PlatformRoles("OWNER")
  setRole(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string, @Body() body: SetAdminRoleDto) {
    return this.invites.setRole(req.admin, id, body.role, ip);
  }

  @Delete(":id")
  @PlatformRoles("OWNER")
  remove(@Req() req: PlatformRequest, @Ip() ip: string, @Param("id") id: string) {
    return this.invites.remove(req.admin, id, ip);
  }
}

/**
 * Administradores da plataforma — do lado de quem resgata.
 *
 * Público por obrigação, como `InvitePageController`: quem chega aqui ainda não
 * tem conta na plataforma, logo não pode ter um token da plataforma para
 * apresentar. Quem autentica o pedido é o próprio convite.
 *
 * Apertado a 5 por minuto e por IP nas duas rotas — o espaço de tokens (32 bytes
 * aleatórios) é grande de mais para forçar, mas o resgate verifica a password
 * contra o Supabase quando o email já tem conta, e sem limite isso é um *oráculo
 * de passwords* contra quem foi convidado.
 */
@Public()
@Controller("api/platform/admin-invite")
export class AdminInvitePageController {
  constructor(private readonly invites: AdminInvitesService) {}

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Get(":token")
  preview(@Param("token") token: string) {
    return this.invites.preview(token);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post(":token/aceitar")
  redeem(@Param("token") token: string, @Body() body: RedeemAdminInviteDto) {
    return this.invites.redeem(token, body.password);
  }
}
