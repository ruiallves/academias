import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Contas no Supabase Auth — criar uma, e provar que se é dono de outra.
 *
 * ## Porque é que isto é um serviço e não dois métodos privados
 *
 * Porque há dois sítios que precisam do mesmo: o resgate de um convite de staff e
 * o registo de uma família pelo link do clube. São fluxos diferentes com a mesma
 * pergunta no meio — *esta conta já existe, e quem está do outro lado é mesmo o
 * dono dela?* — e essa pergunta não pode ter duas respostas diferentes no mesmo
 * produto. Duplicada, divergia: um dos lados ganharia uma condição a mais e o
 * outro ficaria a aceitar o que o primeiro já recusa.
 *
 * ## O que nunca acontece aqui
 *
 * A password não é guardada, comparada nem registada. Vai directa para o Supabase,
 * que responde sim ou não. Nós ficamos com o `authId` — um identificador opaco — e
 * é só isso que atravessa a fronteira para o nosso lado.
 */

export type Account = {
  authId: string;
  /** A sessão, quando o caminho foi o de entrar. Serve para a app abrir já dentro. */
  accessToken?: string;
  refreshToken?: string;
};

@Injectable()
export class SupabaseAccountsService {
  constructor(private readonly config: ConfigService) {}

  private get url(): string {
    return this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
  }

  /**
   * Entrar com email e password.
   *
   * É o Supabase que valida — nunca vemos a password guardada. Falhar aqui é 403 e
   * não 404: a conta existe, quem está a tentar é que não provou ser o dono.
   */
  async signIn(email: string, password: string): Promise<Required<Account>> {
    const anon = this.config.getOrThrow<string>("SUPABASE_ANON_KEY");

    const res = await fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new ForbiddenException("Palavra-passe incorrecta");

    const body = (await res.json()) as {
      user?: { id?: string };
      access_token?: string;
      refresh_token?: string;
    };
    if (!body.user?.id || !body.access_token) {
      throw new ForbiddenException("Não foi possível confirmar a conta");
    }

    return { authId: body.user.id, accessToken: body.access_token, refreshToken: body.refresh_token ?? "" };
  }

  /**
   * Criar a conta.
   *
   * `email_confirm: true` porque quem chega aqui já provou o email de outra
   * maneira — abriu um link que só lhe foi enviado a ele, ou identificou um
   * educando com dados que só a família tem. Um segundo email de confirmação seria
   * cerimónia sem ganho, e mais um sítio onde o registo morre a meio.
   */
  async create(email: string, password: string, name: string): Promise<Account> {
    const key = this.config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY");

    const res = await fetch(`${this.url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name } }),
    });

    if (!res.ok) {
      // 422 com `email_exists` é o caso normal de quem já tinha conta e não se
      // lembra. Distingui-lo dá uma mensagem útil — "entra com a que já tens" — e
      // não revela nada que quem escreveu o email não pudesse descobrir na página
      // de recuperação de password.
      const body = (await res.json().catch(() => null)) as { error_code?: string; msg?: string } | null;
      if (res.status === 422 || /already/i.test(body?.msg ?? "")) {
        throw new ConflictException("Já existe uma conta com este email");
      }
      throw new BadRequestException("Não foi possível criar a conta");
    }

    const body = (await res.json()) as { id?: string };
    if (!body.id) throw new BadRequestException("O Supabase não devolveu a conta criada");
    return { authId: body.id };
  }

  /**
   * Criar, ou entrar se já existir.
   *
   * O caminho da família: quem se regista pode já ter conta — o pai que tem um
   * filho noutra academia do mesmo produto, ou que se registou e desistiu a meio.
   * Nesse caso a password escrita **tem de ser a dele**, e é ao verificá-la que se
   * prova que é ele. Sem essa prova, qualquer pessoa com o link e o NIF de uma
   * criança ganhava acesso à conta de outra pessoa.
   */
  async createOrSignIn(email: string, password: string, name: string): Promise<Account> {
    try {
      return await this.create(email, password, name);
    } catch (error) {
      if (error instanceof ConflictException) return this.signIn(email, password);
      throw error;
    }
  }
}
