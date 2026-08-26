import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Role, StaffDepartment } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseAccountsService } from "../auth/supabase-accounts.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * Convites de staff.
 *
 * ## O que um convite decide, e o que não decide
 *
 * Decide **tudo**: quem, com que papel, com que equipas, até quando. Quem resgata
 * o link só prova que é a pessoa (escolhendo uma password) — não escolhe nada
 * sobre o próprio acesso.
 *
 * Isso é deliberado e é a decisão central deste ficheiro. O âmbito de um treinador
 * é derivado de `TeamStaff` a cada pedido (`AuthService.scopeFor`), portanto as
 * equipas *são* o acesso aos dados dos atletas — boletim clínico incluído. Se a
 * escolha das equipas estivesse do lado de quem resgata, quem apanhasse o link
 * decidia o que podia ver. E estes links viajam por WhatsApp: são reencaminhados e
 * fotografados.
 *
 * ## O token
 *
 * 32 bytes de `randomBytes` em base64url. Na base fica só o SHA-256 — o token em
 * claro existe uma vez, no link. Se a tabela vazar, os convites pendentes não são
 * resgatáveis por quem a leu.
 */

/** Papéis que se convidam por aqui. */
const STAFF_ROLES: Role[] = ["OWNER", "DIRECTOR", "COORDINATOR", "COACH", "STAFF", "MEDICAL"];

/**
 * Quem pode convidar quem.
 *
 * Um número por papel, e a regra é uma só: **não se convida acima do próprio
 * nível**. Sem isto, um coordenador convidava-se a si próprio um OWNER e a
 * hierarquia não valia nada — a escalada de privilégios mais aborrecida que há, e
 * a mais fácil de esquecer.
 *
 * Igual ao próprio nível é permitido: um diretor convida outro diretor, que é
 * exactamente como uma academia com dois sócios-gerentes funciona.
 */
const RANK: Record<Role, number> = {
  OWNER: 100,
  DIRECTOR: 80,
  COORDINATOR: 60,
  MEDICAL: 40,
  SCOUT: 40,
  COACH: 40,
  STAFF: 20,
  GUARDIAN: 0,
  ATHLETE: 0,
};

/** Quanto tempo um convite vale. Uma semana chega para alguém abrir um WhatsApp. */
const VALID_DAYS = 7;

export type CreateInvite = {
  name: string;
  email: string;
  /**
   * O cargo que a pessoa vai vestir — um `AcademyRole` desta academia.
   *
   * Substitui a escolha solta de `role` que existia aqui. Eram duas perguntas
   * para a mesma coisa: quem convidava escolhia um "acesso" (o enum) **e** um
   * departamento, e "acesso Direção" com "departamento Direção" dizia o mesmo
   * duas vezes. Agora escolhe-se o departamento e, dentro dele, o cargo — e é o
   * cargo que carrega as permissões, que é onde elas sempre estiveram.
   */
  academyRoleId: string;
  teamIds?: string[];
};

export type InviteSummary = {
  id: string;
  name: string;
  email: string;
  role: Role;
  title: string | null;
  department: StaffDepartment | null;
  teamIds: string[];
  expiresAt: Date;
  createdAt: Date;
  invitedBy: string | null;
};

/** O que a página de resgate mostra. Nada disto revela quem mais existe na academia. */
export type InvitePreview = {
  academy: { slug: string; name: string; shortName: string; mark: string; signalColor: string };
  name: string;
  email: string;
  role: Role;
  title: string | null;
  teams: { id: string; name: string }[];
  /** Já tem conta noutra academia (ou como encarregado nesta): não se pede password nova. */
  hasAccount: boolean;
};

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: SupabaseAccountsService,
    private readonly config: ConfigService,
  ) {}

  /* ------------------------------------------------------------------------ */
  /* Do lado de quem convida                                                   */
  /* ------------------------------------------------------------------------ */

  /**
   * Cria o convite e devolve o link — uma única vez.
   *
   * O token em claro não volta a existir depois desta chamada. Se quem convida
   * perder o link, revoga e emite outro; não há "mostrar outra vez", porque isso
   * obrigaria a guardar o token e é precisamente o que se está a evitar.
   */
  async create(ctx: RequestContext, dto: CreateInvite): Promise<{ id: string; link: string; expiresAt: Date }> {
    if (!can(ctx, "staff:write")) throw new ForbiddenException("Sem permissão para convidar");

    const email = normalizeEmail(dto.email);
    if (!isEmail(email)) throw new BadRequestException("Email inválido");

    const name = dto.name.trim();
    if (name.length < 2) throw new BadRequestException("Falta o nome");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      /*
       * O cargo decide tudo o resto: o papel-base (e com ele o âmbito e a
       * hierarquia), as permissões e o departamento. Ler daqui, e não do corpo
       * do pedido, é o que impede alguém de mandar um cargo e um papel que não
       * combinam.
       */
      const cargo = await db.academyRole.findFirst({
        where: { id: dto.academyRoleId, archivedAt: null },
        select: { id: true, name: true, baseRole: true, department: true, rank: true },
      });
      if (!cargo) throw new BadRequestException("Cargo desconhecido");

      if (!STAFF_ROLES.includes(cargo.baseRole)) {
        // Encarregados entram pelo atleta, não por aqui: um GUARDIAN sem
        // `GuardianLink` seria uma conta que existe e não vê nada.
        throw new BadRequestException("Este cargo não se convida por aqui");
      }

      // A mesma regra de sempre, agora lida do cargo: não se convida acima do
      // próprio nível. Sem isto, quem tivesse `staff:write` convidava um
      // presidente e contornava a hierarquia inteira num convite.
      if (RANK[cargo.baseRole] > RANK[ctx.role]) {
        throw new ForbiddenException("Não podes convidar alguém para um cargo acima do teu");
      }

      // As equipas têm de ser desta academia. A RLS já o garante; verificar aqui é
      // o que transforma um silêncio (equipa ignorada) num erro visível.
      const teamIds = [...new Set(dto.teamIds ?? [])];
      if (teamIds.length) {
        const found = await db.team.findMany({ where: { id: { in: teamIds } }, select: { id: true } });
        if (found.length !== teamIds.length) throw new BadRequestException("Equipa desconhecida");
      }

      const existing = await db.membership.findFirst({
        where: { role: cargo.baseRole, user: { email }, isActive: true },
        select: { id: true },
      });
      if (existing) throw new ConflictException("Esta pessoa já tem este cargo na academia");

      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + VALID_DAYS * 24 * 60 * 60 * 1000);

      try {
        const invite = await db.staffInvite.create({
          data: {
            academyId: ctx.academyId,
            tokenHash: hash(token),
            email,
            name,
            role: cargo.baseRole,
            title: cargo.name,
            department: cargo.department,
            academyRoleId: cargo.id,
            teamIds,
            invitedById: ctx.membershipId,
            expiresAt,
          },
          select: { id: true },
        });

        // O slug lê-se com o cliente **desta** transação. Abrir outra aqui dentro
        // esgotava a ligação à espera de si própria — o Prisma não aninha `$transaction`.
        const academy = await db.academy.findFirst({
          where: { id: ctx.academyId },
          select: { slug: true },
        });

        return { id: invite.id, link: this.linkFor(academy?.slug ?? "", token), expiresAt };
      } catch (error) {
        // O índice parcial `StaffInvite_pending_unique`: já há um convite vivo para
        // esta pessoa com este papel. Reemitir sem revogar deixaria dois links a
        // funcionar, e o primeiro seria um órfão que ninguém se lembra de fechar.
        if (isUniqueViolation(error)) {
          throw new ConflictException("Já existe um convite por aceitar para esta pessoa");
        }
        throw error;
      }
    });
  }

  /** Convites por aceitar. Um convite emitido e esquecido é uma porta aberta que ninguém vê. */
  async listPending(ctx: RequestContext): Promise<InviteSummary[]> {
    if (!can(ctx, "staff:read")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.staffInvite.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, name: true, email: true, role: true, title: true, department: true,
          teamIds: true, expiresAt: true, createdAt: true,
          invitedBy: { select: { user: { select: { name: true } } } },
        },
      });

      return rows.map((r) => ({
        ...r,
        invitedBy: r.invitedBy?.user.name ?? null,
      }));
    });
  }

  /** Fecha um convite. O link deixa de resolver — `app.resolve_invite` já o exclui. */
  async revoke(ctx: RequestContext, id: string): Promise<void> {
    if (!can(ctx, "staff:write")) throw new ForbiddenException("Sem permissão");

    await this.prisma.runAs(ctx.academyId, async (db) => {
      const done = await db.staffInvite.updateMany({
        where: { id, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (done.count === 0) throw new NotFoundException("Convite não encontrado ou já fechado");
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Do lado de quem resgata — sem autenticação                                */
  /* ------------------------------------------------------------------------ */

  /**
   * O que a página de resgate mostra.
   *
   * `app.resolve_invite` é a escotilha: dado o hash, devolve só o id da academia, e
   * só de convites que ainda valem. Um convite gasto, revogado ou expirado não
   * abre contexto de tenant nenhum — falha fechado, sem caminho alternativo.
   */
  async preview(token: string): Promise<InvitePreview> {
    const academyId = await this.academyOf(token);
    // Antes de abrir a transação: pedir uma segunda ligação ao pool enquanto se
    // segura a primeira é como se esgota um pool pequeno.
    const account = await this.invitedAccount(token);

    return this.prisma.runAs(academyId, async (db) => {
      const invite = await db.staffInvite.findFirst({
        where: { tokenHash: hash(token), acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { name: true, email: true, role: true, title: true, teamIds: true },
      });
      if (!invite) throw new NotFoundException("Convite inválido");

      const academy = await db.academy.findFirst({
        where: { id: academyId },
        select: { slug: true, name: true, shortName: true, signalColor: true },
      });
      if (!academy) throw new NotFoundException("Academia não encontrada");

      const teams = invite.teamIds.length
        ? await db.team.findMany({ where: { id: { in: invite.teamIds } }, select: { id: true, name: true } })
        : [];

      return {
        academy: { ...academy, mark: monogram(academy.shortName) },
        name: invite.name,
        email: invite.email,
        role: invite.role,
        title: invite.title,
        teams,
        hasAccount: Boolean(account),
      };
    });
  }

  /**
   * Resgatar.
   *
   * Dois caminhos, porque há dois casos reais:
   *
   *  - **Conta nova** — a pessoa escolhe password, e cria-se a conta no Supabase.
   *  - **Conta que já existe** — a mãe que já é encarregada de educação e passa a
   *    treinadora, ou quem treina em duas academias. Aqui não se pede password
   *    nova: pede-se a que ela já tem, e é ao verificá-la contra o Supabase que se
   *    prova que é mesmo ela. Sem essa prova, quem apanhasse o link ganhava uma
   *    membership numa conta que não controla.
   */
  async accept(token: string, password: string, phone?: string): Promise<{ slug: string }> {
    if (!password || password.length < 8) {
      throw new BadRequestException("A palavra-passe tem de ter pelo menos 8 caracteres");
    }

    const academyId = await this.academyOf(token);
    const tokenHash = hash(token);

    const invite = await this.prisma.runAs(academyId, async (db) =>
      db.staffInvite.findFirst({
        where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: {
          id: true, email: true, name: true, role: true, title: true,
          department: true, teamIds: true, academyRoleId: true,
        },
      }),
    );
    if (!invite) throw new NotFoundException("Convite inválido");

    // A conta no Supabase, fora de qualquer transação: é um sistema externo e não
    // participa no rollback. Falhar aqui deixa o convite intacto para nova tentativa.
    const existing = await this.invitedAccount(token);
    // `SupabaseAccountsService` é partilhado com o registo das famílias: a pergunta
    // "esta conta já existe, e quem está do outro lado é o dono dela?" não pode ter
    // duas respostas diferentes no mesmo produto.
    const authId = existing
      ? (await this.accounts.signIn(invite.email, password)).authId
      : (await this.accounts.create(invite.email, password, invite.name)).authId;

    return this.prisma.runAs(academyId, async (db) => {
      // Uso único, e a corrida resolve-se aqui: quem chegar em segundo encontra
      // `count === 0` porque o `where` já não bate certo.
      const claimed = await db.staffInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw new ConflictException("Este convite já foi usado");

      /*
       * O `User` não se cria com o Prisma aqui, e a razão é boa.
       *
       * A política de `User` é "vejo-te se partilharmos academia", e a partilha
       * ainda não existe — é a Membership abaixo que a cria. Como o Prisma faz
       * sempre `INSERT ... RETURNING`, a leitura de volta cai na política e o
       * Postgres recusa. Um `INSERT` sem `RETURNING` passaria; com ele, não.
       *
       * `app.upsert_invited_user` é a escotilha estreita para esse único passo —
       * ver a migração `20260816000400_invited_user_bootstrap`.
       */
      const userId = `usr_${randomBytes(12).toString("hex")}`;
      const created = await db.$queryRaw<{ id: string }[]>`
        SELECT app.upsert_invited_user(
          ${userId}, ${authId}, ${invite.email}, ${invite.name}, ${phone ?? null}
        ) AS id
      `;
      const user = { id: created[0].id };

      /*
       * O cargo segue para a membership.
       *
       * Sem esta linha, quem resgatava um convite entrava com o enum `role` e
       * mais nada: as permissões e os menus vinham dos valores por omissão do
       * enum, e o cargo que quem convidou escolheu — com as permissões que lhe
       * pertencem — ficava por aplicar. Era o que fazia a primeira pessoa a
       * abrir um clube entrar sem conseguir configurar nada.
       */
      const membership = await db.membership.upsert({
        where: { academyId_userId_role: { academyId, userId: user.id, role: invite.role } },
        update: {
          isActive: true,
          title: invite.title,
          department: invite.department,
          ...(invite.academyRoleId ? { customRoleId: invite.academyRoleId } : {}),
        },
        create: {
          academyId,
          userId: user.id,
          role: invite.role,
          title: invite.title,
          department: invite.department,
          customRoleId: invite.academyRoleId,
        },
        select: { id: true },
      });

      // As equipas do convite — decididas por quem convidou, nunca aqui.
      for (const teamId of invite.teamIds) {
        await db.teamStaff.upsert({
          where: { teamId_membershipId: { teamId, membershipId: membership.id } },
          update: {},
          create: { teamId, membershipId: membership.id, title: invite.title ?? "Treinador" },
        });
      }

      const academy = await db.academy.findFirst({ where: { id: academyId }, select: { slug: true } });
      return { slug: academy?.slug ?? "" };
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Peças internas                                                            */
  /* ------------------------------------------------------------------------ */

  private async academyOf(token: string): Promise<string> {
    if (!token || token.length < 20) throw new NotFoundException("Convite inválido");

    const rows = await this.prisma.$queryRaw<{ academy: string | null }[]>`
      SELECT app.resolve_invite(${hash(token)}) AS academy
    `;
    const academyId = rows[0]?.academy;
    // A mesma resposta para "não existe", "expirou", "já foi usado" e "foi
    // revogado". Distingui-las só ajudaria quem estivesse a sondar tokens.
    if (!academyId) throw new NotFoundException("Convite inválido ou expirado");
    return academyId;
  }

  /**
   * O link, montado a partir do slug.
   *
   * Puro de propósito — sem base de dados — porque é chamado de dentro da
   * transação que criou o convite. Em produção o convite vive no domínio do
   * próprio clube: quem o recebe vê o nome da academia no link, e não um endereço
   * genérico que parece phishing.
   */
  private linkFor(slug: string, token: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/convite/${token}`;
    return `http://localhost:3000/l/${slug}/convite/${token}`;
  }

  /**
   * O `authId` de quem foi convidado, se já tiver conta.
   *
   * Não se pergunta pelo email directamente: a política de `User` é "vejo-te se
   * partilharmos academia", e ao resgatar não partilhamos nenhuma ainda — quem já
   * tem conta apareceria como não tendo, e o servidor tentaria criá-la outra vez.
   *
   * `app.invited_account` responde só a quem traga um token de convite válido, e
   * devolve um `authId` opaco. Ver a migração `20260816000500_invited_account`.
   */
  private async invitedAccount(token: string): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ auth: string | null }[]>`
      SELECT app.invited_account(${hash(token)}) AS auth
    `;
    return rows[0]?.auth ?? null;
  }
}

/* ---------------------------------------------------------------------------- */

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Um email de verdade — e não um vetor de injeção.
 *
 * O padrão antigo `[^\s@]+` aceitava `<`, `>`, `/`, o que deixava passar
 * `x</script><script>alert(1)</script>@e.pt` para a página de convite, onde o
 * email é interpolado num bloco `<script>`. Este conjunto de caracteres é o dos
 * emails reais — letras, dígitos, e a pontuação que a RFC permite na prática
 * (`. _ % + -`), mais nada. Um email não precisa de `<` nem de `/`.
 */
function isEmail(value: string): boolean {
  return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value) && value.length <= 254;
}

/** As duas letras do badge — as mesmas que a consola e a landing usam. */
function monogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
