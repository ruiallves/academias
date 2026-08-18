import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { PlatformRole } from "@prisma/client";
import { SupabaseJwtService } from "../auth/supabase-jwt.service";
import { PlatformPrisma } from "./platform.prisma";

/**
 * O guard da plataforma.
 *
 * Deliberadamente **separado** do `AuthGuard` das academias, e não uma variante
 * dele. Os dois respondem a perguntas diferentes:
 *
 *   - `AuthGuard`: quem és, e de que academia é este pedido?
 *   - `PlatformGuard`: és um dos donos disto?
 *
 * Partilham só a verificação da assinatura do token. A partir daí não há uma linha
 * de código comum, e é esse o ponto: um engano num deles não pode contaminar o
 * outro. Se algum dia alguém acrescentar um caso especial ao âmbito das academias,
 * não há caminho por onde isso abra a plataforma.
 *
 * A pertença é lida da tabela `PlatformAdmin`, que não tem `academyId` e a que o
 * papel `academia_app` não tem acesso nenhum (ver a migração `20260816000600`).
 * Nenhuma concessão dentro de uma academia chega aqui.
 */

export const PLATFORM_ROLES = "platform:roles";

/** Restringe uma rota a certos papéis da plataforma. Sem isto, basta ser admin activo. */
export const PlatformRoles = (...roles: PlatformRole[]) => SetMetadata(PLATFORM_ROLES, roles);

export type PlatformAdminContext = {
  id: string;
  authId: string;
  name: string;
  email: string;
  role: PlatformRole;
  mfaEnrolledAt: Date | null;
};

export type PlatformRequest = Request & { admin: PlatformAdminContext };

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: SupabaseJwtService,
    private readonly prisma: PlatformPrisma,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PlatformRequest>();

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Falta o token de sessão");

    const { authId } = await this.jwt.verify(header.slice(7).trim());

    const admin = await this.prisma.platformAdmin.findFirst({
      where: { authId, isActive: true },
      select: { id: true, authId: true, name: true, email: true, role: true, mfaEnrolledAt: true },
    });

    // 403 e não 404: quem tem sessão válida e não é da casa fica a saber que a
    // rota existe — já sabia, o URL é público — e não fica a saber mais nada.
    if (!admin) throw new ForbiddenException("Sem acesso à plataforma");

    const required = this.reflector.getAllAndOverride<PlatformRole[]>(PLATFORM_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length && !required.includes(admin.role)) {
      throw new ForbiddenException("O teu papel não permite esta operação");
    }

    req.admin = admin;
    return true;
  }
}
