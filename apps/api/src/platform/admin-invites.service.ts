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
    const rows = await this.prisma.platformAdmin.findMany({ orderBy: { createdAt: "asc" }, select: ADMIN_SELECT });
    return rows.map(shape);
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
   * `isActive` é exactamente o que o `PlatformGuard` verifica — desligar aqui já
   * tira o acesso por completo, sem apagar a linha. É a via reversível: um "foi
   * engano" restaura-se com um clique, sem repetir o convite.
   */
  async setActive(admin: PlatformAdminContext, targetId: string, active: boolean, ip?: string): Promise<AdminSummary> {
    if (targetId === admin.id) {
      throw new ForbiddenException("Não te podes desactivar a ti próprio — entra com outra conta de administrador.");
    }

    const target = await this.prisma.platformAdmin.findUnique({ where: { id: targetId }, select: ADMIN_SELECT });
    if (!target) throw new NotFoundException("Administrador não encontrado");

    const updated = await this.prisma.platformAdmin.update({
      where: { id: targetId },
      data: { isActive: active },
      select: ADMIN_SELECT,
    });

    await this.platform.audit(
      admin,
      active ? "platformAdmin.activate" : "platformAdmin.deactivate",
      "admin",
      targetId,
      { email: target.email },
      ip,
    );

    return shape(updated);
  }

  /**
   * Mudar de papel — incluindo promover a `OWNER`.
   *
   * ## Porque é que se pode mudar o próprio papel, mas não desactivar-se
   *
   * Desactivar-se corta o acesso na hora, a meio da própria sessão — é o
   * lockout que `setActive` recusa sempre. Mudar de papel não: continuas
   * dentro, só deixas de poder entrar em rotas de `OWNER` a partir daí. É uma
   * despromoção deliberada de alguém que decidiu ter menos poder, não um
   * acidente a meio de uma tarefa.
   *
   * ## A única coisa que isto recusa
   *
   * Ficar sem nenhum `OWNER` activo. Sem pelo menos um, ninguém mais consegue
   * convidar, promover ou gerir administradores — a plataforma trancar-se-ia a
   * si própria, e a única saída seria mexer directamente na base de dados.
   */
  async setRole(admin: PlatformAdminContext, targetId: string, role: PlatformRole, ip?: string): Promise<AdminSummary> {
    const target = await this.prisma.platformAdmin.findUnique({ where: { id: targetId }, select: ADMIN_SELECT });
    if (!target) throw new NotFoundException("Administrador não encontrado");

    if (target.role === "OWNER" && role !== "OWNER") {
      const otherOwners = await this.prisma.platformAdmin.count({
        where: { role: "OWNER", isActive: true, id: { not: targetId } },
      });
      if (otherOwners === 0) {
        throw new ForbiddenException("Tem de ficar sempre pelo menos um dono activo — promove outra pessoa primeiro.");
      }
    }

    const updated = await this.prisma.platformAdmin.update({ where: { id: targetId }, data: { role }, select: ADMIN_SELECT });
    await this.platform.audit(admin, "platformAdmin.role", "admin", targetId, { email: target.email, from: target.role, to: role }, ip);

    return shape(updated);
  }

  /**
   * Apagar de vez.
   *
   * Ao contrário de desactivar, isto tira a linha da tabela. `AuditLog.adminId`
   * e `Contact.ownerId` ficam a `null` (é o que `onDelete: SetNull` faz) — o
   * histórico de que a acção aconteceu não desaparece, só deixa de apontar para
   * ninguém. Não apaga a conta no Supabase: são identidades diferentes, e uma
   * pessoa pode ter outros papéis no produto (director de um clube, por
   * exemplo) que não têm nada a ver com ter sido administrador da plataforma.
   *
   * Nunca a si próprio — pelo mesmo motivo de `setActive`: apagar a própria
   * linha corta o próprio acesso a meio da sessão. Entra com outra conta e
   * apaga esta a partir dela.
   */
  async remove(admin: PlatformAdminContext, targetId: string, ip?: string): Promise<{ ok: true }> {
    if (targetId === admin.id) {
      throw new ForbiddenException("Não te podes apagar a ti próprio — entra com outra conta de administrador.");
    }

    const target = await this.prisma.platformAdmin.findUnique({ where: { id: targetId }, select: { email: true, role: true } });
    if (!target) throw new NotFoundException("Administrador não encontrado");

    await this.prisma.platformAdmin.delete({ where: { id: targetId } });
    await this.platform.audit(admin, "platformAdmin.delete", "admin", targetId, { email: target.email, role: target.role }, ip);

    return { ok: true };
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

/** A projecção usada em toda a parte — uma só, para `list`, `setActive` e `setRole` nunca divergirem. */
const ADMIN_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  mfaEnrolledAt: true,
  createdAt: true,
} as const;

type AdminRow = {
  id: string;
  name: string;
  email: string;
  role: PlatformRole;
  isActive: boolean;
  mfaEnrolledAt: Date | null;
  createdAt: Date;
};

function shape(r: AdminRow): AdminSummary {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    isActive: r.isActive,
    mfaEnabled: r.mfaEnrolledAt !== null,
    createdAt: r.createdAt,
  };
}
