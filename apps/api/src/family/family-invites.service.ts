import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseAccountsService } from "../auth/supabase-accounts.service";
import { MailClient } from "../mail/mail.client";
import { familyInviteEmail } from "../mail/mail.templates";
import { can, type RequestContext } from "../common/permissions";

/**
 * O link que traz as famílias para a app.
 *
 * ## O desenho, numa frase
 *
 * O link diz *"esta academia está a aceitar famílias"*; o **NIF mais a data de
 * nascimento** dizem *"e tu és pai deste"*. São duas perguntas separadas de
 * propósito, e é a separação que faz o link poder ser partilhado.
 *
 * ## Porque é que não é um convite por família
 *
 * Porque a secretaria não tem tempo para gerar duzentos links, e porque um link
 * por família seria um link por família a perder-se. O que se manda é uma coisa
 * só, ao grupo de WhatsApp dos pais, e cada um entra com o que já sabe: o número
 * de contribuinte do filho e a data em que ele nasceu.
 *
 * O reencaminhamento deixa de ser um problema. Quem apanhar o link e não tiver os
 * dados de uma criança **desta** academia não fica ligado a ninguém — cria, quando
 * muito, uma conta sem educandos, que não vê nada.
 *
 * ## O que isto obriga a proteger
 *
 * O par NIF+data é adivinhável por força bruta se ninguém estiver a contar. Duas
 * defesas, e nenhuma delas opcional:
 *
 *  1. **Limite de tentativas** por IP nos dois endpoints públicos — no controlador,
 *     onde se vê.
 *  2. **A mesma resposta** para "não existe", "NIF certo e data errada" e "atleta
 *     que já saiu". Um "encontrámos o NIF mas a data não bate" transformaria isto
 *     num oráculo que confirma NIFs de crianças.
 */

/** As durações que a consola oferece. `null` é sem prazo — e é uma escolha, não um lapso. */
export const DURATIONS = [1, 7, 30] as const;

const DAY = 86_400_000;

export type FamilyInviteView = {
  id: string;
  link: string;
  expiresAt: Date | null;
  usedCount: number;
  lastUsedAt: Date | null;
  createdAt: Date;
  createdBy: string | null;
};

export type RegisterInput = {
  name: string;
  email: string;
  phone: string;
  password: string;
  relation: string;
  taxId: string;
  birthdate: string;
};

@Injectable()
export class FamilyInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: SupabaseAccountsService,
    private readonly config: ConfigService,
    private readonly mail: MailClient,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Do lado da academia                                                       */
  /* ------------------------------------------------------------------------ */

  /**
   * O link vivo, se existir.
   *
   * Devolve o token em claro — ao contrário dos convites de staff, que se mostram
   * uma vez e nunca mais. A razão está no modelo (`schema.prisma`): este link não
   * decide acessos, e a secretaria precisa de o poder copiar outra vez para o
   * mandar à família que entrou esta semana.
   */
  async current(ctx: RequestContext): Promise<FamilyInviteView | null> {
    if (!can(ctx, "family:read")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const invite = await db.familyInvite.findFirst({
        where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, token: true, expiresAt: true, usedCount: true, lastUsedAt: true, createdAt: true,
          createdBy: { select: { user: { select: { name: true } } } },
        },
      });
      if (!invite) return null;

      const academy = await db.academy.findFirst({ where: { id: ctx.academyId }, select: { slug: true } });
      return this.view(invite, academy?.slug ?? "");
    });
  }

  /**
   * Gerar um link novo.
   *
   * Fecha o anterior no mesmo passo. **Um vivo de cada vez** é a decisão que evita
   * a situação em que ninguém sabe quantas portas estão abertas nem quem tem qual —
   * e é a que torna "trocar o link" uma operação com significado.
   */
  async create(ctx: RequestContext, days: number | null): Promise<FamilyInviteView> {
    if (!can(ctx, "family:write")) throw new ForbiddenException("Sem permissão para convidar famílias");

    if (days !== null && !DURATIONS.includes(days as (typeof DURATIONS)[number])) {
      throw new BadRequestException("Duração inválida");
    }

    const token = randomBytes(24).toString("base64url");
    const expiresAt = days === null ? null : new Date(Date.now() + days * DAY);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await db.familyInvite.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } });

      const invite = await db.familyInvite.create({
        data: { academyId: ctx.academyId, token, expiresAt, createdById: ctx.membershipId },
        select: {
          id: true, token: true, expiresAt: true, usedCount: true, lastUsedAt: true, createdAt: true,
          createdBy: { select: { user: { select: { name: true } } } },
        },
      });

      const academy = await db.academy.findFirst({ where: { id: ctx.academyId }, select: { slug: true } });
      return this.view(invite, academy?.slug ?? "");
    });
  }

  /**
   * Mandar o link vivo por email, a quem a secretaria disser.
   *
   * ## Porque é que isto não gera um link por família
   *
   * Porque continua a ser **o mesmo** link partilhado — o desenho descrito no topo
   * deste ficheiro não muda. O que muda é o carteiro: além do grupo de WhatsApp,
   * a secretaria pode agora escrever meia dúzia de endereços e o servidor entrega.
   * Um link por família traria de volta exactamente o problema que aquela decisão
   * evitou: duzentos links a perder-se.
   *
   * ## Um endereço que falha não estraga os outros
   *
   * Envia-se um a um e devolve-se a lista do que correu mal. Uma família com o
   * email mal escrito não pode impedir as outras dezanove de receber — e a
   * secretaria precisa de saber qual foi, para o corrigir.
   */
  async sendToFamilies(
    ctx: RequestContext,
    recipients: { email: string; name?: string | null }[],
  ): Promise<{ sent: number; failed: { email: string; reason: string }[] }> {
    if (!can(ctx, "family:write")) throw new ForbiddenException("Sem permissão para convidar famílias");
    if (recipients.length === 0) throw new BadRequestException("Não há para quem enviar");

    if (!this.mail.ready) {
      throw new BadRequestException("O envio de emails ainda não está configurado no servidor.");
    }

    // O link e a identidade do clube, numa leitura só — e antes de qualquer envio:
    // sem link vivo não há nada para mandar, e é melhor dizê-lo já.
    const invite = await this.prisma.runAs(ctx.academyId, async (db) => {
      const row = await db.familyInvite.findFirst({
        where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        orderBy: { createdAt: "desc" },
        select: { token: true, expiresAt: true },
      });
      if (!row) return null;

      const academy = await db.academy.findFirst({
        where: { id: ctx.academyId },
        select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
      });
      return { ...row, academy };
    });

    if (!invite) throw new BadRequestException("Não há nenhum link de convite aberto.");

    const link = this.linkFor(invite.academy?.slug ?? "", invite.token);
    const brand = {
      shortName: invite.academy?.shortName ?? "Academia",
      name: invite.academy?.name ?? "a academia",
      signalColor: invite.academy?.signalColor,
      logoUrl: invite.academy?.logoUrl,
    };

    const failed: { email: string; reason: string }[] = [];
    let sent = 0;

    for (const person of recipients) {
      const mail = familyInviteEmail({ brand, name: person.name, link, expiresAt: invite.expiresAt });
      const result = await this.mail.send({
        to: person.email,
        toName: person.name ?? undefined,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        kind: "family-invite",
      });

      if (result.sent) sent += 1;
      else failed.push({ email: person.email, reason: result.reason ?? "Não foi possível enviar." });
    }

    return { sent, failed };
  }

  /** Fechar a porta. O link deixa de resolver — `app.resolve_family_invite` já o exclui. */
  async revoke(ctx: RequestContext): Promise<{ ok: true }> {
    if (!can(ctx, "family:write")) throw new ForbiddenException("Sem permissão");

    await this.prisma.runAs(ctx.academyId, (db) =>
      db.familyInvite.updateMany({ where: { revokedAt: null }, data: { revokedAt: new Date() } }),
    );
    return { ok: true };
  }

  /* ------------------------------------------------------------------------ */
  /* Do lado da família — sem autenticação                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * De que clube é este link.
   *
   * É o que a app precisa de saber antes de mostrar seja o que for: o nome, a cor
   * e o slug da academia. Não revela nada sobre atletas nem sobre famílias — só a
   * identidade pública do clube, a mesma que está na landing.
   */
  async preview(token: string) {
    const academyId = await this.academyOf(token);

    return this.prisma.runAs(academyId, async (db) => {
      const academy = await db.academy.findFirst({
        where: { id: academyId },
        select: { slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
      });
      if (!academy) throw new NotFoundException("Convite inválido");

      const invite = await db.familyInvite.findFirst({
        where: { token },
        select: { expiresAt: true },
      });

      return {
        academy: { ...academy, mark: monogram(academy.shortName || academy.name) },
        expiresAt: invite?.expiresAt ?? null,
      };
    });
  }

  /**
   * "É este o teu filho?"
   *
   * Confirma o par NIF+data e devolve **o primeiro nome** e a equipa — o suficiente
   * para quem está do outro lado ter a certeza de que não se enganou num dígito,
   * e pouco de mais para servir de alguma coisa a quem esteja a sondar. O nome
   * completo, a idade exacta e tudo o resto ficam para depois de a conta existir.
   */
  async findAthlete(token: string, taxId: string, birthdate: string) {
    const academyId = await this.academyOf(token);
    const athleteId = await this.matchAthlete(academyId, taxId, birthdate);

    return this.prisma.runAs(academyId, async (db) => {
      const athlete = await db.athlete.findFirst({
        where: { id: athleteId },
        select: { name: true, teams: { select: { team: { select: { name: true } } }, take: 1 } },
      });
      if (!athlete) throw new NotFoundException(NOT_FOUND);

      return { firstName: athlete.name.trim().split(/\s+/)[0], team: athlete.teams[0]?.team.name ?? null };
    });
  }

  /**
   * Criar a conta do encarregado e ligá-la ao educando.
   *
   * A ordem importa e não é arbitrária:
   *
   *  1. **Resolver a academia e encontrar o atleta.** Falhar aqui não deixa rasto
   *     nenhum — nem conta criada, nem uso contado.
   *  2. **A conta no Supabase**, fora de qualquer transação: é um sistema externo
   *     e não participa em rollback nenhum. Se falhar, nada do nosso lado mudou.
   *  3. **O nosso lado**, tudo junto: `User`, `Membership` de encarregado,
   *     `GuardianLink` e o contador do convite.
   *
   * Tudo em `upsert`: um pai que já é encarregado de outro filho não cria uma
   * segunda membership, e voltar a registar o mesmo educando não parte nada — é o
   * que acontece quando alguém carrega duas vezes num telemóvel com rede fraca.
   */
  async register(token: string, dto: RegisterInput) {
    const academyId = await this.academyOf(token);

    const email = dto.email.trim().toLowerCase();
    if (!isEmail(email)) throw new BadRequestException("Email inválido");
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException("A palavra-passe tem de ter pelo menos 8 caracteres");
    }
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException("Falta o teu nome");

    const athleteId = await this.matchAthlete(academyId, dto.taxId, dto.birthdate);

    const account = await this.accounts.createOrSignIn(email, dto.password, name);

    const result = await this.prisma.runAs(academyId, async (db) => {
      /*
       * O `User` não se cria com o Prisma, pelo mesmo motivo do resgate de
       * convites: a política de `User` é "vejo-te se partilharmos academia", a
       * partilha ainda não existe, e o `INSERT ... RETURNING` do Prisma cai na
       * política. `app.upsert_invited_user` é a escotilha estreita para este passo.
       */
      const userId = `usr_${randomBytes(12).toString("hex")}`;
      const created = await db.$queryRaw<{ id: string }[]>`
        SELECT app.upsert_invited_user(
          ${userId}, ${account.authId}, ${email}, ${name}, ${dto.phone.trim() || null}
        ) AS id
      `;

      const membership = await db.membership.upsert({
        where: { academyId_userId_role: { academyId, userId: created[0].id, role: "GUARDIAN" } },
        update: { isActive: true },
        create: { academyId, userId: created[0].id, role: "GUARDIAN" },
        select: { id: true },
      });

      /*
       * Sem pagador designado.
       *
       * Havia um: o primeiro a registar-se ficava `isPayer` e era o único a
       * receber os avisos de cobrança. Assumia uma família com um responsável
       * financeiro — e a primeira pergunta que um clube fez foi sobre pais
       * separados, onde qualquer um paga. A marca saiu da base; os avisos vão
       * a todos os encarregados, e a cobrança continua a ser uma só.
       */
      await db.guardianLink.upsert({
        where: { athleteId_membershipId: { athleteId, membershipId: membership.id } },
        update: { relation: dto.relation.trim() || "Encarregado" },
        create: {
          athleteId,
          membershipId: membership.id,
          relation: dto.relation.trim() || "Encarregado",
        },
      });

      await db.familyInvite.updateMany({
        where: { token },
        data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
      });

      const academy = await db.academy.findFirst({ where: { id: academyId }, select: { slug: true, name: true } });
      const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { name: true } });

      return { slug: academy?.slug ?? "", academyName: academy?.name ?? "", athlete: athlete?.name ?? "" };
    });

    /*
     * A sessão volta com a resposta, e a app entra já dentro.
     *
     * Quem acabou de escrever a password não tem de a escrever outra vez num ecrã
     * de login — isso é um passo que só existe por preguiça do servidor, e é onde
     * se perde gente. Quando a conta já existia, o `signIn` do passo 2 trouxe os
     * tokens; quando foi criada agora, é preciso ir buscá-los.
     */
    const session = account.accessToken
      ? account
      : await this.accounts.signIn(email, dto.password);

    return {
      ...result,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken ?? null,
    };
  }

  /**
   * Acrescentar outro educando a quem já tem conta.
   *
   * Uma família com dois filhos no clube é o caso normal, não a excepção — a
   * própria app diz isso no seletor de educando. A prova é a mesma do registo:
   * NIF e data de nascimento. Ter conta não dá direito a reclamar crianças.
   */
  async addChild(ctx: RequestContext, taxId: string, birthdate: string) {
    if (ctx.role !== "GUARDIAN") throw new ForbiddenException("Só encarregados de educação");

    const athleteId = await this.matchAthlete(ctx.academyId, taxId, birthdate);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      await db.guardianLink.upsert({
        where: { athleteId_membershipId: { athleteId, membershipId: ctx.membershipId } },
        update: {},
        create: { athleteId, membershipId: ctx.membershipId, relation: "Encarregado" },
      });

      const athlete = await db.athlete.findFirst({ where: { id: athleteId }, select: { id: true, name: true } });
      return { athlete };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Peças internas                                                            */
  /* ------------------------------------------------------------------------ */

  /**
   * Do token para a academia, pela escotilha.
   *
   * A mesma resposta para "não existe", "expirou" e "foi fechado". Distingui-las
   * só ajudaria quem estivesse a sondar tokens à sorte.
   */
  private async academyOf(token: string): Promise<string> {
    if (!token || token.length < 16) throw new NotFoundException("Convite inválido ou expirado");

    const rows = await this.prisma.$queryRaw<{ academy: string | null }[]>`
      SELECT app.resolve_family_invite(${token}) AS academy
    `;
    const academyId = rows[0]?.academy;
    if (!academyId) throw new NotFoundException("Convite inválido ou expirado");
    return academyId;
  }

  /**
   * O educando, pelas duas provas.
   *
   * `app.match_athlete_for_family` devolve **um id ou nada** — não lista, não
   * pesquisa por nome, não confirma um NIF sem a data. Ver a migração
   * `20260822000000_family_invites`.
   *
   * A mensagem de erro é a mesma para todos os enganos possíveis, e é essa
   * indiferença que impede isto de servir para confirmar NIFs de crianças.
   */
  private async matchAthlete(academyId: string, taxId: string, birthdate: string): Promise<string> {
    const nif = (taxId ?? "").replace(/\s/g, "");
    if (!/^\d{9}$/.test(nif)) throw new BadRequestException("O NIF tem nove dígitos");

    const date = new Date(birthdate);
    if (Number.isNaN(date.getTime())) throw new BadRequestException("Data de nascimento inválida");

    const rows = await this.prisma.$queryRaw<{ athlete: string | null }[]>`
      SELECT app.match_athlete_for_family(${academyId}, ${nif}, ${birthdate}::date) AS athlete
    `;
    const athleteId = rows[0]?.athlete;
    if (!athleteId) throw new NotFoundException(NOT_FOUND);
    return athleteId;
  }

  private view(
    invite: {
      id: string; token: string; expiresAt: Date | null; usedCount: number;
      lastUsedAt: Date | null; createdAt: Date;
      createdBy: { user: { name: string } } | null;
    },
    slug: string,
  ): FamilyInviteView {
    return {
      id: invite.id,
      link: this.linkFor(slug, invite.token),
      expiresAt: invite.expiresAt,
      usedCount: invite.usedCount,
      lastUsedAt: invite.lastUsedAt,
      createdAt: invite.createdAt,
      createdBy: invite.createdBy?.user.name ?? null,
    };
  }

  /**
   * O link, no domínio do próprio clube.
   *
   * Quem o recebe vê o nome da academia no endereço, e não um domínio genérico que
   * parece phishing — é o mesmo raciocínio dos convites de staff. Aponta para a
   * **landing**, que é onde se instala a app: o pai abre no Chrome, instala, e só
   * então entra.
   */
  private linkFor(slug: string, token: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/familia/${token}`;
    return `http://localhost:3000/l/${slug}/familia/${token}`;
  }
}

/* ---------------------------------------------------------------------------- */

/**
 * A resposta única.
 *
 * Diz o que fazer a seguir a quem se enganou, e não diz nada a quem está a tentar
 * à sorte. Não distingue NIF errado de data errada de atleta que já saiu — se
 * distinguisse, bastava fixar uma data e varrer NIFs para descobrir quem treina cá.
 */
const NOT_FOUND = "Não encontrámos nenhum atleta com esse NIF e essa data de nascimento. Confirma com o clube.";

function isEmail(value: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) && value.length <= 254;
}

/** As duas letras do badge — as mesmas da consola e da landing. */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
