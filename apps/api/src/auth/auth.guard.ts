import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { SupabaseJwtService } from "./supabase-jwt.service";
import { tenantFromHost } from "../tenant/tenant";
import type { RequestContext } from "../common/permissions";

/**
 * Marca uma rota como pública.
 *
 * São poucas e todas têm outra forma de se autenticar: o webhook da euPago pela
 * assinatura HMAC, a landing por não revelar nada que não esteja já no URL. Ter
 * de marcar explicitamente é o ponto — o guard é global, e esquecer-se de o
 * aplicar deixa a rota fechada, não aberta.
 */
export const PUBLIC = "auth:public";
export const Public = () => SetMetadata(PUBLIC, true);

export type AuthedRequest = Request & { ctx: RequestContext };

/**
 * Guard de autenticação e de tenant.
 *
 * Faz duas coisas que costumam andar separadas, e junta-as de propósito: sem
 * saber **quem** e **de que academia**, nenhum pedido pode continuar. Separá-las
 * criaria uma janela em que o utilizador está autenticado mas o tenant ainda não
 * está resolvido — e é aí que se escrevem os bugs de isolamento.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: SupabaseJwtService,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();

    const token = bearer(req);
    if (!token) throw new UnauthorizedException("Falta o token de sessão");

    const slug = tenantSlug(req);
    if (!slug) throw new UnauthorizedException("Não foi possível determinar a academia");

    const user = await this.jwt.verify(token);
    req.ctx = await this.auth.contextFor(user.authId, slug);
    return true;
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

/**
 * De que academia é este pedido.
 *
 * Em produção vem do subdomínio — `fafe.academias.pt` → `fafe`, pela mesma função
 * que o `TenantMiddleware` usa para reescrever os caminhos públicos. Uma fonte de
 * verdade só: o guard e o middleware não podem discordar sobre de quem é o pedido.
 *
 * Em desenvolvimento o host é `localhost`, não é subdomínio de nada, e aí
 * aceita-se um cabeçalho explícito. O cabeçalho **não é uma forma de escolher
 * academia**: quem o enviar continua a precisar de uma membership lá dentro, e é
 * isso que o `AuthService` verifica. Sem essa verificação, seria uma porta aberta.
 */
function tenantSlug(req: Request): string | null {
  const fromHost = tenantFromHost(req.headers.host);
  if (fromHost) return fromHost;

  const header = req.headers["x-academy-slug"];
  if (typeof header === "string" && header.trim()) return header.trim().toLowerCase();

  return null;
}
