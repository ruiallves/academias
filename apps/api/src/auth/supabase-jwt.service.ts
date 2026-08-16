import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Verificação dos tokens do Supabase Auth.
 *
 * O projecto assina os tokens de utilizador com **ES256** — chave assimétrica —
 * e publica as chaves públicas em `/auth/v1/.well-known/jwks.json`. Verificar com
 * a chave pública é melhor do que com um segredo partilhado por duas razões: o
 * servidor nunca precisa de guardar nada com que possa **assinar** tokens, e a
 * rotação de chaves no Supabase não obriga a reimplantar nada.
 *
 * (Se vires um `SUPABASE_JWT_SECRET` de 36 caracteres na configuração, é o `kid`
 * da chave, não um segredo. Não serve para verificar nada e não precisa de ser
 * protegido.)
 *
 * `createRemoteJWKSet` guarda as chaves em cache e só volta a buscá-las quando
 * aparece um `kid` desconhecido — não é um pedido de rede por cada verificação.
 */
@Injectable()
export class SupabaseJwtService {
  private readonly log = new Logger(SupabaseJwtService.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly config: ConfigService) {}

  private get keys() {
    if (!this.jwks) {
      const base = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
      this.jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
    }
    return this.jwks;
  }

  /**
   * Devolve o payload de um token válido, ou lança.
   *
   * Falha fechado em tudo: assinatura inválida, expirado, emissor errado. Um erro
   * de verificação nunca vira "utilizador anónimo" — vira 401.
   */
  async verify(token: string): Promise<SupabaseUser> {
    const issuer = `${this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "")}/auth/v1`;

    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, this.keys, {
        issuer,
        // O Supabase emite `aud: "authenticated"` para sessões de utilizador.
        audience: "authenticated",
      }));
    } catch (error) {
      this.log.debug(`Token recusado: ${(error as Error).message}`);
      throw new UnauthorizedException("Sessão inválida ou expirada");
    }

    if (!payload.sub) throw new UnauthorizedException("Token sem identificação de utilizador");

    return {
      authId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  }
}

export type SupabaseUser = {
  /** `auth.users.id` no Supabase — o que `User.authId` espelha. */
  authId: string;
  email?: string;
};
