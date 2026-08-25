import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { PlatformRole } from "@prisma/client";
import { PlatformPrisma } from "./platform.prisma";
import { PlatformService } from "./platform.service";
import { SupabaseAccountsService } from "../auth/supabase-accounts.service";
import type { PlatformAdminContext } from "./platform.guard";

/**
 * Quem entra na plataforma, e como é que se torna administrador.
 *
 * ## Só por convite
 *
 * Não há "criar administrador" a preencher uma password aqui — só há convidar, e
 * quem resgata escolhe a própria. É o mesmo desenho dos convites de staff
 * (`invites.service.ts`): quem convida decide **tudo** — nome, email, papel —
 * quem resgata só prova que é a pessoa. A alternativa (o dono a escolher e
 * transmitir uma password) é pior por construção: a password passa por um canal
 * a mais — o dono que a escolheu, o canal por onde a mandou — e é exactamente o
 * tipo de passo que este produto evita nos outros três convites que já tem.
 *
 * ## Porque é que o token nunca fica na base
 *
 * 32 bytes de `randomBytes` em base64url. Na base fica só o SHA-256. Se a tabela
 * `PlatformAdminInvite` vazar, os convites pendentes não são resgatáveis por quem
 * a leu — o mesmo raciocínio de `StaffInvite`.
 *
 * ## Porque é que só o `OWNER` mexe aqui
 *
 * `PlatformRole.OWNER` já diz "tudo, incluindo gerir administradores e planos" no
 * schema. Um `ADMIN` que pudesse convidar outro `ADMIN` — ou pior, um `OWNER` —
 * seria uma escalada de privilégios sem hierarquia nenhuma a travá-la. Reforçado
 * no controlador com `@PlatformRoles("OWNER")`, e aqui outra vez para o caso de
 * alguém vir a chamar isto de outro sítio um dia.
 */

const VALID_DAYS = 7;
const DAY = 86_400_000;

export type AdminSummary = {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  isActive: boolean;
  mfaEnabled: boolean;
  createdAt: Date;
};

export type InvitePreview = { name: string; email: string; role: PlatformRole };

export type RedeemResult = {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  accessToken: string;
  refreshToken: string | null;
};

@Injectable()
export class AdminInvitesService {
  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly platform: PlatformService,
    private readonly accounts: SupabaseAccountsService,
    private readonly config: ConfigService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Do lado de quem já é dono disto                                           */
  /* ------------------------------------------------------------------------ */

  async list(): Promise<AdminSummary[]> {
    const rows = await this.prisma.platformAdmin.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true, isActive: true, mfaEnrolledAt: true, createdAt: true },
    });

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      isActive: r.isActive,
      mfaEnabled: r.mfaEnrolledAt !== null,
      createdAt: r.createdAt,
    }));
  }

  /** Cria o convite e devolve o link — uma única vez, como os de staff. */
  async invite(
    admin: PlatformAdminContext,
    dto: { name: string; email: string; role: PlatformRole },
    ip?: string,
  ): Promise<{ link: string; expiresAt: Date }> {
    const email = dto.email.trim().toLowerCase();
    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException("O nome é preciso");

    const existing = await this.prisma.platformAdmin.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new ConflictException("Já existe um administrador com este email");

    const pending = await this.prisma.platformAdminInvite.findFirst({
      where: { email, redeemedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (pending) throw new ConflictException("Já há um convite pendente para este email");

    const token = randomBytes(32).toString("base64url");
    const invite = await this.prisma.platformAdminInvite.create({
      data: {
        tokenHash: createHash("sha256").update(token).digest("hex"),
        email,
        name,
        role: dto.role,
        invitedById: admin.id,
        expiresAt: new Date(Date.now() + VALID_DAYS * DAY),
      },
      select: { id: true, expiresAt: true },
    });

    await this.platform.audit(admin, "platformAdmin.invite", "platformAdminInvite", invite.id, { email, role: dto.role }, ip);

    return { link: this.linkFor(token), expiresAt: invite.expiresAt };
  }

  /**
   * Activar ou desactivar.
   *
   * Nunca apagar. `isActive` é exactamente o que o `PlatformGuard` verifica —
   * desligar aqui já tira o acesso por completo — e ao contrário de um `DELETE`,
   * mantém `AuditLog.adminId` e `Contact.ownerId` a apontar para alguém real: o
   * histórico de quem fez o quê continua legível depois de a pessoa sair. Se um
   * dia for preciso mesmo apagar a linha, é uma operação directa na base, feita
   * de propósito e não um botão à distância de um clique errado.
   */
  async setActive(admin: PlatformAdminContext, targetId: string, active: boolean, ip?: string): Promise<AdminSummary> {
    if (targetId === admin.id) {
      throw new ForbiddenException("Não te podes desactivar a ti próprio");
    }

    const target = await this.prisma.platformAdmin.findUnique({
      where: { id: targetId },
      select: { id: true, name: true, email: true, role: true, isActive: true, mfaEnrolledAt: true, createdAt: true },
    });
    if (!target) throw new NotFoundException("Administrador não encontrado");

    const updated = await this.prisma.platformAdmin.update({
      where: { id: targetId },
      data: { isActive: active },
      select: { id: true, name: true, email: true, role: true, isActive: true, mfaEnrolledAt: true, createdAt: true },
    });

    await this.platform.audit(
      admin,
      active ? "platformAdmin.activate" : "platformAdmin.deactivate",
      "admin",
      targetId,
      { email: target.email },
      ip,
    );

    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      isActive: updated.isActive,
      mfaEnabled: updated.mfaEnrolledAt !== null,
      createdAt: updated.createdAt,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Do lado de quem resgata                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * O que a página de resgate mostra.
   *
   * Um convite gasto, expirado ou inventado dá exactamente o mesmo erro — a mesma
   * disciplina de `InvitesService.preview`. Distinguir os três transformaria isto
   * num oráculo: "expirado" confirma que existiu um convite com aquele token, o
   * que já é mais do que quem está a tentar à sorte devia saber.
   */
  async preview(token: string): Promise<InvitePreview> {
    const invite = await this.findValid(token);
    return { name: invite.name, email: invite.email, role: invite.role };
  }

  /**
   * Resgatar: escolher a password e nascer como administrador.
   *
   * `createOrSignIn` cobre os dois casos possíveis do outro lado do convite: uma
   * conta nova (o normal) ou uma conta que já existe noutro produto — o email de
   * alguém que já é director de um clube, por exemplo. No segundo caso, a
   * password tem de ser a dela: sem essa prova, bastaria adivinhar um email para
   * herdar acesso à plataforma através da conta de outra pessoa.
   */
  async redeem(token: string, password: string): Promise<RedeemResult> {
    const invite = await this.findValid(token);

    const account = await this.accounts.createOrSignIn(invite.email, password, invite.name);

    // Redimir o convite e criar o administrador são a mesma operação: entre as
    // duas não pode haver uma janela em que o token já não vale nada mas o
    // administrador ainda não existe, nem o oposto — dois pedidos em paralelo a
    // criarem dois administradores do mesmo convite.
    const created = await this.prisma.$transaction(async (tx) => {
      const redeemed = await tx.platformAdminInvite.updateMany({
        where: { id: invite.id, redeemedAt: null },
        data: { redeemedAt: new Date() },
      });
      if (redeemed.count === 0) throw new ConflictException("Este convite já foi usado");

      return tx.platformAdmin.create({
        data: {
          authId: account.authId,
          email: invite.email,
          name: invite.name,
          role: invite.role,
        },
        select: { id: true, name: true, email: true, role: true },
      });
    });

    await this.platform.audit(
      null,
      "platformAdmin.create",
      "admin",
      created.id,
      { email: created.email, role: created.role, invitedBy: invite.invitedById },
      undefined,
    );

    // `create()` (a conta nova, o caso normal) não devolve tokens — só o
    // Supabase pode emitir uma sessão, e criar a conta não é entrar nela. Ver o
    // mesmo passo em `family-invites.service.ts`.
    const session = account.accessToken
      ? { accessToken: account.accessToken, refreshToken: account.refreshToken ?? null }
      : await this.accounts.signIn(invite.email, password).then((s) => ({ accessToken: s.accessToken, refreshToken: s.refreshToken ?? null }));

    return {
      id: created.id,
      name: created.name,
      email: created.email,
      role: created.role,
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
    };
  }

  /* ------------------------------------------------------------------------ */

  private async findValid(token: string) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const invite = await this.prisma.platformAdminInvite.findUnique({ where: { tokenHash } });

    if (!invite || invite.redeemedAt || invite.expiresAt < new Date()) {
      throw new NotFoundException("Convite inválido");
    }
    return invite;
  }

  /**
   * O link, montado a partir de onde o painel vive.
   *
   * `PLATFORM_ORIGIN` já existe para o CORS — é literalmente "onde é que o
   * painel está", e é a mesma pergunta aqui.
   */
  private linkFor(token: string): string {
    const base = (this.config.get<string>("PLATFORM_ORIGIN") ?? "http://localhost:5180").replace(/\/$/, "");
    return `${base}/convite-admin/${token}`;
  }
}
