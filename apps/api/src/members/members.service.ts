import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MemberDocumentKind, MemberFeePeriod, MemberSex, MemberStatus } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { can, type RequestContext } from "../common/permissions";
import type { MemberSignupDto, MemberTierInputDto, MemberUpdateDto } from "./members.dto";

/**
 * Sócios.
 *
 * Duas metades que não se parecem uma com a outra:
 *
 *  1. **A inscrição pública.** Chega da página do clube, sem sessão, de alguém
 *     que o produto nunca viu. É a superfície mais exposta que existe aqui — e a
 *     única que escreve na base de dados sem um utilizador autenticado por trás.
 *  2. **A gestão.** A direção aprova, numera, suspende. Tudo atrás de
 *     `member:read` / `member:write`, como o resto do produto.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /* Público — a página do clube                                            */
  /* ---------------------------------------------------------------------- */

  /**
   * As categorias que o clube publica.
   *
   * Só as públicas e não arquivadas: um clube pode ter "Sócio honorário", que se
   * atribui por decisão da direção e que ninguém escolhe num formulário.
   */
  async publicTiers(slug: string) {
    const academyId = await this.academyBySlug(slug);

    return this.prisma.runAs(academyId, async (db) =>
      db.memberTier.findMany({
        where: { isPublic: true, archivedAt: null },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: {
          id: true, name: true, description: true, benefits: true,
          feeCents: true, period: true, minAge: true, maxAge: true,
        },
      }),
    );
  }

  /**
   * Alguém a inscrever-se pelo site.
   *
   * ## O que este método não faz
   *
   * Não cria conta nenhuma, não envia email e não aceita o sócio. Escreve uma
   * linha em `PENDING` e acaba. Aprovar é uma decisão de pessoas — um clube que
   * aceitasse sócios automaticamente perdia a única oportunidade de perceber que
   * o "João Silva" da inscrição é o mesmo que foi expulso o ano passado.
   *
   * ## Porque é que devolve tão pouco
   *
   * Devolve `{ ok: true }` e o nome. Nada que confirme se aquele NIF já existia,
   * se o email já lá estava, ou que número lhe vai calhar. Um formulário público
   * que responda "já és sócio" é um oráculo para descobrir quem é sócio de um
   * clube a partir de uma lista de NIFs — e a resposta é a mesma para uma
   * inscrição nova e para uma repetida.
   */
  async signup(slug: string, dto: MemberSignupDto) {
    const academyId = await this.academyBySlug(slug);
    const now = new Date();

    // A idade sai daqui e não do que o formulário disser: é a data de nascimento
    // que manda, e a categoria pode ter limites.
    const birthdate = this.plausibleBirthdate(dto.birthdate);

    return this.prisma.runAs(academyId, async (db) => {
      let tierId: string | null = null;

      if (dto.tierId) {
        const tier = await db.memberTier.findFirst({
          where: { id: dto.tierId, isPublic: true, archivedAt: null },
          select: { id: true, minAge: true, maxAge: true, name: true },
        });
        // Um id de categoria que não existe (ou não é pública) é recusado em vez
        // de ignorado: aceitar em silêncio deixava o sócio na categoria errada e
        // ninguém dava por isso até à hora de cobrar.
        if (!tier) throw new BadRequestException("Categoria de sócio inválida");

        const age = ageAt(birthdate, now);
        if (tier.minAge != null && age < tier.minAge) {
          throw new BadRequestException(`"${tier.name}" é a partir dos ${tier.minAge} anos`);
        }
        if (tier.maxAge != null && age > tier.maxAge) {
          throw new BadRequestException(`"${tier.name}" é até aos ${tier.maxAge} anos`);
        }
        tierId = tier.id;
      }

      const taxId = dto.taxId.replace(/[\s.]/g, "");

      try {
        const member = await db.member.create({
          data: {
            academyId,
            tierId,
            name: dto.name.trim(),
            email: dto.email.trim().toLowerCase(),
            birthdate,
            country: (dto.country ?? "PT").toUpperCase().slice(0, 2),
            address: dto.address.trim(),
            postalCode: dto.postalCode.trim(),
            city: dto.city.trim(),
            phoneCountry: dto.phoneCountry ?? "+351",
            phone: dto.phone.replace(/\s/g, ""),
            sex: (dto.sex as MemberSex) ?? "UNSPECIFIED",
            documentKind: (dto.documentKind as MemberDocumentKind) ?? "CC",
            documentNumber: dto.documentNumber.trim(),
            taxId,
            status: "PENDING",
            // O carimbo, não a caixa. Ver o cabeçalho da migração.
            acceptedTermsAt: now,
            partnerCommsAt: dto.partnerComms ? now : null,
            partnerDataAt: dto.partnerData ? now : null,
            source: "site",
            updatedAt: now,
          },
          select: { id: true, name: true },
        });

        return { ok: true as const, name: member.name.split(" ")[0] };
      } catch (error) {
        /*
         * Já existe alguém com este NIF neste clube.
         *
         * A resposta é **a mesma** de uma inscrição bem sucedida, de propósito.
         * Dizer "já és sócio" transformaria este formulário num oráculo: com uma
         * lista de NIFs, qualquer pessoa descobria quem é sócio do clube. O
         * pedido não cria nada e quem se inscreveu de boa fé recebe o mesmo
         * ecrã — a direção vê a inscrição original na lista e trata do resto.
         */
        if (isUniqueViolation(error, "taxId")) {
          return { ok: true as const, name: dto.name.trim().split(" ")[0] };
        }
        throw error;
      }
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Consola — a direção                                                    */
  /* ---------------------------------------------------------------------- */

  async list(ctx: RequestContext, filters: { status?: string; tierId?: string; q?: string }) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.member.findMany({
        where: {
          ...(filters.status ? { status: filters.status as MemberStatus } : {}),
          ...(filters.tierId ? { tierId: filters.tierId } : {}),
          ...(filters.q
            ? {
                OR: [
                  { name: { contains: filters.q, mode: "insensitive" as const } },
                  { email: { contains: filters.q, mode: "insensitive" as const } },
                  { taxId: { contains: filters.q } },
                ],
              }
            : {}),
        },
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        select: {
          id: true, number: true, name: true, email: true, phone: true, phoneCountry: true,
          birthdate: true, city: true, status: true, createdAt: true, approvedAt: true, source: true,
          tier: { select: { id: true, name: true, feeCents: true, period: true } },
        },
      });

      const counts = await db.member.groupBy({ by: ["status"], _count: { _all: true } });

      return {
        members: rows,
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      };
    });
  }

  /** A ficha completa. Documento e morada só se leem aqui, não na lista. */
  async detail(ctx: RequestContext, id: string) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const m = await db.member.findFirst({
        where: { id },
        select: {
          id: true, number: true, name: true, email: true, birthdate: true,
          country: true, address: true, postalCode: true, city: true,
          phoneCountry: true, phone: true, sex: true,
          documentKind: true, documentNumber: true, taxId: true,
          status: true, source: true, notes: true,
          acceptedTermsAt: true, partnerCommsAt: true, partnerDataAt: true,
          createdAt: true, approvedAt: true,
          tier: { select: { id: true, name: true, feeCents: true, period: true } },
          approvedBy: { select: { user: { select: { name: true } } } },
        },
      });
      if (!m) throw new NotFoundException("Sócio não encontrado");

      return { ...m, approvedBy: m.approvedBy?.user.name ?? null };
    });
  }

  /**
   * Aprovar, suspender, corrigir.
   *
   * O número de sócio é atribuído **na aprovação** e não na inscrição: um número
   * dado a quem ainda não foi aceite queima lugares na sequência, e uma sequência
   * com buracos é a primeira coisa que alguém repara num livro de sócios.
   */
  async update(ctx: RequestContext, id: string, dto: MemberUpdateDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id },
        select: { id: true, status: true, number: true },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      const data: Record<string, unknown> = { updatedAt: new Date() };

      if (dto.tierId !== undefined) data.tierId = dto.tierId || null;
      if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
      if (dto.phone !== undefined) data.phone = dto.phone.replace(/\s/g, "");
      if (dto.address !== undefined) data.address = dto.address.trim();
      if (dto.postalCode !== undefined) data.postalCode = dto.postalCode.trim();
      if (dto.city !== undefined) data.city = dto.city.trim();

      if (dto.status !== undefined && dto.status !== member.status) {
        data.status = dto.status as MemberStatus;

        if (dto.status === "ACTIVE" && !member.number) {
          data.number = await this.nextNumber(db);
          data.approvedAt = new Date();
          data.approvedById = ctx.membershipId;
        }
      }

      // Um número escrito à mão ganha ao automático: clubes antigos têm livros de
      // sócios que já existiam antes deste produto, e a numeração é deles.
      if (dto.number !== undefined) data.number = dto.number ?? null;

      try {
        await db.member.update({ where: { id }, data });
      } catch (error) {
        if (isUniqueViolation(error, "number")) {
          throw new BadRequestException("Já existe um sócio com esse número");
        }
        throw error;
      }

      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Categorias                                                             */
  /* ---------------------------------------------------------------------- */

  async tiers(ctx: RequestContext) {
    this.mustRead(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.memberTier.findMany({
        where: { archivedAt: null },
        orderBy: [{ order: "asc" }, { name: "asc" }],
        select: {
          id: true, name: true, description: true, benefits: true, feeCents: true,
          period: true, minAge: true, maxAge: true, isPublic: true, order: true,
          _count: { select: { members: true } },
        },
      });

      return rows.map((t) => ({ ...t, members: t._count.members }));
    });
  }

  async createTier(ctx: RequestContext, dto: MemberTierInputDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const last = await db.memberTier.findFirst({ orderBy: { order: "desc" }, select: { order: true } });

      try {
        return await db.memberTier.create({
          data: {
            academyId: ctx.academyId,
            name: dto.name.trim(),
            description: dto.description?.trim() || null,
            benefits: (dto.benefits ?? []).map((b) => b.trim()).filter(Boolean).slice(0, 12),
            feeCents: dto.feeCents ?? null,
            period: (dto.period as MemberFeePeriod) ?? "ANNUAL",
            minAge: dto.minAge ?? null,
            maxAge: dto.maxAge ?? null,
            isPublic: dto.isPublic ?? true,
            order: (last?.order ?? 0) + 1,
            updatedAt: new Date(),
          },
          select: { id: true, name: true },
        });
      } catch (error) {
        if (isUniqueViolation(error, "name")) {
          throw new BadRequestException("Já existe uma categoria com esse nome");
        }
        throw error;
      }
    });
  }

  async updateTier(ctx: RequestContext, id: string, dto: MemberTierInputDto) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const tier = await db.memberTier.findFirst({ where: { id }, select: { id: true } });
      if (!tier) throw new NotFoundException("Categoria não encontrada");

      await db.memberTier.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
          ...(dto.benefits !== undefined
            ? { benefits: dto.benefits.map((b) => b.trim()).filter(Boolean).slice(0, 12) }
            : {}),
          ...(dto.feeCents !== undefined ? { feeCents: dto.feeCents ?? null } : {}),
          ...(dto.period !== undefined ? { period: dto.period as MemberFeePeriod } : {}),
          ...(dto.minAge !== undefined ? { minAge: dto.minAge ?? null } : {}),
          ...(dto.maxAge !== undefined ? { maxAge: dto.maxAge ?? null } : {}),
          ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
          updatedAt: new Date(),
        },
      });

      return { ok: true };
    });
  }

  /**
   * Arquivar uma categoria.
   *
   * Nunca apagar enquanto tiver sócios: os sócios ficariam sem categoria e
   * ninguém saberia porquê. Arquivada, some do formulário público e continua a
   * explicar o que os sócios antigos pagam.
   */
  async archiveTier(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const tier = await db.memberTier.findFirst({
        where: { id },
        select: { id: true, _count: { select: { members: true } } },
      });
      if (!tier) throw new NotFoundException("Categoria não encontrada");

      await db.memberTier.update({
        where: { id },
        data: { archivedAt: new Date(), isPublic: false, updatedAt: new Date() },
      });

      return { ok: true, members: tier._count.members };
    });
  }

  /* ---------------------------------------------------------------------- */

  private mustRead(ctx: RequestContext) {
    if (!can(ctx, "member:read")) throw new ForbiddenException("Sem acesso aos sócios");
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "member:write")) throw new ForbiddenException("Sem permissão para gerir sócios");
  }

  /**
   * O clube, a partir do endereço.
   *
   * A inscrição pública não tem sessão, por isso não há `ctx` de onde tirar o
   * tenant — vem do slug, pela mesma função estreita que o `AuthService` usa. É
   * o equivalente ao que o webhook de pagamentos faz: resolver o tenant antes de
   * abrir o contexto, e nunca escrever fora dele.
   */
  private async academyBySlug(slug: string): Promise<string> {
    const academyId = await this.auth.academyIdBySlug(slug);
    if (!academyId) throw new NotFoundException("Clube não encontrado");
    return academyId;
  }

  /** O próximo número livre. Simples de propósito: um livro de sócios é uma fila. */
  private async nextNumber(db: ScopedClient): Promise<number> {
    const last = await db.member.findFirst({
      where: { number: { not: null } },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    return (last?.number ?? 0) + 1;
  }

  private plausibleBirthdate(value: string): Date {
    const date = new Date(value);
    const year = date.getUTCFullYear();
    const now = new Date().getUTCFullYear();
    // Um sócio pode ser um bebé inscrito pelos pais e pode ter 100 anos. A janela
    // é larga porque aqui, ao contrário dos atletas, quase tudo é plausível.
    if (Number.isNaN(date.getTime()) || year < now - 110 || year > now) {
      throw new BadRequestException("Data de nascimento inválida");
    }
    return date;
  }
}

function ageAt(birthdate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthdate.getUTCFullYear();
  const m = now.getUTCMonth() - birthdate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthdate.getUTCDate())) age--;
  return age;
}

function isUniqueViolation(error: unknown, field: string): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string } };
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  return Array.isArray(target) ? target.includes(field) : String(target ?? "").includes(field);
}
