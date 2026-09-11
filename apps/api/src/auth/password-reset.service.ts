import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LandingService } from "../landing/landing.service";
import { MailClient } from "../mail/mail.client";
import { passwordResetEmail } from "../mail/mail.templates";
import { SupabaseAccountsService } from "./supabase-accounts.service";

/**
 * De onde veio o pedido — decide para onde a página manda a pessoa depois.
 *
 * `console` é o login da página do clube, `family` o login da app, `invite` um
 * convite a meio (staff, família ou sócio). Ver `password-reset.template.ts`.
 */
export type ResetOrigin = "console" | "family" | "invite";

/*
 * Um email por endereço por minuto.
 *
 * O limite por IP do controlador trava quem martela a partir de um sítio; este
 * trava quem enche a caixa de correio de uma pessoa a partir de muitos. Em
 * memória, e chega: reiniciar o servidor esquece-o, e o pior que isso dá é um
 * email a mais.
 */
const INTERVALO_MS = 60_000;

/**
 * Repor a palavra-passe.
 *
 * ## A resposta é sempre a mesma
 *
 * Exista a conta ou não, quem pede recebe "se houver conta, vai um email". E o
 * trabalho corre **depois** da resposta, não antes: esperar pelo Supabase e pelo
 * serviço de email só quando a conta existe fazia o tempo de resposta dizer o que
 * o texto não diz.
 *
 * ## Qualquer conta, e não só as deste clube
 *
 * Não se confirma se a conta pertence ao clube onde foi pedido. Parece que
 * devia, e não protegia nada: o `/recover` do Supabase é público e faz o mesmo sem
 * clube nenhum. E partia casos reais — o treinador de outro clube convidado para
 * este, que ainda não tem vínculo aqui; o sócio acabado de inscrever. O email só
 * chega à caixa do dono da conta, e sem ele carregar no link nada muda.
 */
@Injectable()
export class PasswordResetService {
  private readonly log = new Logger(PasswordResetService.name);
  private readonly recentes = new Map<string, number>();

  constructor(
    private readonly config: ConfigService,
    private readonly landing: LandingService,
    private readonly accounts: SupabaseAccountsService,
    private readonly mail: MailClient,
  ) {}

  /** Aceita o pedido e responde já. O envio segue sozinho — ver o cabeçalho. */
  request(email: string, slug: string, from: ResetOrigin): void {
    const endereco = email.trim().toLowerCase();
    if (this.aindaRecente(endereco)) return;

    void this.enviar(endereco, slug, from).catch((error) => {
      this.log.warn(`Repor palavra-passe para ${endereco} falhou: ${String(error)}`);
    });
  }

  private aindaRecente(email: string): boolean {
    const agora = Date.now();
    for (const [chave, quando] of this.recentes) {
      if (agora - quando > INTERVALO_MS) this.recentes.delete(chave);
    }
    if (this.recentes.has(email)) return true;
    this.recentes.set(email, agora);
    return false;
  }

  private async enviar(email: string, slug: string, from: ResetOrigin): Promise<void> {
    const academy = await this.landing.findBySlug(slug);
    if (!academy) return;

    const token = await this.accounts.recoveryToken(email);
    if (!token) return;

    const mail = passwordResetEmail({
      brand: {
        shortName: academy.shortName,
        name: academy.name,
        signalColor: academy.signalColor,
        logoUrl: academy.logoUrl,
      },
      link: `${this.baseFor(slug)}/repor-palavra-passe#t=${encodeURIComponent(token)}&a=${from}`,
    });

    const result = await this.mail.send({ to: email, ...mail, kind: "password-reset" });
    if (!result.sent) this.log.warn(`Email de repor palavra-passe não saiu para ${email}: ${result.reason}`);
  }

  /** O endereço do clube — o mesmo desenho dos convites (ver `InvitesService.linkFor`). */
  private baseFor(slug: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return base.replace(/\/$/, "").replace("{slug}", slug);
    return `http://localhost:3000/l/${slug}`;
  }
}
