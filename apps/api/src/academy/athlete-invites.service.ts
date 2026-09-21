import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import { athleteInviteEmail } from "../mail/mail.templates";
import { SupabaseAccountsService } from "../auth/supabase-accounts.service";
import { LegalService } from "../legal/legal.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * O convite que transforma uma ficha de atleta numa conta — a área de atleta
 * da app do clube.
 *
 * ## O mesmo desenho dos sócios, de propósito
 *
 * Foi pedido assim: o atleta recebe o convite **por email** quando a ficha é
 * criada com email, quando é importada com email, e quando alguém carrega em
 * "Enviar convite" na ficha ou na lista. Um clube que já aprendeu como os
 * sócios entram na app não tem de aprender outra coisa para os atletas — é o
 * mesmo email, o mesmo link, o mesmo ecrã de escolher a palavra-passe.
 *
 * ## O que muda em relação ao sócio
 *
 * A ligação não é um `userId` na ficha: é uma **`Membership` de papel
 * `ATHLETE`**, apontada por `Athlete.accountMembershipId`. O atleta entra
 * pelo guard como a família — âmbito, permissões e gate legal resolvem-se
 * pela membership — e o `scopeFor` estreita-lhe a leitura ao próprio.
 *
 * E **não há ligação automática pelo email**. Nos sócios há: a ficha com o
 * email de uma conta do clube cola-se a essa conta. Num atleta seria um
 * problema real — muitos clubes escrevem o email do pai na ficha do filho, e
 * a conta do pai ganharia uma área "Atleta" com a ficha do miúdo. A conta de
 * atleta nasce só do convite, que é um gesto explícito de quem o abre.
 *
 * ## O token
 *
 * 32 bytes aleatórios; na base fica o **hash** (SHA-256). Um convite por
 * atleta de cada vez: enviar outro substitui o anterior, e usar o link
 * apaga-o. O email da conta é sempre o da ficha — quem apanhar o link só cria
 * (ou liga) uma conta com **esse** email, e se ele já tiver conta tem de
 * provar a palavra-passe dela.
 */
@Injectable()
export class AthleteInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
    private readonly accounts: SupabaseAccountsService,
    private readonly legal: LegalService,
  ) {}

  /**
   * O interruptor. Ao contrário dos sócios, nasce **ligado**: os convites de
   * atleta foram pedidos a funcionar desde o primeiro dia. `ATHLETE_INVITES_ENABLED=false`
   * desliga-os num ambiente onde não se queira correio a sair.
   */
  private get activo(): boolean {
    return (this.config.get<string>("ATHLETE_INVITES_ENABLED") ?? "true").trim().toLowerCase() !== "false";
  }

  /** O botão na ficha — com resposta a sério, para a consola mostrar o resultado. */
  async enviar(ctx: RequestContext, athleteId: string) {
    this.assertMayInvite(ctx);
    if (!this.activo) throw new BadRequestException(DESLIGADO);

    const preparado = await this.preparar(ctx.academyId, athleteId);
    if (!preparado.ok) throw new BadRequestException(preparado.reason);

    const enviado = await this.mandarEmail(preparado);
    if (!enviado.sent) throw new BadRequestException(enviado.reason ?? "Não foi possível enviar o email.");
    return { ok: true as const, email: preparado.email };
  }

  /**
   * Os ganchos automáticos — inscrição à mão e importação.
   *
   * Silencioso de propósito: um email que falha não pode fazer falhar a
   * inscrição de um atleta, e a consola tem o botão de reenviar. Sai antes de
   * tocar na base quando está desligado, para não gerar um token que ninguém
   * recebe.
   */
  async enviarSePossivel(academyId: string, athleteId: string): Promise<void> {
    if (!this.activo) return;
    try {
      const preparado = await this.preparar(academyId, athleteId);
      if (!preparado.ok) return;
      await this.mandarEmail(preparado);
    } catch {
      /* O log do MailClient conta a história; o fluxo que nos chamou não pára. */
    }
  }

  /**
   * O convite para muitos de uma vez — a lista de atletas, com linhas escolhidas.
   * Devolve a contagem por motivo em vez de rebentar no primeiro que não dá;
   * em série, para o fornecedor de correio não nos limitar. Ver o equivalente
   * dos sócios para o porquê de cada escolha.
   */
  async enviarMuitos(ctx: RequestContext, ids: string[]) {
    this.assertMayInvite(ctx);
    if (!this.activo) throw new BadRequestException(DESLIGADO);
    if (ids.length === 0) throw new BadRequestException("Não escolheste nenhum atleta");

    let enviados = 0;
    const falhas: { id: string; reason: string }[] = [];

    for (const id of [...new Set(ids)]) {
      try {
        const preparado = await this.preparar(ctx.academyId, id);
        if (!preparado.ok) {
          falhas.push({ id, reason: preparado.reason });
          continue;
        }
        const enviado = await this.mandarEmail(preparado);
        if (enviado.sent) enviados++;
        else falhas.push({ id, reason: enviado.reason ?? "Não foi possível enviar o email." });
      } catch {
        falhas.push({ id, reason: "Não foi possível enviar o email." });
      }
    }

    return { ok: true as const, enviados, falhas };
  }

  /**
   * Desligar a conta — para quando a ficha se ligou à pessoa errada.
   *
   * Não apaga o atleta nem a conta: tira a ligação e desactiva a membership de
   * atleta, e a área desaparece da app dessa pessoa. Um convite novo volta a
   * ligar a ficha a quem o abrir.
   */
  async desligarConta(ctx: RequestContext, athleteId: string) {
    this.assertMayInvite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const athlete = await db.athlete.findFirst({
        where: { id: athleteId },
        select: { id: true, accountMembershipId: true },
      });
      if (!athlete) throw new NotFoundException("Atleta não encontrado");
      if (!athlete.accountMembershipId) throw new BadRequestException("Esta ficha não está ligada a nenhuma conta.");

      await db.athlete.update({ where: { id: athlete.id }, data: { accountMembershipId: null } });
      await db.membership.update({ where: { id: athlete.accountMembershipId }, data: { isActive: false } });
      return { ok: true as const };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* O resgate — sem sessão                                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * De que clube — e de quem — é este convite. O primeiro pedido da app.
   * Devolve o nome próprio, o clube e o email meio tapado, e mais nada.
   */
  async convitePreview(token: string) {
    const alvo = await this.resolverConvite(token);

    return this.prisma.runAs(alvo.academyId, async (db) => {
      const [athlete, academy] = await Promise.all([
        db.athlete.findFirst({
          where: { id: alvo.athleteId },
          select: { name: true, email: true, accountMembershipId: true, teams: { where: { leftAt: null }, select: { team: { select: { name: true } } }, take: 1 } },
        }),
        db.academy.findFirst({
          where: { id: alvo.academyId },
          select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
        }),
      ]);
      if (!athlete || !academy) throw new NotFoundException(INVALIDO);

      return {
        academy,
        firstName: athlete.name.trim().split(/\s+/)[0] ?? "",
        team: athlete.teams[0]?.team.name ?? null,
        emailHint: mascarar(athlete.email ?? ""),
        alreadyLinked: Boolean(athlete.accountMembershipId),
      };
    });
  }

  /**
   * Criar a conta (ou entrar na que já existe) e ligá-la à ficha.
   *
   * A ordem é a do registo das famílias: os termos antes da conta (a conta no
   * Supabase não entra em rollback nenhum); depois, tudo junto, o `User`, a
   * `Membership` de atleta, a ligação na ficha e as aceitações.
   */
  async conviteRegistar(
    token: string,
    password: string,
    acceptLegal: boolean | undefined,
    meta: { ip?: string; userAgent?: string } = {},
  ) {
    if (!password || password.length < 8) {
      throw new BadRequestException("A palavra-passe tem de ter pelo menos 8 caracteres");
    }

    const alvo = await this.resolverConvite(token);

    const dados = await this.prisma.runAs(alvo.academyId, async (db) => {
      const athlete = await db.athlete.findFirst({
        where: { id: alvo.athleteId },
        select: { id: true, name: true, email: true, accountMembershipId: true },
      });
      const academy = await db.academy.findFirst({ where: { id: alvo.academyId }, select: { slug: true, name: true } });
      if (!athlete || !academy) throw new NotFoundException(INVALIDO);
      if (!athlete.email) throw new BadRequestException("Esta ficha não tem email — fala com o clube");
      if (athlete.accountMembershipId) throw new BadRequestException("Esta ficha já tem conta ligada. Entra com ela.");
      return { athlete: { ...athlete, email: athlete.email }, academy };
    });

    // Os atletas aceitam os documentos das famílias — ver `LegalAudience.FAMILY`.
    const docs = await this.legal.assertSignupConsent(["FAMILY"], { acceptLegal }, alvo.academyId);

    const email = dados.athlete.email.trim().toLowerCase();
    const account = await this.accounts.createOrSignIn(email, password, dados.athlete.name);

    await this.prisma.runAs(alvo.academyId, async (db) => {
      /* A mesma escotilha do registo das famílias — ver a nota lá. */
      const userId = `usr_${randomBytes(12).toString("hex")}`;
      const created = await db.$queryRaw<{ id: string }[]>`
        SELECT app.upsert_invited_user(
          ${userId}, ${account.authId}, ${email}, ${dados.athlete.name}, ${null}
        ) AS id
      `;

      const membership = await db.membership.upsert({
        where: { academyId_userId_role: { academyId: alvo.academyId, userId: created[0].id, role: "ATHLETE" } },
        update: { isActive: true },
        create: { academyId: alvo.academyId, userId: created[0].id, role: "ATHLETE" },
        select: { id: true },
      });

      await db.athlete.update({
        where: { id: dados.athlete.id },
        data: {
          accountMembershipId: membership.id,
          /* O convite morre ao ser usado — um link reencaminhado depois disto
             não liga nada. */
          inviteTokenHash: null,
        },
      });

      await this.legal.acceptAtSignup(
        db,
        { userId: created[0].id, academyId: alvo.academyId, membershipId: membership.id, audiences: ["FAMILY"] },
        docs,
        meta,
      );
    });

    const session = account.accessToken ? account : await this.accounts.signIn(email, password);

    return {
      slug: dados.academy.slug,
      academyName: dados.academy.name,
      athlete: dados.athlete.name,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken ?? null,
    };
  }

  /* ------------------------------------------------------------------------ */

  /**
   * Quem convida: quem gere o acesso das famílias. A conta de um atleta —
   * muitas vezes menor — é um acto administrativo, não de treino.
   */
  private assertMayInvite(ctx: RequestContext): void {
    if (!can(ctx, "family:write")) throw new ForbiddenException("Sem permissão para gerir o acesso à app");
  }

  private async preparar(academyId: string, athleteId: string) {
    return this.prisma.runAs(academyId, async (db) => {
      const athlete = await db.athlete.findFirst({
        where: { id: athleteId },
        select: { id: true, name: true, email: true, accountMembershipId: true, account: { select: { isActive: true } } },
      });
      if (!athlete) throw new NotFoundException("Atleta não encontrado");

      if (athlete.accountMembershipId && athlete.account?.isActive) {
        return { ok: false as const, reason: "Este atleta já tem conta ligada." };
      }
      if (!athlete.email) {
        return { ok: false as const, reason: "A ficha não tem email — acrescenta-o primeiro." };
      }
      if (!this.mail.ready) {
        return { ok: false as const, reason: "O envio de emails ainda não está configurado no servidor." };
      }

      const token = randomBytes(32).toString("base64url");
      await db.athlete.update({
        where: { id: athlete.id },
        data: {
          inviteTokenHash: createHash("sha256").update(token).digest("hex"),
          inviteSentAt: new Date(),
        },
      });

      const academy = await db.academy.findFirst({
        where: { id: academyId },
        select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
      });

      return { ok: true as const, token, email: athlete.email, name: athlete.name, academy };
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
    const mail = athleteInviteEmail({ brand, name: p.name, link: this.linkFor(p.academy?.slug ?? "", p.token) });
    return this.mail.send({
      to: p.email,
      toName: p.name,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      kind: "athlete-invite",
    });
  }

  /** O mesmo desenho do link das famílias e dos sócios. */
  private linkFor(slug: string, token: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/atleta/${token}`;
    return `http://localhost:3000/l/${slug}/atleta/${token}`;
  }

  /** Do token para (atleta, academia) — pela escotilha, porque ainda não há sessão. */
  private async resolverConvite(token: string): Promise<{ athleteId: string; academyId: string }> {
    if (!token || token.length < 16) throw new NotFoundException(INVALIDO);
    const hash = createHash("sha256").update(token).digest("hex");
    const rows = await this.prisma.$queryRaw<{ athlete_id: string; academy_id: string }[]>`
      SELECT * FROM app.resolve_athlete_invite(${hash})
    `;
    if (!rows[0]) throw new NotFoundException(INVALIDO);
    return { athleteId: rows[0].athlete_id, academyId: rows[0].academy_id };
  }
}

const INVALIDO = "Convite inválido ou expirado";
const DESLIGADO = "Os convites para a app de atleta estão desligados de momento.";

/** `rui.alves@mail.pt` → `r••@mail.pt` — reconhecível para o dono, mudo para os outros. */
function mascarar(email: string): string {
  const [antes, dominio] = email.split("@");
  if (!antes || !dominio) return "";
  return `${antes[0]}••@${dominio}`;
}
