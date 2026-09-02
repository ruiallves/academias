import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { MemberDocumentKind, MemberFeePeriod, MemberSex, MemberStatus, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { can, type RequestContext } from "../common/permissions";
import { CARD_QR_PREFIX } from "../club-app/club-app.service";
import { MemberInvitesService } from "./member-invites.service";
import type {
  MemberCreateDto,
  MemberImportRowDto,
  MemberSignupDto,
  MemberTierInputDto,
  MemberUpdateDto,
} from "./members.dto";

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
    private readonly invites: MemberInvitesService,
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

      /*
       * Já existe alguém com este NIF: responde-se como se tivesse corrido bem.
       *
       * A verificação é feita **antes** do `create` porque o conflito da base de
       * dados chega sem identificar a restrição (`meta.target` nulo) e deixa a
       * transacção abortada — a apanhá-lo depois, o pedido acabava num 500, e um
       * 500 aqui é o oráculo que este método existe para não ser: com uma lista
       * de NIFs, qualquer pessoa descobria quem é sócio do clube.
       */
      const already = await db.member.findFirst({ where: { taxId }, select: { id: true } });
      if (already) return { ok: true as const, name: dto.name.trim().split(" ")[0] };

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
          /* A app do clube: a ficha diz se a conta já foi reclamada e quando
             saiu o último convite — é o que decide o texto do botão. */
          userId: true, inviteSentAt: true,
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
        select: { id: true, status: true, number: true, acceptedTermsAt: true },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      const data: Record<string, unknown> = { updatedAt: new Date() };

      /*
       * Um campo que não veio fica como está; um campo que veio vazio limpa-se.
       *
       * É a distinção que faltava e que dava o "obriga a ter morada": a ficha de
       * um sócio do balcão nasce com metade dos campos por preencher, e sem um
       * caminho para gravar vazio não havia como lhe corrigir o telefone sem
       * inventar a morada no mesmo gesto.
       */
      const texto = (v: string | undefined) => (v === undefined ? undefined : v.trim() || null);

      if (dto.tierId !== undefined) data.tierId = dto.tierId || null;
      if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;
      if (dto.name !== undefined) data.name = dto.name.trim();
      if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase() || null;
      if (dto.phone !== undefined) data.phone = dto.phone.replace(/\s/g, "") || null;
      if (dto.phoneCountry !== undefined) data.phoneCountry = dto.phoneCountry;
      if (dto.address !== undefined) data.address = texto(dto.address);
      if (dto.postalCode !== undefined) data.postalCode = texto(dto.postalCode);
      if (dto.city !== undefined) data.city = texto(dto.city);
      if (dto.country !== undefined) data.country = dto.country.toUpperCase() || "PT";

      /*
       * A identidade — data de nascimento, documento, contribuinte.
       *
       * Não se editava nada disto: o argumento era que estes três campos se
       * corrigem a olhar para o documento e que um formulário fácil de mexer é um
       * formulário onde alguém edita o sócio errado. Só que um sócio inscrito ao
       * balcão nasce sem nenhum deles, e sem NIF o clube não lhe passa um recibo
       * — o campo tinha de ser preenchível **algures**, e não havia esse sítio.
       */
      if (dto.birthdate !== undefined) {
        data.birthdate = dto.birthdate ? this.plausibleBirthdate(dto.birthdate) : null;
      }
      if (dto.sex !== undefined) data.sex = dto.sex as MemberSex;
      if (dto.documentKind !== undefined) data.documentKind = dto.documentKind as MemberDocumentKind;
      if (dto.documentNumber !== undefined) data.documentNumber = texto(dto.documentNumber);
      if (dto.taxId !== undefined) data.taxId = dto.taxId.replace(/[\s.]/g, "") || null;

      /*
       * O consentimento continua a ser um carimbo: guarda-se **quando** foi dado.
       * Marcar de novo uma caixa já marcada não reescreve a data — a prova que o
       * clube tem é a do dia em que a pessoa assinou, não a do dia em que alguém
       * abriu a ficha.
       */
      if (dto.acceptedTerms !== undefined) {
        data.acceptedTermsAt = dto.acceptedTerms ? (member.acceptedTermsAt ?? new Date()) : null;
      }

      let aprovadoAgora = false;
      if (dto.status !== undefined && dto.status !== member.status) {
        data.status = dto.status as MemberStatus;

        if (dto.status === "ACTIVE" && !member.number) {
          data.number = await this.nextNumber(db);
          data.approvedAt = new Date();
          data.approvedById = ctx.membershipId;
          aprovadoAgora = true;
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
        // O NIF passou a ser editável, e é único por clube: sem isto, corrigir um
        // NIF para um que já lá está rebentava com um erro de base de dados.
        if (isUniqueViolation(error, "taxId")) {
          throw new BadRequestException("Já existe um sócio com esse contribuinte");
        }
        throw error;
      }

      return { ok: true, aprovadoAgora };
    }).then((r) => {
      /* Quem aderiu pelo site recebe o convite quando o clube o aceita —
         sem segurar a resposta, como na criação. */
      if (r.aprovadoAgora) void this.invites.enviarSePossivel(ctx.academyId, id);
      return { ok: true as const };
    });
  }

  /**
   * O que um QR de cartão diz a quem o lê na portaria.
   *
   * A resposta é a validação e mais nada: nome, número, categoria e estado —
   * os mesmos quatro campos que estão impressos num cartão físico. O QR em si
   * não carrega nenhum destes dados; carrega um token opaco, e é este endpoint
   * (atrás de `member:read`) que o troca pela resposta.
   */
  async cardInfo(ctx: RequestContext, raw: string) {
    if (!can(ctx, "member:read")) throw new ForbiddenException("Sem acesso aos sócios");

    const token = raw.startsWith(CARD_QR_PREFIX) ? raw.slice(CARD_QR_PREFIX.length) : raw;
    if (!token || token.length < 16) throw new NotFoundException("Cartão não reconhecido");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { cardToken: token },
        select: {
          name: true, number: true, status: true,
          tier: { select: { name: true } },
        },
      });
      if (!member) throw new NotFoundException("Cartão não reconhecido");

      return {
        name: member.name,
        number: member.number,
        status: member.status,
        tierName: member.tier?.name ?? null,
      };
    });
  }

  /**
   * Apagar um sócio — e porque é que quase nunca é isso que se quer.
   *
   * ## Cancelar e apagar não são a mesma pergunta
   *
   * **Cancelar** é o caminho normal e é reversível: o sócio sai das listas activas
   * e deixa de contar para quóruns e quotas, mas continua no livro com o número
   * que lhe foi dado. Quem foi sócio do clube durante doze anos não deixa de o ter
   * sido por ter saído — isso é o registo do que aconteceu.
   *
   * **Apagar** é para o que nunca chegou a existir: a mesma pessoa inscrita duas
   * vezes pela página do clube, um formulário preenchido a brincar, uma data
   * trocada que criou a pessoa errada.
   *
   * ## O travão é o número, não o estado
   *
   * Ao contrário de um atleta — cujo histórico vive em sete tabelas — um sócio não
   * tem nada pendurado: nada em todo o schema aponta para `Member`. Contar linhas
   * noutras tabelas, como faz `AthletesService.remove`, não daria aqui resposta
   * nenhuma.
   *
   * O que faz de alguém sócio é o **número**. Atribuí-lo é o acto de admissão, e é
   * único por clube: apagar a linha abre um buraco na numeração e liberta um
   * número que já foi de uma pessoa, para ser dado a outra. Um livro de sócios com
   * o número 34 a pertencer a duas pessoas diferentes ao longo do tempo é um livro
   * que deixou de servir para o que existe.
   *
   * Por isso: com número atribuído, não se apaga — cancela-se. Sem número, nunca
   * chegou a ser sócio, e sai sem deixar rasto nenhum por perder.
   */
  async remove(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id },
        select: { id: true, name: true, number: true },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      if (member.number !== null) {
        throw new ConflictException(
          `${member.name} tem o número de sócio ${member.number} atribuído. Apagá-lo abria um buraco no livro e libertava um número que já foi de alguém — cancela-o em vez disso, que o tira das listas activas sem perder o registo.`,
        );
      }

      await db.member.delete({ where: { id } });
      return { ok: true };
    });
  }

  /**
   * Um sócio inscrito na secretaria.
   *
   * ## Porquê não reaproveitar a inscrição pública
   *
   * Porque quem preenche isto tem a pessoa à frente e tem `member:write`. Pode
   * escolher a categoria sem passar pelos limites de idade da página pública,
   * pode dar já o número, e pode dizer que o sócio está activo — decisões que a
   * inscrição pública nunca deve conseguir tomar sozinha. Partilhar o método era
   * abrir todas essas portas ao formulário anónimo.
   *
   * E ao contrário da inscrição pública, um NIF repetido é dito em voz alta: quem
   * está a criar já vê o livro todo, e o silêncio só o faria escrever a ficha
   * outra vez.
   */
  async create(ctx: RequestContext, dto: MemberCreateDto) {
    this.mustWrite(ctx);

    const now = new Date();

    /*
     * Um sócio sem contacto nenhum é uma linha que ninguém consegue usar.
     *
     * É a única exigência que sobra além do nome: o clube tem de conseguir
     * chegar à pessoa para cobrar a quota ou convocar a assembleia. Qual dos
     * dois é indiferente — quem tem email dá email, quem só tem telemóvel dá
     * telemóvel.
     */
    if (!dto.email?.trim() && !dto.phone?.trim()) {
      throw new BadRequestException("Um sócio precisa de pelo menos um contacto — email ou telemóvel");
    }

    const birthdate = dto.birthdate ? this.plausibleBirthdate(dto.birthdate) : null;
    const taxId = dto.taxId?.replace(/[\s.]/g, "") || null;

    return this.prisma.runAs(ctx.academyId, async (db) => {
      let tierId: string | null = null;
      if (dto.tierId) {
        const tier = await db.memberTier.findFirst({
          where: { id: dto.tierId, archivedAt: null },
          select: { id: true },
        });
        if (!tier) throw new BadRequestException("Categoria de sócio inválida");
        tierId = tier.id;
      }

      /*
       * O NIF antes de escrever, e não só a apanhar o erro depois.
       *
       * O Postgres devolve este conflito sem dizer que restrição falhou (o
       * `meta.target` vem nulo), e depois dele a transacção fica abortada — não
       * há como perguntar à base de dados o que correu mal. Perguntar primeiro é
       * o que permite dizer "já existe um sócio com este NIF" em vez de um 500.
       * A restrição única continua lá por baixo, como rede.
       */
      // Só se há NIF: dois sócios por identificar não são o mesmo sócio, e o
      // índice único deixa vários nulos conviver (ver a migração).
      if (taxId) {
        const sameTaxId = await db.member.findFirst({ where: { taxId }, select: { id: true } });
        if (sameTaxId) throw new BadRequestException("Já existe um sócio com este NIF");
      }

      if (dto.number != null) {
        const taken = await db.member.findFirst({ where: { number: dto.number }, select: { id: true } });
        if (taken) throw new BadRequestException(`O número ${dto.number} já está atribuído`);
      }

      const status = (dto.status as MemberStatus) ?? "ACTIVE";
      // Sem número para quem fica por aprovar: um número dado a quem ainda não
      // foi aceite queima um lugar na sequência do livro.
      const number = dto.number ?? (status === "PENDING" ? null : await this.nextNumber(db));

      try {
        const member = await db.member.create({
          data: {
            academyId: ctx.academyId,
            tierId,
            number,
            name: dto.name.trim(),
            // Ausente é **nulo**, nunca string vazia: vazio diz "preenchido com
            // nada", nulo diz "por preencher" — e é a segunda coisa que a ficha
            // tem de conseguir mostrar como aviso.
            email: dto.email?.trim().toLowerCase() || null,
            birthdate,
            country: (dto.country ?? "PT").toUpperCase().slice(0, 2),
            address: dto.address?.trim() || null,
            postalCode: dto.postalCode?.trim() || null,
            city: dto.city?.trim() || null,
            phoneCountry: dto.phoneCountry ?? "+351",
            phone: dto.phone?.replace(/\s/g, "") || null,
            sex: (dto.sex as MemberSex) ?? "UNSPECIFIED",
            documentKind: (dto.documentKind as MemberDocumentKind) ?? "CC",
            documentNumber: dto.documentNumber?.trim() || null,
            taxId,
            status,
            acceptedTermsAt: dto.acceptedTerms ? now : null,
            approvedAt: status === "PENDING" ? null : now,
            approvedById: status === "PENDING" ? null : ctx.membershipId,
            source: "secretaria",
            notes: dto.notes?.trim() || null,
            updatedAt: now,
          },
          select: { id: true, name: true, number: true },
        });

        return member;
      } catch (error) {
        if (isUniqueViolation(error, "taxId")) {
          throw new BadRequestException("Já existe um sócio com este NIF");
        }
        throw error;
      }
    }).then((member) => {
      /*
       * O convite para a app, logo a seguir — foi pedido assim: quem é inscrito
       * à mão recebe imediatamente o email para configurar a conta. **Depois**
       * da transacção (HTTP nunca entra num `runAs`), **sem** await (a resposta
       * da secretaria não espera pelo Resend) e silencioso (um email que falha
       * não desfaz uma inscrição — o botão de reenviar existe para isso).
       */
      void this.invites.enviarSePossivel(ctx.academyId, member.id);
      return member;
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Importação                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * O livro de sócios que o clube já tinha, numa folha de cálculo.
   *
   * ## Nada é criado se alguma linha estiver errada
   *
   * Tudo corre dentro de uma transacção. Uma importação parcial é a pior das
   * respostas possíveis: metade dos sócios entra, a pessoa corrige a folha,
   * importa outra vez e fica com metade do clube duplicado. Ou entra o livro
   * todo, ou não entra nada e devolve-se a lista de linhas a corrigir.
   *
   * ## Os duplicados não são erro de quem importa
   *
   * O NIF é único por clube. Uma linha que já existe é ignorada e contada — é o
   * caso normal de quem reimporta a folha depois de lhe acrescentar pessoas, e
   * fazer disso um erro obrigava a editar a folha só para tirar quem já entrou.
   *
   * Ao contrário da inscrição pública, aqui **dizer** que já existe não abre
   * oráculo nenhum: quem chama isto já tem `member:write` e já vê o livro todo.
   *
   * ## Sem consentimento carimbado
   *
   * `acceptedTermsAt` fica nulo. O sócio deu os termos ao clube muito antes
   * desta plataforma existir, numa data que a folha não traz — e carimbar o
   * momento da importação seria fabricar a prova que o RGPD pede ao clube.
   */
  async importMembers(ctx: RequestContext, rows: MemberImportRowDto[], createTiers = false) {
    this.mustWrite(ctx);
    if (rows.length === 0) throw new BadRequestException("A folha não tem linhas");

    const now = new Date();

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const tiers = await db.memberTier.findMany({
        where: { archivedAt: null },
        select: { id: true, name: true, minAge: true, maxAge: true },
      });
      const tierByName = new Map(tiers.map((t) => [fold(t.name), t]));

      /*
       * As categorias que a folha traz e o clube não tem.
       *
       * Comparadas **sem caixa e sem acentos** (`fold`): "socio ouro", "Sócio
       * Ouro" e "SÓCIO OURO" são o mesmo tipo de sócio escrito por três pessoas
       * diferentes, e recusar a folha por causa disso é fazer a secretaria
       * trabalhar para o programa.
       *
       * O que sobra depois disso é uma categoria a sério que o clube não tem. Não
       * se cria sozinha — uma categoria a mais são quotas, benefícios e uma linha
       * no site — mas também não faz a importação falhar: devolve-se a lista, e
       * quem está a importar responde. Ver `MemberImportDto.createTiers`.
       */
      const desconhecidas = new Map<string, string>();
      for (const row of rows) {
        const nome = row.tier.trim();
        if (!nome || tierByName.has(fold(nome))) continue;
        if (!desconhecidas.has(fold(nome))) desconhecidas.set(fold(nome), nome);
      }

      if (desconhecidas.size > 0) {
        if (!createTiers) {
          return {
            ok: false as const,
            created: 0,
            duplicates: [],
            problems: [],
            unknownTiers: [...desconhecidas.values()],
          };
        }

        // A ordem vem a seguir às que já existem, para as novas ficarem no fim da
        // lista em vez de se meterem pelo meio de uma ordenação que o clube fez.
        const ultima = await db.memberTier.aggregate({ _max: { order: true } });
        let ordem = (ultima._max.order ?? 0) + 1;

        for (const nome of desconhecidas.values()) {
          const criada = await db.memberTier.create({
            data: { academyId: ctx.academyId, name: nome, order: ordem++, isPublic: false },
            select: { id: true, name: true, minAge: true, maxAge: true },
          });
          tierByName.set(fold(criada.name), criada);
        }
      }

      const existing = await db.member.findMany({ select: { taxId: true, number: true } });
      const takenTaxIds = new Set(existing.map((m) => m.taxId).filter((t): t is string => !!t));
      const takenNumbers = new Set(existing.map((m) => m.number).filter((n): n is number => n !== null));

      const problems: { line: number; reason: string }[] = [];
      const duplicates: { line: number; name: string }[] = [];
      const create: Prisma.MemberCreateManyInput[] = [];

      rows.forEach((row, i) => {
        const line = row.line ?? i + 2;
        const taxId = row.taxId?.replace(/[\s.]/g, "") || null;

        /*
         * Já cá está?
         *
         * Pelo **número** primeiro, que é o que identifica um sócio no livro do
         * clube — e que agora a folha traz sempre. Antes a chave era o NIF, e com
         * o NIF a deixar de ser obrigatório uma segunda importação da mesma folha
         * duplicava o clube inteiro com números novos.
         */
        if (takenNumbers.has(row.number) || (taxId && takenTaxIds.has(taxId))) {
          duplicates.push({ line, name: row.name.trim() });
          return;
        }
        takenNumbers.add(row.number);
        if (taxId) takenTaxIds.add(taxId);

        let birthdate: Date | null = null;
        if (row.birthdate) {
          try {
            birthdate = this.plausibleBirthdate(row.birthdate);
          } catch {
            problems.push({ line, reason: "Data de nascimento inválida" });
            return;
          }
        }

        const tier = tierByName.get(fold(row.tier))!;
        // A idade só se verifica quando a folha traz a data. Sem ela não há
        // nada a verificar — e recusar a linha por isso seria voltar a exigir a
        // data de nascimento pela porta das traseiras.
        if (birthdate) {
          const age = ageAt(birthdate, now);
          if (tier.minAge != null && age < tier.minAge) {
            problems.push({ line, reason: `"${tier.name}" é a partir dos ${tier.minAge} anos` });
            return;
          }
          if (tier.maxAge != null && age > tier.maxAge) {
            problems.push({ line, reason: `"${tier.name}" é até aos ${tier.maxAge} anos` });
            return;
          }
        }

        create.push({
          academyId: ctx.academyId,
          tierId: tier.id,
          number: row.number,
          name: row.name.trim(),
          email: row.email?.trim().toLowerCase() || null,
          birthdate,
          country: (row.country ?? "PT").toUpperCase().slice(0, 2),
          address: row.address?.trim() || null,
          postalCode: row.postalCode?.trim() || null,
          city: row.city?.trim() || null,
          phoneCountry: row.phoneCountry ?? "+351",
          phone: row.phone.replace(/\s/g, ""),
          sex: (row.sex as MemberSex) ?? "UNSPECIFIED",
          documentKind: (row.documentKind as MemberDocumentKind) ?? "CC",
          documentNumber: row.documentNumber?.trim() || null,
          taxId,
          // Quem vem da folha do clube já é sócio. Pô-los todos por aprovar
          // dava à direção uma fila de centenas de aprovações que não são
          // decisões nenhumas.
          status: (row.status as MemberStatus) ?? "ACTIVE",
          acceptedTermsAt: null,
          approvedAt: now,
          approvedById: ctx.membershipId,
          source: "importacao",
          updatedAt: now,
        });
      });

      if (problems.length > 0) {
        return { ok: false as const, created: 0, duplicates: [], problems: problems.slice(0, 50), unknownTiers: [] };
      }

      // Ou entra o livro todo, ou não entra nada: o `runAs` já corre tudo isto
      // dentro de uma transacção, e um `createMany` é uma instrução só.
      if (create.length > 0) await db.member.createMany({ data: create });

      return { ok: true as const, created: create.length, duplicates, problems: [], unknownTiers: [] };
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

/**
 * Um nome de categoria como uma pessoa o leria.
 *
 * "Sócio Efectivo", "socio efectivo" e "SÓCIO  EFECTIVO" são a mesma categoria
 * para quem escreveu a folha, e recusar a importação por causa de um acento
 * seria fazer a pessoa adivinhar como é que o clube a escreveu aqui dentro.
 */
function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().replace(/\s+/g, " ").toLowerCase();
}

function ageAt(birthdate: Date, now: Date): number {
  let age = now.getUTCFullYear() - birthdate.getUTCFullYear();
  const m = now.getUTCMonth() - birthdate.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birthdate.getUTCDate())) age--;
  return age;
}

/**
 * Um conflito de unicidade — e, quando possível, em que campo.
 *
 * O `meta.target` do Prisma vem nulo nesta base de dados, por isso um alvo
 * desconhecido conta como conflito: é sempre melhor do que devolver 500 a quem
 * escreveu um NIF repetido. Quem chama isto verifica o campo antes de escrever;
 * este ramo é a rede por baixo, para a corrida entre duas inscrições no mesmo
 * instante.
 */
function isUniqueViolation(error: unknown, field: string): boolean {
  const e = error as { code?: string; meta?: { target?: string[] | string | null } };
  if (e?.code !== "P2002") return false;
  const target = e.meta?.target;
  if (target === null || target === undefined) return true;
  return Array.isArray(target) ? target.includes(field) : String(target).includes(field);
}
