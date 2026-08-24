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
 * Subdomínios que **nunca** são uma academia.
 *
 * A mesma lista que `PlatformService` recusa ao criar um clube — se um slug não
 * pode ser registado com este nome, um host com este nome também não pode ser lido
 * como tenant. Duplicada de propósito: são as duas pontas da mesma regra, e uma a
 * importar a outra criaria uma dependência do `auth` no módulo `platform`.
 */
const RESERVED_HOSTS = new Set(["www", "api", "admin", "app", "platform", "static", "assets", "cdn", "mail"]);

/**
 * De que academia é este pedido.
 *
 * Em produção vem do subdomínio — `fafe.academias.pt` → `fafe`. Em desenvolvimento
 * o host é `localhost`, e aí aceita-se um cabeçalho explícito.
 *
 * O cabeçalho **não é uma forma de escolher academia**: quem o enviar continua a
 * precisar de uma membership lá dentro, e é isso que o `AuthService` verifica.
 * Sem essa verificação, este cabeçalho seria uma porta aberta.
 *
 * ## Porque é que o domínio tem de ser dito, e não adivinhado
 *
 * A versão anterior tratava **qualquer** host com três ou mais rótulos como um
 * tenant: `api.academias.pt` resolvia para a academia "api", e
 * `academias-api.up.railway.app` para "academias-api". Todos os pedidos morriam em
 * `Academia "api" não encontrada` no momento em que a API ganhou um subdomínio
 * próprio — que é exactamente o que acontece ao pôr isto no Railway.
 *
 * `TENANT_DOMAIN` (`academias.pt`) resolve-o: só um subdomínio **desse** domínio é
 * um clube. Qualquer outro host — o da API, o do Railway, um túnel de
 * desenvolvimento — cai no cabeçalho, como o `localhost` sempre caiu. Sem a
 * variável definida, nenhum host é tratado como tenant: falha para o lado seguro,
 * porque adivinhar aqui é adivinhar de quem são os dados.
 */
function tenantSlug(req: Request): string | null {
  const host = (req.headers.host ?? "").split(":")[0].toLowerCase();
  const domain = (process.env.TENANT_DOMAIN ?? "").trim().toLowerCase();

  if (domain && host.endsWith(`.${domain}`)) {
    const sub = host.slice(0, -(domain.length + 1));
    // Só o primeiro nível: `fafe.academias.pt` é um clube, `x.y.academias.pt` não.
    if (sub && !sub.includes(".") && !RESERVED_HOSTS.has(sub)) return sub;
  }

  const header = req.headers["x-academy-slug"];
  if (typeof header === "string" && header.trim()) return header.trim().toLowerCase();

  return null;
}
