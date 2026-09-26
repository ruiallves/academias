import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { MailClient } from "./mail.client";
import { areaAbertaEmail } from "./mail.templates";

/** As áreas que se abrem numa conta que já existia. */
export type AreaNova = "member" | "athlete" | "family";

/**
 * Avisar alguém de que lhe abriu uma área nova na app — sem convite, porque a
 * conta já existe.
 *
 * ## Porque é que isto é um serviço e não três linhas em cada sítio
 *
 * Porque são quatro sítios (sócio criado, sócio importado, sócio com email
 * novo, atleta ligado, família acrescentada) e o mais fácil de errar é sempre o
 * mesmo: **mandar o email antes de a escrita estar garantida**. Uma importação
 * de trezentos sócios que rebenta na última linha volta tudo atrás, e o correio
 * já não volta. Quem chama tem de guardar quem ligou e chamar isto **depois** da
 * transacção — todos os chamadores estão escritos assim, e o `void` à frente é a
 * marca de que a resposta ao clube não espera pelo Resend.
 *
 * ## O que não faz
 *
 * Não avisa quando é a **própria pessoa** a fazer a ligação acontecer, abrindo a
 * app (`contexts`). Escrever a alguém que está a olhar para o ecrã a dizer-lhe o
 * que tem no ecrã não é um aviso. Por isso é chamado dos caminhos da consola e
 * nunca de dentro de `ligarFichaAConta` / `ligarAtletaAConta`, que servem os
 * dois lados.
 *
 * Nunca rebenta e nunca faz esperar: um email que falha não desfaz a inscrição
 * que acabou de entrar, e o clube tem sempre o botão de reenviar.
 */
@Injectable()
export class AreaAbertaService {
  private readonly log = new Logger(AreaAbertaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Um aviso. `pessoa.email` nulo é o caso normal de quem não o tem na conta —
   * sai daqui sem fazer nada.
   */
  async avisar(academyId: string, area: AreaNova, pessoa: { name: string; email: string | null }): Promise<void> {
    if (!this.mail.ready || !pessoa.email) return;

    try {
      const academy = await this.prisma.runAs(academyId, (db) =>
        db.academy.findFirst({
          where: { id: academyId },
          select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
        }),
      );

      const mail = areaAbertaEmail({
        brand: {
          shortName: academy?.shortName ?? "Academia",
          name: academy?.name ?? "o clube",
          signalColor: academy?.signalColor,
          logoUrl: academy?.logoUrl,
        },
        name: pessoa.name,
        area,
        link: this.appLink(academy?.slug ?? ""),
      });

      await this.mail.send({
        to: pessoa.email,
        toName: pessoa.name,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        kind: `area-aberta-${area}`,
      });
    } catch (error) {
      /* Fica no log e mais nada: ninguém fica sem área por causa de um email. */
      this.log.warn(`Não foi possível avisar da área ${area}: ${String(error)}`);
    }
  }

  /** Vários de uma vez — a importação. Em série, para o Resend não nos travar. */
  async avisarMuitos(academyId: string, area: AreaNova, pessoas: { name: string; email: string | null }[]): Promise<void> {
    for (const p of pessoas) await this.avisar(academyId, area, p);
  }

  /** O mesmo link do "o teu acesso foi aprovado" — ver `FamilyInvitesService`. */
  private appLink(slug: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/app/`;
    return "http://localhost:5174/";
  }
}
