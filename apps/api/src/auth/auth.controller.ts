import { Controller, Get, Req, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { SupabaseJwtService } from "./supabase-jwt.service";
import { Public, type AuthedRequest } from "./auth.guard";
import { ROLE_PERMISSIONS } from "../common/permissions";

/**
 * Quem sou eu, e o que posso fazer.
 *
 * A consola chama isto uma vez depois do login e constrói a navegação a partir da
 * resposta. As permissões vão calculadas do servidor — não é o cliente a decidir
 * o que o papel dele permite, é o servidor a dizer-lho.
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly jwt: SupabaseJwtService,
  ) {}

  /**
   * As academias desta pessoa, antes de haver tenant escolhido.
   *
   * Público quanto ao tenant (não quanto à identidade — continua a exigir token
   * válido): é o que permite ao ecrã de login mostrar "trabalhas em duas
   * academias, escolhe uma" sem já estar dentro de nenhuma.
   */
  @Public()
  @Get("memberships")
  async memberships(@Req() req: Request) {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Falta o token");

    const user = await this.jwt.verify(header.slice(7));
    const rows = await this.auth.membershipsOf(user.authId);

    return {
      authId: user.authId,
      email: user.email,
      academies: rows.map((r) => ({
        id: r.academy_id,
        slug: r.academy_slug,
        name: r.academy_name,
        role: r.role,
      })),
    };
  }

  @Get("me")
  me(@Req() req: Request) {
    const ctx = (req as AuthedRequest).ctx;
    return {
      userId: ctx.userId,
      academyId: ctx.academyId,
      role: ctx.role,
      scope: ctx.scope,
      // O cliente recebe a lista final — papel mais concessões pontuais.
      permissions: [...new Set([...ROLE_PERMISSIONS[ctx.role], ...ctx.grants])],
    };
  }
}
