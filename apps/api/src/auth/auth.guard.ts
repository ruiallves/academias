import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuthService, type AppKind } from "./auth.service";
import { SupabaseJwtService } from "./supabase-jwt.service";
import { PresenceService } from "../presence/presence.service";
import { tenantFromHost } from "../tenant/tenant";
import { LegalService } from "../legal/legal.service";
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

/**
 * Deixa uma rota autenticada passar mesmo com documentos legais por aceitar.
 *
 * São poucas e são as que o próprio gate precisa para funcionar — o sinal de
 * presença, por exemplo, que não lê nem escreve nada de domínio. Tudo o resto
 * fica fechado até a pessoa aceitar: é o guard, e não o browser, que decide.
 */
export const LEGAL_EXEMPT = "legal:exempt";
export const LegalExempt = () => SetMetadata(LEGAL_EXEMPT, true);

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
    private readonly presence: PresenceService,
    private readonly legal: LegalService,
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
    req.ctx = await this.auth.contextFor(user.authId, slug, appKind(req));

    /*
     * A marca de presença.
     *
     * Aqui e não num interceptor: é o único sítio por onde passa **todo** o
     * pedido autenticado, já com a academia resolvida, e é uma escrita num mapa
     * em memória — nada de I/O, nada que possa falhar, nada que atrase a
     * resposta. Ver `presence.service.ts` para o porquê de não ser na base.
     */
    this.presence.marcar(req.ctx.membershipId, req.ctx.academyId, req.ctx.role);

    /*
     * O gate legal, do lado do servidor.
     *
     * Aqui, e não num guard à parte: os guards globais correm pela ordem em que
     * os módulos os registam, e este precisa do `ctx` que acabou de ser
     * construído. Pô-lo noutro sítio era confiar numa ordem que ninguém vê.
     *
     * Com documentos por aceitar, o pedido leva 403 com o código
     * `LEGAL_ACCEPTANCE_REQUIRED` — e o cliente sabe que tem de mostrar o gate
     * em vez de um erro. As rotas `/api/legal/*` são `@Public()` e ficam de fora
     * por construção: são elas que permitem sair daqui.
     */
    const exempt = this.reflector.getAllAndOverride<boolean>(LEGAL_EXEMPT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!exempt) await this.legal.assertClearContext(req.ctx);

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
/**
 * De que app vem o pedido — `x-app: family` ou `x-app: console`.
 *
 * Serve para escolher entre as memberships que a pessoa **já tem** nesta
 * academia, quando tem mais do que uma: o treinador que também é pai precisa de
 * ser tratado como pai na app da família e como treinador na consola, e o
 * servidor não tem como adivinhar qual é qual. Ver `escolherMembership`.
 *
 * Não é uma credencial: quem enviar `family` sem ser família nenhuma leva um 403,
 * e quem enviar `console` não ganha permissão nenhuma que não tivesse. É por isso
 * que pode vir do cliente.
 */
function appKind(req: Request): AppKind | undefined {
  const header = req.headers["x-app"];
  const valor = typeof header === "string" ? header.trim().toLowerCase() : "";
  return valor === "family" || valor === "console" ? valor : undefined;
}

function tenantSlug(req: Request): string | null {
  const fromHost = tenantFromHost(req.headers.host);
  if (fromHost) return fromHost;

  const header = req.headers["x-academy-slug"];
  if (typeof header === "string" && header.trim()) return header.trim().toLowerCase();

  return null;
}
