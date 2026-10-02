import { Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createLocalJWKSet, createRemoteJWKSet, jwksCache, jwtVerify, type JWKSCacheInput, type JWTPayload } from "jose";

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
 * `createRemoteJWKSet` guarda as chaves em cache e volta a buscá-las de dez em
 * dez minutos, ou quando aparece um `kid` desconhecido — não é um pedido de rede
 * por cada verificação.
 *
 * ## "Não presta" e "não consegui ver" são respostas diferentes
 *
 * Eram a mesma: qualquer erro virava 401. E um 401 é o que diz às apps que a
 * sessão acabou — renovam o token, repetem o pedido, e se voltar a vir 401 põem
 * a pessoa na rua. Só que de dez em dez minutos as chaves vão buscar-se outra
 * vez ao Supabase, e bastava esse pedido falhar (um segundo de rede má entre
 * este servidor e o de lá) para **todos** os pedidos levarem 401 até ele voltar
 * a responder: tokens perfeitamente válidos, recusados por não haver com que os
 * conferir. Do lado de quem usa, era perder a sessão do nada, na consola e na
 * app ao mesmo tempo.
 *
 * Agora:
 *
 *  - o token é que está mal (expirado, assinatura errada, emissor errado, chave
 *    que não é nossa) → **401**, como sempre;
 *  - não se conseguiu ir buscar as chaves → verifica-se com as **últimas que
 *    vieram**, que continuam a ser as certas;
 *  - e sem essas (o servidor acabou de arrancar e ainda não as viu) → **503**,
 *    que as apps tratam como avaria passageira e não como fim de sessão.
 *
 * Continua a falhar fechado: um token que não se conseguiu verificar nunca
 * passa. Só deixou de ser confundido com um token recusado.
 */
@Injectable()
export class SupabaseJwtService {
  private readonly log = new Logger(SupabaseJwtService.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  /**
   * As últimas chaves que o Supabase entregou.
   *
   * O `jose` escreve aqui cada vez que as vai buscar com sucesso (`jwks` e a
   * hora, `uat`). É o que permite verificar quando a ida seguinte falha.
   */
  private readonly cache: JWKSCacheInput = {};
  private reserva?: { uat: number; keys: ReturnType<typeof createLocalJWKSet> };
  /** Até quando não se volta a pedir as chaves: a última ida falhou. Ver `conferir`. */
  private semChavesAte = 0;

  constructor(private readonly config: ConfigService) {}

  private get keys() {
    if (!this.jwks) {
      const base = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
      this.jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`), { [jwksCache]: this.cache });
    }
    return this.jwks;
  }

  /** As últimas chaves boas, prontas a verificar. Nulo se ainda não veio nenhuma. */
  private get chavesDeReserva() {
    const { jwks, uat } = this.cache as { jwks?: Parameters<typeof createLocalJWKSet>[0]; uat?: number };
    if (!jwks || typeof uat !== "number") return null;
    if (this.reserva?.uat !== uat) this.reserva = { uat, keys: createLocalJWKSet(jwks) };
    return this.reserva.keys;
  }

  /**
   * Devolve o payload de um token válido, ou lança.
   *
   * Falha fechado em tudo: assinatura inválida, expirado, emissor errado. Um erro
   * de verificação nunca vira "utilizador anónimo" — vira 401, ou 503 quando o
   * que falhou foi a ida às chaves (ver o cabeçalho).
   */
  async verify(token: string): Promise<SupabaseUser> {
    const payload = await this.conferir(token);

    if (!payload.sub) throw new UnauthorizedException("Token sem identificação de utilizador");

    return {
      authId: payload.sub,
      email: typeof payload.email === "string" ? payload.email : undefined,
    };
  }

  /** O payload de um token que se conseguiu verificar. Lança 401 ou 503. */
  private async conferir(token: string): Promise<JWTPayload> {
    const issuer = `${this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "")}/auth/v1`;
    // O Supabase emite `aud: "authenticated"` para sessões de utilizador.
    const regras = { issuer, audience: "authenticated" };
    const semResposta = () =>
      new ServiceUnavailableException("Não foi possível verificar a sessão agora. Tenta outra vez daqui a pouco.");

    /*
     * Com chaves em reserva e uma ida falhada há pouco, não se volta a tentar a
     * cada pedido: uma ida que não responde pode custar cinco segundos, e todos
     * os pedidos ficavam à espera dela para depois usarem a reserva na mesma.
     */
    if (!this.chavesDeReserva || Date.now() >= this.semChavesAte) {
      try {
        return (await jwtVerify(token, this.keys, regras)).payload;
      } catch (error) {
        if (eDoToken(error)) throw this.recusado(error);

        // Não foi o token: foi a ida às chaves. Vale o que já cá estava.
        this.semChavesAte = Date.now() + PAUSA_MS;
        const motivo = (error as Error).message;
        if (!this.chavesDeReserva) {
          this.log.warn(`Chaves do Supabase indisponíveis e nenhuma em reserva: ${motivo}`);
          throw semResposta();
        }
        this.log.warn(`Chaves do Supabase indisponíveis (${motivo}); a verificar com as últimas conhecidas`);
      }
    }

    try {
      return (await jwtVerify(token, this.chavesDeReserva!, regras)).payload;
    } catch (error) {
      /*
       * Uma chave que a reserva não conhece pode ser uma chave nova que não se
       * conseguiu ir buscar: não se sabe, e "não sei" é 503. Tudo o resto —
       * expirado, assinatura errada — é o token, e é 401.
       */
      if (codigo(error) === "ERR_JWKS_NO_MATCHING_KEY") throw semResposta();
      throw this.recusado(error);
    }
  }

  private recusado(error: unknown): UnauthorizedException {
    this.log.debug(`Token recusado: ${(error as Error).message}`);
    return new UnauthorizedException("Sessão inválida ou expirada");
  }
}

/** Quanto tempo se espera antes de voltar a pedir as chaves, depois de uma ida falhada. */
const PAUSA_MS = 30_000;

const codigo = (error: unknown): string =>
  typeof (error as { code?: unknown } | null)?.code === "string" ? (error as { code: string }).code : "";

/**
 * O erro é sobre o token, e não sobre a ida às chaves.
 *
 * O `jose` marca os seus erros com um código. Os de token (`ERR_JWT_*`,
 * `ERR_JWS_*`, algoritmo recusado, chave que não está no conjunto) são
 * definitivos: repetir não muda nada. Tudo o resto — tempo esgotado, resposta
 * que não é 200, ligação recusada, um erro sem código nenhum — é a rede ou o
 * Supabase, e passa.
 */
function eDoToken(error: unknown): boolean {
  return /^ERR_(JWT_|JWS_|JOSE_ALG_NOT_ALLOWED|JOSE_NOT_SUPPORTED|JWKS_NO_MATCHING_KEY|JWKS_MULTIPLE_MATCHING_KEYS)/.test(codigo(error));
}

export type SupabaseUser = {
  /** `auth.users.id` no Supabase — o que `User.authId` espelha. */
  authId: string;
  email?: string;
};
