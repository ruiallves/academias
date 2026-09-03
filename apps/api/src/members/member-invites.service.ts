import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import { memberInviteEmail } from "../mail/mail.templates";
import { can, type RequestContext } from "../common/permissions";

/**
 * O convite que transforma uma ficha de sócio numa conta.
 *
 * ## Quando é que sai
 *
 * Foi decidido explicitamente: **na criação manual** (a direcção acabou de
 * inscrever o sócio, ele recebe logo o email para escolher password e instalar
 * a app) e **na aprovação** (quem aderiu pelo link do site recebe-o quando o
 * clube o aceita). Fora destes dois momentos há o botão na ficha — para os
 * sócios que já existiam antes disto, e para reenviar quando o email se perdeu.
 *
 * ## O que o token é
 *
 * 32 bytes aleatórios; na base fica só o **hash** (SHA-256), como nos convites
 * de staff — quem leia a base não reconstrói o link. Um convite por sócio de
 * cada vez: enviar outro substitui o anterior, e usar o link apaga-o.
 *
 * ## O que ele NÃO é
 *
 * Não é uma autorização aberta: o email da conta é sempre o da ficha, decidido
 * pelo clube. Quem apanhar o link só consegue criar (ou ligar) uma conta com
 * **esse** email — e se o email já tiver conta, tem de provar a password dela.
 */
@Injectable()
export class MemberInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * O interruptor geral dos convites de sócio.
   *
   * **Desligado por omissão, de propósito.** A app de sócio está pronta mas o
   * clube ainda não quer avisar ninguém — e o defeito seguro de um sistema que
   * manda correio em nome de outra pessoa é não mandar. Sem a variável de
   * ambiente, nenhum email sai: nem o automático da inscrição, nem o da
   * aprovação, nem o botão da ficha.
   *
   * Para ligar: `MEMBER_INVITES_ENABLED=true` no ambiente (Railway em produção,
   * `.env` em desenvolvimento) e reiniciar. Nada mais tem de mudar — o resto do
   * caminho (token, resgate, ligação da ficha à conta) está inteiro e testado.
   */
  private get activo(): boolean {
    return (this.config.get<string>("MEMBER_INVITES_ENABLED") ?? "").trim().toLowerCase() === "true";
  }

  /** O botão na ficha — com resposta a sério, para a consola mostrar o resultado. */
  async enviar(ctx: RequestContext, memberId: string) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para gerir sócios");

    /*
     * Recusa-se com uma frase, e não em silêncio: quem carrega no botão tem de
     * saber que não saiu nada — um botão que finge ter enviado é pior do que um
     * botão desligado.
     */
    if (!this.activo) {
      throw new BadRequestException(
        "Os convites para a app de sócio estão desligados de momento. Fala com a Academias para os activar.",
      );
    }

    const preparado = await this.preparar(ctx.academyId, memberId);
    if (!preparado.ok) throw new BadRequestException(preparado.reason);

    const enviado = await this.mandarEmail(preparado);
    if (!enviado.sent) {
      throw new BadRequestException(enviado.reason ?? "Não foi possível enviar o email.");
    }
    return { ok: true as const, email: preparado.email };
  }

  /**
   * Os ganchos automáticos — criação manual e aprovação.
   *
   * Silencioso de propósito: um email que falha não pode fazer falhar a
   * inscrição de um sócio, e a consola tem o botão de reenviar. Falha para o
   * log, sucesso para o carimbo `inviteSentAt`.
   */
  async enviarSePossivel(academyId: string, memberId: string): Promise<void> {
    /*
     * Sai antes de tocar na base: sem isto, a inscrição continuava a gerar (e a
     * gravar) um token de convite que ninguém receberia — um segredo criado por
     * nada, e um `inviteSentAt` a mentir na ficha.
     */
    if (!this.activo) return;

    try {
      const preparado = await this.preparar(academyId, memberId);
      if (!preparado.ok) return;
      await this.mandarEmail(preparado);
    } catch {
      /* O log do MailClient conta a história; o fluxo que nos chamou não pára. */
    }
  }

  /**
   * Ligar a ficha a uma conta que já existe, sem mandar nada.
   *
   * ## Porque é que isto existe à parte do convite
   *
   * Porque ligar e convidar eram o mesmo gesto, e no dia em que os emails foram
   * desligados o produto ficou sem forma nenhuma de dar a área de sócio a
   * alguém — nem a quem já tem conta e está a olhar para a app. Duas coisas
   * diferentes coladas numa: o convite **cria** a conta (e por isso manda
   * email); isto só **reconhece** uma que já lá está.
   *
   * ## Porque é que ligar por email não repete a pergunta que já se fez
   *
   * A escolha foi convite e não emparelhamento automático — e continua a ser:
   * isto não acontece sozinho. É a direcção, com `member:write`, a olhar para
   * uma ficha e a carregar num botão que diz de quem é a conta. O email é a
   * prova de que estão a falar da mesma pessoa; quem decide é quem carrega.
   *
   * A conta tem de já ter vínculo **nesta academia** — é o que a política de
   * `User` deixa ver de dentro do tenant, e é também a garantia que interessa:
   * não se liga uma ficha a uma conta que nada tem que ver com este clube.
   */
  async ligarConta(ctx: RequestContext, memberId: string) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para gerir sócios");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id: memberId },
        select: { id: true, name: true, email: true, userId: true },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");
      if (member.userId) throw new BadRequestException("Esta ficha já está ligada a uma conta.");
      if (!member.email) {
        throw new BadRequestException("A ficha não tem email — é por ele que se encontra a conta.");
      }

      const user = await db.user.findFirst({
        where: { email: member.email.trim().toLowerCase() },
        select: { id: true, name: true, email: true },
      });
      if (!user) {
        throw new BadRequestException(
          `Não há nenhuma conta com ${member.email} neste clube. Quando os convites forem ligados, é por aí que ela nasce.`,
        );
      }

      /*
       * Uma conta, uma ficha por clube — o índice único diz o mesmo, mas a
       * mensagem daqui explica o que fazer em vez de mostrar um erro do Postgres.
       */
      const jaTem = await db.member.findFirst({
        where: { userId: user.id },
        select: { number: true, name: true },
      });
      if (jaTem) {
        throw new BadRequestException(
          `Essa conta já é o sócio n.º ${jaTem.number ?? "—"} (${jaTem.name}). Uma conta tem uma ficha por clube.`,
        );
      }

      await db.member.update({
        where: { id: member.id },
        /* O convite pendente perde o sentido — a ficha já tem dono. */
        data: { userId: user.id, inviteTokenHash: null },
      });

      return { ok: true as const, email: user.email, name: user.name };
    });
  }

  /**
   * Desligar — para quando se ligou a ficha errada.
   *
   * Não apaga nada do sócio: tira-lhe o acesso à área de sócio na app e mais
   * nada. Sem isto, um clique enganado ficava sem desfazer.
   */
  async desligarConta(ctx: RequestContext, memberId: string) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para gerir sócios");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({ where: { id: memberId }, select: { id: true, userId: true } });
      if (!member) throw new NotFoundException("Sócio não encontrado");
      if (!member.userId) throw new BadRequestException("Esta ficha não está ligada a nenhuma conta.");

      await db.member.update({ where: { id: member.id }, data: { userId: null } });
      return { ok: true as const };
    });
  }

  /* ------------------------------------------------------------------------ */

  private async preparar(academyId: string, memberId: string) {
    return this.prisma.runAs(academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id: memberId },
        select: { id: true, name: true, email: true, userId: true },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      if (member.userId) {
        return { ok: false as const, reason: "Este sócio já tem conta ligada." };
      }
      if (!member.email) {
        return { ok: false as const, reason: "A ficha não tem email — acrescenta-o primeiro." };
      }
      if (!this.mail.ready) {
        return { ok: false as const, reason: "O envio de emails ainda não está configurado no servidor." };
      }

      const token = randomBytes(32).toString("base64url");
      await db.member.update({
        where: { id: member.id },
        data: {
          inviteTokenHash: createHash("sha256").update(token).digest("hex"),
          inviteSentAt: new Date(),
        },
      });

      const academy = await db.academy.findFirst({
        where: { id: academyId },
        select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
      });

      return {
        ok: true as const,
        token,
        email: member.email,
        name: member.name,
        academy,
      };
    });
  }

  /** Fora de qualquer transacção — HTTP nunca entra num `runAs`. */
  private async mandarEmail(p: {
    token: string;
    email: string;
    name: string;
    academy: { slug: string; name: string; shortName: string; signalColor: string; logoUrl: string | null } | null;
  }) {
    const brand = {
      shortName: p.academy?.shortName ?? "Academia",
      name: p.academy?.name ?? "o clube",
      signalColor: p.academy?.signalColor,
      logoUrl: p.academy?.logoUrl,
    };
    const mail = memberInviteEmail({ brand, name: p.name, link: this.linkFor(p.academy?.slug ?? "", p.token) });
    return this.mail.send({
      to: p.email,
      toName: p.name,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      kind: "member-invite",
    });
  }

  /** O mesmo desenho do link das famílias — ver `FamilyInvitesService.linkFor`. */
  private linkFor(slug: string, token: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/socio/${token}`;
    return `http://localhost:3000/l/${slug}/socio/${token}`;
  }
}
