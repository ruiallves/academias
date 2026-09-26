import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { assertZeroOuCobravel } from "../billing/minimos";
import type { MemberDocumentKind, MemberSex, MemberStatus, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { can, type RequestContext } from "../common/permissions";
import { CARD_QR_PREFIX } from "../club-app/club-app.service";
import { MemberInvitesService } from "./member-invites.service";
import { ligarFichaAConta } from "./member-account-link";
import { AreaAbertaService } from "../mail/area-aberta.service";
import { nomeDeQuemMexe, registarAlteracoes } from "../common/historico";
import { partesNoFuso } from "../common/fuso";
import { aberturaAnual, gerarQuotas, periodoCorrente, periodoDaQuota, refazerAnoDeQuotas, situacaoDeQuotas } from "./member-fees.service";
import { decisaoDoAnoDaFolha } from "./cobertura";
import { PHOTO_BUCKET, PHOTO_TTL } from "../storage/photos.service";
import { StorageService } from "../storage/storage.service";
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
    private readonly storage: StorageService,
    private readonly aviso: AreaAbertaService,
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
          feeCents: true, billing: true, minAge: true, maxAge: true,
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

        /*
         * O recibo de quem se inscreveu.
         *
         * Sem segurar a resposta (`void`): a página de adesão não espera pelo
         * Resend para dizer "recebemos". E só aqui — no caminho em que a ficha
         * **nasceu**. Nos dois ramos que respondem o mesmo sem criar nada (NIF
         * já inscrito) não sai email nenhum, o que mantém a resposta única e
         * não confirma a ninguém que aquele NIF já é sócio.
         */
        void this.invites.avisarPedidoRecebido(academyId, member.id);

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

    const lista = await this.prisma.runAs(ctx.academyId, async (db) => {
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
          /*
           * A ficha completa, para a lista se poder exportar e voltar.
           *
           * A exportação de sócios tem de sair com **as colunas da importação**,
           * senão o ida-e-volta não fecha: o clube exporta, corrige um campo em
           * todos numa folha de cálculo, e volta a carregar. Sem a morada e o
           * NIF aqui, a folha exportada vinha sem eles e a reimportação
           * limpava-os a toda a gente.
           *
           * São sete campos por linha e quem chama já tem `member:read` — a
           * ficha inteira está a um clique na página do sócio.
           */
          address: true, postalCode: true, country: true,
          documentKind: true, documentNumber: true, taxId: true, sex: true,
          /* O ano de quotas, pela mesma razão: sai na folha e volta por ela. */
          annualStartDay: true, annualStartMonth: true,
          /*
           * O estado da app, para a coluna com o mesmo nome.
           *
           * Três coisas diferentes que a lista tem de saber distinguir: **tem
           * conta** (`userId`), **foi convidado e ainda não entrou**
           * (`inviteSentAt`), e **não tem email** — que é o motivo por que
           * metade de um livro importado nunca poderá ser convidada até alguém
           * lhe acrescentar o endereço. Sem esta distinção, o envio em massa
           * seria um tiro no escuro.
           */
          userId: true, inviteSentAt: true, photoKey: true,
          tier: { select: { id: true, name: true, feeCents: true, billing: true } },
        },
      });

      const counts = await db.member.groupBy({ by: ["status"], _count: { _all: true } });

      /*
       * A última quota paga de cada sócio — numa consulta, não numa por linha.
       *
       * `_max` sobre `period` funciona porque o período é `AAAA-MM`: ordenar
       * texto nesse formato é ordenar tempo, e é a mesma propriedade de que as
       * mensalidades já dependem em todo o lado. Um `MAX(period)` responde à
       * pergunta certa — *qual foi a última que ele pagou* — sem trazer o
       * histórico inteiro para o servidor.
       *
       * Só as liquidadas: uma quota `OPEN` é precisamente o contrário do que
       * esta coluna mostra, e uma `VOID` (anulada) nunca foi paga por ninguém.
       */
      const pagas = await db.memberFee.groupBy({
        by: ["memberId"],
        where: { memberId: { in: rows.map((m) => m.id) }, status: "SETTLED" },
        _max: { period: true },
      });
      const ultimaPaga = new Map(pagas.map((p) => [p.memberId, p._max.period]));

      /*
       * A abertura do clube, para a lista poder dizer a de cada sócio **sem
       * nulos**.
       *
       * Na base o campo é nulo em quem herda; na folha exportada não pode ser:
       * um sócio que está na plataforma tem sempre um ano de quotas, e uma
       * célula vazia na exportação seria lida na reimportação como "assume
       * hoje" e mudava-lhe a anuidade. Resolve-se aqui, onde o valor herdado
       * ainda se sabe de onde vem.
       */
      const clube = await aberturaAnual(db, ctx.academyId);

      return {
        /*
         * `userId` não sai daqui — sai o que ele **significa**.
         *
         * A lista precisa de saber se o sócio já tem conta; não precisa do id
         * da conta, e mandá-lo seria dar à consola um identificador de outra
         * pessoa sem nenhum ecrã a usá-lo.
         */
        members: rows.map(({ userId, inviteSentAt, annualStartDay, annualStartMonth, ...m }) => ({
          ...m,
          app: userId ? ("account" as const) : inviteSentAt ? ("invited" as const) : m.email ? ("none" as const) : ("noemail" as const),
          inviteSentAt,
          /** Quando abre o ano de quotas deste sócio, `MM-DD`. Nunca vazio. */
          annualStart: `${String(annualStartMonth ?? clube.mes).padStart(2, "0")}-${String(annualStartDay ?? clube.dia).padStart(2, "0")}`,
          /** O período (`AAAA-MM`) da última quota liquidada. Nulo = nunca pagou nenhuma. */
          lastPaidPeriod: ultimaPaga.get(m.id) ?? null,
        })),
        counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
      };
    });

    /*
     * As fotografias assinam-se **depois** de a transação fechar — rede dentro
     * do `runAs` segurava uma ligação do pool durante a viagem ao Supabase, e o
     * sintoma aparecia na consola inteira (ver `AcademyService.withPhotos`).
     */
    const assinadas = await this.storage.signMany(
      PHOTO_BUCKET,
      lista.members.map((m) => m.photoKey).filter((k): k is string => Boolean(k)),
      PHOTO_TTL,
    );
    return {
      ...lista,
      members: lista.members.map(({ photoKey, ...m }) => ({
        ...m,
        photoUrl: photoKey ? (assinadas.get(photoKey) ?? null) : null,
      })),
    };
  }

  /** A ficha completa. Documento e morada só se leem aqui, não na lista. */
  async detail(ctx: RequestContext, id: string) {
    this.mustRead(ctx);

    const ficha = await this.prisma.runAs(ctx.academyId, async (db) => {
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
          /* Quando abre o ano de quotas deste sócio. Nulos = a abertura do
             clube; a ficha mostra qual é e deixa mudá-la. */
          annualStartDay: true, annualStartMonth: true,
          /* A app do clube: a ficha diz se a conta já foi reclamada e quando
             saiu o último convite — é o que decide o texto do botão. */
          userId: true, inviteSentAt: true, photoKey: true,
          tier: { select: { id: true, name: true, feeCents: true, billing: true } },
          approvedBy: { select: { user: { select: { name: true } } } },
        },
      });
      if (!m) throw new NotFoundException("Sócio não encontrado");

      /*
       * A situação de quotas vem com a ficha, e não num segundo pedido.
       *
       * É a primeira coisa que quem abre a ficha quer saber — "está em dia?" —
       * e é uma linha do cabeçalho, não um separador que se abre. Pedi-la à
       * parte punha o cabeçalho a desenhar-se duas vezes, a segunda com a
       * resposta. A lista de quotas essa sim é do separador, e continua no seu
       * pedido (`GET :id/fees`).
       */
      const fees = await situacaoDeQuotas(db, ctx.academyId, m.id);

      /* A abertura que vale para este sócio — a dele, ou a do clube. A ficha
         mostra as duas coisas: o valor em uso e se é herdado. */
      const clube = await aberturaAnual(db, ctx.academyId);
      const annual = {
        month: m.annualStartMonth ?? clube.mes,
        day: m.annualStartDay ?? clube.dia,
        /* `false` = está a herdar a abertura do clube. */
        own: m.annualStartMonth != null,
        clubMonth: clube.mes,
        clubDay: clube.dia,
      };

      return {
        ...m,
        approvedBy: m.approvedBy?.user.name ?? null,
        fees,
        annual,
        /* O mesmo que a lista manda, e com o mesmo nome: a ficha é uma linha da
           lista com mais campos, e um tipo que herda o outro não pode prometer
           um campo que só metade das respostas traz. Ver `MemberDetail`. */
        annualStart: `${String(annual.month).padStart(2, "0")}-${String(annual.day).padStart(2, "0")}`,
      };
    });

    // Rede fora da transação — ver `list`.
    const { photoKey, ...resto } = ficha;
    const photoUrl = photoKey ? await this.storage.signDownload(PHOTO_BUCKET, photoKey, PHOTO_TTL) : null;
    return { ...resto, photoUrl };
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

    /*
     * Quem a ficha ganhou por dono, se ganhou algum. Vive **fora** do `runAs`
     * porque o aviso só pode sair depois de a transacção fechar: um email que
     * anuncia uma área que um rollback desfez não volta atrás.
     */
    let ligado: { userId: string; name: string; email: string } | null = null;

    return this.prisma.runAs(ctx.academyId, async (db) => {
      // O antes, para o histórico da ficha (ver `common/historico.ts`).
      const member = await db.member.findFirst({
        where: { id },
        select: {
          id: true, status: true, number: true, acceptedTermsAt: true, tierId: true, notes: true,
          name: true, email: true, phone: true, phoneCountry: true, address: true, postalCode: true,
          city: true, country: true, birthdate: true, sex: true, documentKind: true,
          documentNumber: true, taxId: true, annualStartMonth: true,
        },
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

      /*
       * Um sócio não pode ficar sem contacto nenhum.
       *
       * É a mesma regra da inscrição (`create`): **email ou telemóvel**, pelo
       * menos um. Faltava aqui, e a falta era do género que só se vê tarde —
       * a ficha de um sócio editada até ficar sem os dois é uma linha que
       * ninguém consegue usar para cobrar a quota nem para convocar a
       * assembleia, e nada no caminho o impedia.
       *
       * Compara-se o **resultado**, e não o que veio no corpo: apagar o email
       * de quem tem telemóvel é legítimo, apagar o email de quem só tem email
       * não é. Um campo que não vem no pedido fica como está.
       */
      const emailDepois = dto.email !== undefined ? dto.email.trim() : (member.email ?? "");
      const telemovelDepois = dto.phone !== undefined ? dto.phone.trim() : (member.phone ?? "");
      if (!emailDepois && !telemovelDepois) {
        throw new BadRequestException("Um sócio precisa de pelo menos um contacto — email ou telemóvel");
      }

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
      /*
       * Entrou agora: saiu de "por aprovar" para activo. É isto, e não o número,
       * que abre o ano de quotas e lança a quota. Um pedido a que a secretaria
       * já tinha dado número à mão também é uma aprovação, e ficava sem quota.
       */
      const entrouAgora = member.status === "PENDING" && dto.status === "ACTIVE";
      if (dto.status !== undefined && dto.status !== member.status) {
        data.status = dto.status as MemberStatus;

        if (dto.status === "ACTIVE" && !member.number) {
          data.number = await this.reservarNumero(db, ctx.academyId);
          data.approvedAt = new Date();
          data.approvedById = ctx.membershipId;
          aprovadoAgora = true;
        }
        if (entrouAgora) {
          /*
           * O ano de quotas abre no dia da aprovação.
           *
           * Quem adere pelo site nasce sem data sua e herdava a abertura do
           * clube (1 de Janeiro, por omissão): aprovado a 24 de Setembro, ficava
           * com um ano que já ia em três quartos. É a mesma regra de quem é
           * inscrito à mão (`aberturaDoDto`), contada a partir do dia em que o
           * clube o aceita, pelo relógio do clube. Uma ficha que já tem a sua
           * data (a secretaria escolheu-a ao criar) fica com ela.
           */
          if (member.annualStartMonth == null) {
            const { mes, dia } = partesNoFuso(new Date());
            data.annualStartMonth = mes;
            data.annualStartDay = dia;
          }
        }
      }

      // Um número escrito à mão ganha ao automático: clubes antigos têm livros de
      // sócios que já existiam antes deste produto, e a numeração é deles. É
      // também como se enche um buraco deixado por uma ficha apagada.
      if (dto.number !== undefined) {
        data.number = dto.number ?? null;
        await this.marcarNumero(db, ctx.academyId, dto.number);
      }

      try {
        const gravado = await db.member.update({
          where: { id },
          data,
          select: { id: true, email: true, userId: true },
        });
        /* Um email novo pode ser o de uma conta deste clube — ver `create`. */
        if (dto.email !== undefined) ligado = await ligarFichaAConta(db, gravado);

        // O histórico da ficha: quem mudou o quê. Ver `common/historico.ts`.
        /*
         * A data de abertura posta pela aprovação é consequência dela, não uma
         * edição: fica fora do histórico, dos dois lados.
         */
        const {
          updatedAt: _ignora, approvedById: _quem, approvedAt: _quando,
          annualStartMonth: _mes, annualStartDay: _dia,
          ...mudou
        } = data as Record<string, unknown>;

        /*
         * A categoria vai por nome e não por `tierId`: quem lê o histórico quer
         * ler "Atleta → Sénior", e um identificador não diz nada a ninguém.
         */
        const idsDeCategoria = [member.tierId, mudou.tierId as string | null | undefined].filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        );
        const categorias = idsDeCategoria.length
          ? await db.memberTier.findMany({ where: { id: { in: idsDeCategoria } }, select: { id: true, name: true } })
          : [];
        const categoria = (v: unknown) =>
          typeof v === "string" ? (categorias.find((t) => t.id === v)?.name ?? v) : v === null ? null : undefined;
        const { tierId: _antesTier, annualStartMonth: _mesAntes, ...restoAntes } = member;
        const { tierId: _depoisTier, ...restoDepois } = mudou;

        await registarAlteracoes(
          db,
          ctx,
          "MEMBER",
          id,
          { ...restoAntes, categoria: categoria(member.tierId) },
          { ...restoDepois, ...("tierId" in mudou ? { categoria: categoria(mudou.tierId) } : {}) },
          await nomeDeQuemMexe(db, ctx),
        );
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

      /*
       * A quota de quem acabou de ser aprovado, já.
       *
       * Esperava pela passagem automática, e essa só lança cada clube uma vez
       * por mês: aprovado a meio do mês, o sócio ficava sem quota até ao mês
       * seguinte. Numa categoria anual nasce a anuidade que abre hoje e fecha
       * daqui a um ano; numa mensal, a do mês corrente. Só deste sócio, e pelo
       * mesmo gerador da passagem automática, que respeita as apagadas pela
       * direcção e as coberturas que já existam.
       */
      if (entrouAgora) {
        /*
         * O dia de hoje no relógio do clube, ao meio-dia UTC. O ciclo anual
         * (`inicioDaEpoca`) lê o relógio do servidor, que é UTC: entre a
         * meia-noite e a uma de Lisboa, no Verão, o UTC ainda está em ontem, e
         * um ano que abre hoje dava-se como não aberto. Saía a anuidade do ano
         * passado. Ao meio-dia UTC do dia de Lisboa, os dois relógios dizem o
         * mesmo dia.
         */
        const { ano, mes, dia } = partesNoFuso(new Date());
        const hojeNoClube = new Date(Date.UTC(ano, mes - 1, dia, 12));
        await gerarQuotas(db, ctx.academyId, periodoCorrente(hojeNoClube), hojeNoClube, [id]);
      }

      return { ok: true, aprovadoAgora };
    }).then((r) => {
      /* Quem aderiu pelo site recebe o convite quando o clube o aceita —
         sem segurar a resposta, como na criação. */
      if (r.aprovadoAgora) void this.invites.enviarSePossivel(ctx.academyId, id);
      /* E quem ganhou a área de sócio por o email corrigido ser o da conta dele
         fica a saber — não houve convite. Ver `AreaAbertaService`. */
      if (ligado) void this.aviso.avisar(ctx.academyId, "member", ligado);
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

    const member = await this.prisma.runAs(ctx.academyId, (db) =>
      db.member.findFirst({
        where: { cardToken: token },
        select: {
          name: true, number: true, status: true, photoKey: true,
          tier: { select: { name: true } },
        },
      }),
    );
    if (!member) throw new NotFoundException("Cartão não reconhecido");

    /* A cara ao lado do nome: é para isso que a portaria lê o cartão. */
    return {
      name: member.name,
      number: member.number,
      status: member.status,
      tierName: member.tier?.name ?? null,
      photoUrl: member.photoKey ? await this.storage.signDownload(PHOTO_BUCKET, member.photoKey, PHOTO_TTL) : null,
    };
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
   * ## Já houve um travão no número, e estava no sítio errado
   *
   * Com número atribuído, isto recusava e mandava cancelar. O argumento era que
   * apagar liberta um número que já foi de alguém, e um livro com o 34 a
   * pertencer a duas pessoas ao longo do tempo deixa de servir. O problema é
   * real; o travão estava no gesto errado.
   *
   * Quem apaga é a direcção, com a ficha à frente, e sabe o que está a fazer —
   * o que não se podia era **o número voltar sozinho à fila**. Isso resolve-se
   * na numeração e não na porta: o número apagado fica aberto e só se enche à
   * mão (ver `reservarNumero`). E o travão fechava o caso que o motivou: fichas
   * de teste, e inscrições repetidas já aprovadas, que ficavam no livro para
   * sempre porque tinham ganho um número.
   *
   * ## O que sai com a ficha, e o que fica
   *
   * **Sai:** as quotas e os pagamentos delas (`MemberFee`, em cascata,
   * **incluindo as pagas**), os votos em sondagens, a fotografia, e o número —
   * que fica aberto.
   *
   * **Fica:** os lançamentos de tesouraria, que referem o sócio com `SetNull` —
   * o dinheiro do clube não muda porque uma ficha saiu. E fica a **conta** de
   * quem tinha app: `Member.userId` é a ponte, não a conta, e a mesma pessoa
   * pode ser encarregado de educação no mesmo clube. O que essa conta perde é o
   * contexto de sócio.
   *
   * Nada disto é reversível, e é por isso que quem pergunta tem de ver os
   * números antes — a ficha traz `fees.total` e `fees.settledCount` para o
   * diálogo os poder dizer.
   */
  async remove(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    const apagado = await this.prisma.runAs(ctx.academyId, async (db) => {
      const member = await db.member.findFirst({
        where: { id },
        select: { id: true, name: true, number: true, photoKey: true },
      });
      if (!member) throw new NotFoundException("Sócio não encontrado");

      await db.member.delete({ where: { id } });
      return member;
    });

    // A fotografia deixa de ter dono — sai com a ficha, senão fica no bucket
    // sem ninguém saber que está lá.
    if (apagado.photoKey) await this.storage.remove(PHOTO_BUCKET, apagado.photoKey).catch(() => undefined);

    /* O número devolvido é o que a consola diz ter ficado aberto. */
    return { ok: true, freedNumber: apagado.number };
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
    /* Fora do `runAs` — ver a nota em `update`. */
    let ligado: { userId: string; name: string; email: string } | null = null;

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
      const number = dto.number ?? (status === "PENDING" ? null : await this.reservarNumero(db, ctx.academyId));
      if (dto.number != null) await this.marcarNumero(db, ctx.academyId, dto.number);

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
            /*
             * O ano de quotas deste sócio abre hoje, salvo indicação em
             * contrário. Grava-se em toda a gente e não só nas categorias
             * anuais: a categoria muda, a data de adesão não, e uma ficha que
             * passe a anual amanhã tem de ter o aniversário no dia em que
             * entrou — não na janela do clube.
             */
            ...aberturaDoDto(dto.annualStart, now),
            updatedAt: now,
          },
          select: { id: true, name: true, number: true, email: true, userId: true },
        });

        /*
         * O email é de alguém que já tem conta neste clube — o treinador, o
         * pai de um atleta? Então a ficha é dele desde já, e o convite que sai
         * a seguir não sai (`preparar` recusa fichas com dono): não se manda
         * "cria a tua conta" a quem já a tem.
         */
        ligado = await ligarFichaAConta(db, member);

        return { id: member.id, name: member.name, number: member.number };
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
       *
       * A não ser que quem inscreveu tenha dito que não. `sendInvite` ausente
       * é `true`: o comportamento de sempre fica, e desligar passou a ser
       * possível para quem carrega a ficha antes de a pessoa saber que vai ser
       * inscrita. Ver `MemberCreateDto.sendInvite`.
       */
      if (dto.sendInvite !== false) void this.invites.enviarSePossivel(ctx.academyId, member.id);
      /*
       * E se a ficha se colou a uma conta que já existia, não houve convite
       * nenhum: o aviso da área nova toma o lugar dele. Respeita o mesmo
       * `sendInvite`, porque quem carrega a ficha antes de a pessoa saber que vai
       * ser inscrita também não quer que ela receba isto.
       */
      if (ligado && dto.sendInvite !== false) void this.aviso.avisar(ctx.academyId, "member", ligado);
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
   * ## Quem já cá está é a mesma pessoa, não um erro
   *
   * Uma linha que corresponde a um sócio do livro pára a importação e é
   * devolvida na lista `existing`, com o nome de quem foi encontrado e os
   * campos que iam mudar. Quem está a importar vê **antes** de acontecer, e
   * responde: substituir, ou não. Com `sobrescrever`, essas linhas passam a
   * actualizar a ficha em vez de a duplicar — é o que torna possível corrigir
   * um campo em todo o clube numa folha de cálculo.
   *
   * ## Como se reconhece a mesma pessoa
   *
   * Pelo **número** de sócio primeiro, que é a identidade no livro do clube.
   * Depois pelo **NIF**. E, por fim, pelo **contacto** — o email ou o telemóvel
   * —, mas só quando esse contacto pertence a um sócio e a mais nenhum: num
   * clube há casais e irmãos a partilhar o telefone de casa, e um contacto
   * repetido não identifica ninguém. Quando é ambíguo, a linha é devolvida como
   * problema em vez de escolher uma ficha à sorte.
   *
   * Mesmo assim, a confirmação mostra sempre o nome encontrado ao lado do nome
   * da folha: uma correspondência errada vê-se antes de ser aplicada.
   *
   * ## Ao contrário da inscrição pública
   *
   * Aqui **dizer** que já existe não abre oráculo nenhum: quem chama isto já
   * tem `member:write` e já vê o livro todo.
   *
   * ## Sem consentimento carimbado
   *
   * `acceptedTermsAt` fica nulo. O sócio deu os termos ao clube muito antes
   * desta plataforma existir, numa data que a folha não traz — e carimbar o
   * momento da importação seria fabricar a prova que o RGPD pede ao clube.
   */
  async importMembers(
    ctx: RequestContext,
    rows: MemberImportRowDto[],
    createTiers = false,
    opts: { sobrescrever?: boolean; enviarConvites?: boolean } = {},
  ) {
    this.mustWrite(ctx);
    if (rows.length === 0) throw new BadRequestException("A folha não tem linhas");

    const now = new Date();
    /*
     * As fichas da folha que se colaram a contas que já existiam.
     *
     * Fora do `runAs` e avisadas **depois** dele, e aqui isso não é um detalhe:
     * a importação é tudo-ou-nada, e uma folha que rebenta na última linha volta
     * atrás. Trezentos emails a anunciar áreas que deixaram de existir não voltam.
     */
    const ligados: { userId: string; name: string; email: string }[] = [];

    const resultado = await this.prisma.runAs(ctx.academyId, async (db) => {
      const tiers = await db.memberTier.findMany({
        where: { archivedAt: null },
        /* `billing` porque a coluna do ano de quotas só mexe em quem é anual. */
        select: { id: true, name: true, minAge: true, maxAge: true, billing: true, feeCents: true, archivedAt: true },
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
            ...VAZIO,
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
            select: { id: true, name: true, minAge: true, maxAge: true, billing: true, feeCents: true, archivedAt: true },
          });
          tierByName.set(fold(criada.name), criada);
        }
      }

      /*
       * O livro como está, indexado pelas três formas de reconhecer alguém.
       *
       * O contacto guarda-se com a **contagem**: um email ou um telefone que
       * pertence a dois sócios não identifica nenhum, e o que se faz com ele é
       * dizê-lo, não escolher. Ver o cabeçalho.
       */
      const livro = await db.member.findMany({
        /* A abertura do ano também, para a confirmação poder dizer que muda. */
        select: {
          id: true, name: true, number: true, taxId: true, email: true, phone: true,
          annualStartMonth: true, annualStartDay: true,
        },
      });

      const porNumero = new Map<number, Existente>();
      const porNif = new Map<string, Existente>();
      const porContacto = new Map<string, Existente | "ambiguo">();

      for (const m of livro) {
        if (m.number !== null) porNumero.set(m.number, m);
        if (m.taxId) porNif.set(m.taxId, m);
        for (const contacto of contactosDe(m)) {
          porContacto.set(contacto, porContacto.has(contacto) ? "ambiguo" : m);
        }
      }

      const problems: { line: number; reason: string }[] = [];
      const duplicates: { line: number; name: string }[] = [];
      const existing: LinhaExistente[] = [];
      const create: Prisma.MemberCreateManyInput[] = [];
      const update: { id: string; data: Prisma.MemberUpdateInput }[] = [];
      /* Números e NIFs que a própria folha já usou — duas linhas iguais na
         mesma folha não são duas pessoas. */
      const naFolha = { numeros: new Set<number>(), nifs: new Set<string>() };
      /*
       * As fichas já existentes a quem a folha muda o ano de quotas.
       *
       * Mudar a data **refaz o ano** (ver `refazerAnoDeQuotas`), e refazê-lo é
       * apagar quotas: não pode acontecer no meio do `createMany`. Anota-se aqui
       * e trata-se no fim, depois de as fichas estarem escritas.
       */
      const refazer: { id: string; mes: number; dia: number; tier: (typeof tiers)[number] }[] = [];
      /* Quem entra pela folha começa o ano hoje, como quem é inscrito à mão.
         Pelo relógio do clube: às 00:30 de Lisboa o UTC ainda é ontem. */
      const abreHoje = partesNoFuso(now);

      rows.forEach((row, i) => {
        const line = row.line ?? i + 2;
        const taxId = row.taxId?.replace(/[\s.]/g, "") || null;

        /*
         * Duas linhas da mesma folha a dizer a mesma pessoa. Isso é engano de
         * quem escreveu a folha, e não tem confirmação que valha: fica de fora.
         */
        if (naFolha.numeros.has(row.number) || (taxId && naFolha.nifs.has(taxId))) {
          duplicates.push({ line, name: row.name.trim() });
          return;
        }
        naFolha.numeros.add(row.number);
        if (taxId) naFolha.nifs.add(taxId);

        /*
         * Já cá está?
         *
         * Número, NIF, contacto — por esta ordem. Ver o cabeçalho para o porquê
         * de o contacto ser o último e de um contacto repartido não contar.
         */
        const achado = porNumero.get(row.number) ?? (taxId ? porNif.get(taxId) : undefined) ?? contactoDaLinha(row, porContacto);

        if (achado === "ambiguo") {
          problems.push({
            line,
            reason: "O contacto desta linha pertence a mais do que um sócio — põe o número de sócio para dizer qual",
          });
          return;
        }

        let birthdate: Date | null = null;
        if (row.birthdate) {
          try {
            birthdate = this.plausibleBirthdate(row.birthdate);
          } catch {
            problems.push({ line, reason: "Data de nascimento inválida" });
            return;
          }
        }

        /* O que a coluna do ano de quotas faz a esta linha. A regra vive
           inteira, junta e sem Prisma, em `decisaoDoAnoDaFolha`. */
        const ano = decisaoDoAnoDaFolha(
          row.annualStart?.trim() || null,
          achado ?? null,
          abreHoje,
        );
        const abertura = ano.grava
          ? { annualStartMonth: ano.grava.mes, annualStartDay: ano.grava.dia }
          : null;

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

        /*
         * O que a folha diz desta pessoa.
         *
         * Um campo que a folha não traz **não entra** — nem a criar (fica nulo,
         * como sempre) nem a substituir. Uma folha sem a coluna da morada não é
         * um clube a dizer que ninguém tem morada; apagar o que já lá está por
         * causa de uma coluna em falta seria a pior maneira de perder dados.
         */
        const daFolha = {
          tierId: tier.id,
          name: row.name.trim(),
          ...(row.email !== undefined ? { email: row.email.trim().toLowerCase() || null } : {}),
          ...(birthdate ? { birthdate } : {}),
          ...(row.country !== undefined ? { country: (row.country || "PT").toUpperCase().slice(0, 2) } : {}),
          ...(row.address !== undefined ? { address: row.address.trim() || null } : {}),
          ...(row.postalCode !== undefined ? { postalCode: row.postalCode.trim() || null } : {}),
          ...(row.city !== undefined ? { city: row.city.trim() || null } : {}),
          ...(row.phoneCountry !== undefined ? { phoneCountry: row.phoneCountry } : {}),
          phone: row.phone.replace(/\s/g, ""),
          ...(row.sex !== undefined ? { sex: row.sex as MemberSex } : {}),
          ...(row.documentKind !== undefined ? { documentKind: row.documentKind as MemberDocumentKind } : {}),
          ...(row.documentNumber !== undefined ? { documentNumber: row.documentNumber.trim() || null } : {}),
          ...(taxId ? { taxId } : {}),
          ...(row.status !== undefined ? { status: row.status as MemberStatus } : {}),
          ...(abertura ?? {}),
        };

        if (achado) {
          const mudam = camposQueMudam(achado, daFolha);

          /*
           * A linha é igual à ficha: não há nada para substituir, e por isso
           * não há nada a perguntar.
           *
           * É o caso normal de quem reimporta a folha do ano passado com três
           * nomes novos no fim. Parar para perguntar "substituir 300 fichas?"
           * sobre trezentas linhas que não mudam nada era transformar a
           * confirmação num carimbo que ninguém lê — e é a leitura dela que a
           * torna útil.
           */
          if (mudam.length === 0) {
            duplicates.push({ line, name: row.name.trim() });
            return;
          }

          if (!opts.sobrescrever) {
            existing.push({
              line,
              name: row.name.trim(),
              matchedName: achado.name,
              number: achado.number,
              changes: mudam,
            });
            return;
          }

          update.push({ id: achado.id, data: { ...daFolha, updatedAt: now } });
          if (ano.refaz && ano.grava) {
            refazer.push({ id: achado.id, mes: ano.grava.mes, dia: ano.grava.dia, tier });
          }
          return;
        }

        create.push({
          academyId: ctx.academyId,
          number: row.number,
          birthdate,
          country: (row.country ?? "PT").toUpperCase().slice(0, 2),
          phoneCountry: row.phoneCountry ?? "+351",
          sex: (row.sex as MemberSex) ?? "UNSPECIFIED",
          documentKind: (row.documentKind as MemberDocumentKind) ?? "CC",
          taxId,
          // Quem vem da folha do clube já é sócio. Pô-los todos por aprovar
          // dava à direção uma fila de centenas de aprovações que não são
          // decisões nenhumas.
          status: (row.status as MemberStatus) ?? "ACTIVE",
          ...daFolha,
          acceptedTermsAt: null,
          approvedAt: now,
          approvedById: ctx.membershipId,
          source: "importacao",
          updatedAt: now,
        });
      });

      if (problems.length > 0) {
        return { ...VAZIO, problems: problems.slice(0, 50) };
      }

      /*
       * A segunda pergunta: substituir quem já cá está?
       *
       * Pára **antes** de escrever fosse o que fosse — inclusive antes de criar
       * as linhas novas, que também esperam. Uma importação que cria metade e
       * pergunta pela outra metade deixa quem responde sem forma de voltar
       * atrás.
       */
      if (existing.length > 0) {
        return { ...VAZIO, existing: existing.slice(0, 200), existingTotal: existing.length };
      }

      // Ou entra o livro todo, ou não entra nada: o `runAs` já corre tudo isto
      // dentro de uma transacção, e um `createMany` é uma instrução só.
      if (create.length > 0) await db.member.createMany({ data: create });

      /*
       * As substituições, uma a uma.
       *
       * Não há `updateMany` que sirva: cada ficha leva os seus valores. São
       * poucas em relação ao tamanho da folha na maioria das importações, e
       * continuam todas dentro da mesma transacção — ou muda tudo, ou nada.
       */
      for (const u of update) await db.member.update({ where: { id: u.id }, data: u.data });

      /*
       * E o ano de quotas de quem a folha mudou.
       *
       * **Depois** das fichas, porque refazer o ano lê a categoria que a folha
       * acabou de escrever, e só nas **anuais**: numa categoria mensal a data
       * fica gravada à espera de um dia servir, e não há anuidade para refazer.
       *
       * Um travo aqui derruba a importação inteira, e é o que tem de acontecer:
       * a única coisa que trava é dinheiro que entrou pela euPago (ver
       * `razaoParaNaoApagar`), e deixar passar metade da folha com a outra
       * metade das anuidades por refazer era pior do que não entrar nada. A
       * transação volta tudo atrás.
       */
      for (const r of refazer) {
        await refazerAnoDeQuotas(
          db,
          ctx.academyId,
          {
            id: r.id,
            annualStartMonth: r.mes,
            annualStartDay: r.dia,
            tier: { feeCents: r.tier.feeCents, billing: r.tier.billing, archivedAt: r.tier.archivedAt },
          },
          now,
        );
      }

      /*
       * A marca de água sobe até ao maior número da folha.
       *
       * Um livro importado traz a numeração do clube — costuma ir nas centenas
       * — e sem isto a adesão seguinte recebia o 1. Ver `reservarNumero`.
       */
      await this.marcarNumero(db, ctx.academyId, Math.max(...create.map((m) => m.number ?? 0), 0));

      /*
       * O convite dos importados.
       *
       * Um sócio importado é um sócio inscrito pelo clube — a mesma coisa que a
       * criação à mão, feita cem vezes de uma vez. Faltava aqui, e a falta era
       * do género pior: um clube que carregasse o livro inteiro por Excel
       * ficava com trezentas fichas e zero convites, sem nada no ecrã a
       * dizer-lho, e teria de abrir ficha a ficha para os mandar.
       *
       * **Depois** do `createMany` e fora da transacção de escrita, pela mesma
       * razão dos outros ganchos: o Resend não pode segurar uma importação, e
       * um email que falhe não desfaz o livro que acabou de entrar. Quem ficar
       * sem email tem o botão da ficha e o envio em massa da lista.
       *
       * Só os que têm email — os outros nem token geram (ver `preparar`).
       */
      const importados = opts.enviarConvites ? create.filter((m) => m.email) : [];
      if (importados.length > 0) {
        const criados = await db.member.findMany({
          where: { taxId: { in: importados.map((m) => m.taxId).filter((t): t is string => Boolean(t)) } },
          select: { id: true, email: true, userId: true },
        });
        /*
         * Primeiro as contas que já existem (o treinador que vem no livro de
         * sócios), **depois** os convites: uma ficha com dono não gera convite,
         * e é assim que ninguém recebe "cria a tua conta" tendo-a já.
         */
        for (const m of criados) {
          const c = await ligarFichaAConta(db, m);
          if (c) ligados.push(c);
        }
        for (const m of criados) void this.invites.enviarSePossivel(ctx.academyId, m.id);
      }

      return {
        ...VAZIO,
        ok: true as const,
        created: create.length,
        updated: update.length,
        duplicates,
      };
    });

    /*
     * Os avisos das áreas abertas, com a folha já dentro. Respeitam o mesmo
     * interruptor dos convites: um clube que carrega o livro antigo sem querer
     * mandar correio nesse dia também não quer estes.
     */
    if (opts.enviarConvites && ligados.length > 0) {
      void this.aviso.avisarMuitos(ctx.academyId, "member", ligados);
    }

    return resultado;
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
          billing: true, minAge: true, maxAge: true, isPublic: true, order: true,
          _count: { select: { members: true } },
        },
      });

      return rows.map((t) => ({ ...t, members: t._count.members }));
    });
  }

  async createTier(ctx: RequestContext, dto: MemberTierInputDto) {
    this.mustWrite(ctx);

    if (dto.feeCents != null) assertZeroOuCobravel(dto.feeCents, "O preço");

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
            billing: dto.billing ?? "MONTHLY",
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
      const tier = await db.memberTier.findFirst({ where: { id }, select: { id: true, feeCents: true, billing: true } });
      if (!tier) throw new NotFoundException("Categoria não encontrada");
      if (dto.feeCents != null) assertZeroOuCobravel(dto.feeCents, "O preço");

      await db.memberTier.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
          ...(dto.benefits !== undefined
            ? { benefits: dto.benefits.map((b) => b.trim()).filter(Boolean).slice(0, 12) }
            : {}),
          ...(dto.feeCents !== undefined ? { feeCents: dto.feeCents ?? null } : {}),
          /*
           * Mudar de mensal para anual (ou ao contrário) não mexe nas quotas já
           * lançadas — essas são história, e reescrevê-las apagaria o que o
           * sócio já pagou. Muda o que nasce a partir de agora. O clube revê o
           * valor no mesmo formulário, que é onde se dá conta de que 30 por mês
           * não é 30 por ano.
           */
          ...(dto.billing !== undefined ? { billing: dto.billing } : {}),
          ...(dto.minAge !== undefined ? { minAge: dto.minAge ?? null } : {}),
          ...(dto.maxAge !== undefined ? { maxAge: dto.maxAge ?? null } : {}),
          ...(dto.isPublic !== undefined ? { isPublic: dto.isPublic } : {}),
          updatedAt: new Date(),
        },
      });

      /*
       * O preço novo, e as quotas que já estão lançadas.
       *
       * Mudar o valor da categoria nunca tocava no que já existia: um Sócio
       * Gold a 1 € passava a 0,01 € na categoria e continuava com a quota do
       * ano a 1 € na ficha e na app. Certo para o passado, errado para o
       * corrente — a direcção que baixa o preço em Setembro quer que o ano em
       * curso o reflicta, e não tinha como o dizer.
       *
       * Por isso pergunta-se (`applyToCurrent`). Com sim, as quotas **por
       * pagar** do período corrente dos sócios activos desta categoria passam
       * ao valor novo. Só as por pagar: uma paga é dinheiro que entrou, e
       * reescrevê-la era mentir sobre o que se recebeu. E só o período
       * corrente: os atrasos são de outros preços, de outros anos.
       *
       * Uma tentativa de pagamento em voo sobre uma dessas quotas expira: a
       * referência Multibanco tem o valor antigo, e o webhook recusaria o
       * pagamento por divergência. Expirada, a app pede uma nova ao valor certo.
       */
      const novoValor = dto.feeCents ?? null;
      let repriced = 0;
      if (dto.applyToCurrent && dto.feeCents !== undefined && novoValor !== null && novoValor !== tier.feeCents) {
        const billing = dto.billing ?? tier.billing;
        const { mes, dia } = await aberturaAnual(db, ctx.academyId);
        const period = periodoDaQuota(billing, new Date(), mes, dia);
        const abertas = (
          await db.memberFee.findMany({
            where: { period, status: "OPEN", member: { tierId: id, status: "ACTIVE" } },
            select: { id: true },
          })
        ).map((f) => f.id);

        if (abertas.length > 0) {
          await db.payment.updateMany({
            where: {
              status: { in: ["PENDING", "PROCESSING"] },
              OR: [{ memberFeeId: { in: abertas } }, { memberFees: { some: { memberFeeId: { in: abertas } } } }],
            },
            data: { status: "EXPIRED" },
          });
          const r = await db.memberFee.updateMany({ where: { id: { in: abertas } }, data: { amountCents: novoValor } });
          repriced = r.count;
        }
      }

      return { ok: true, repriced };
    });
  }

  /**
   * Apagar uma categoria.
   *
   * ## Isto arquivava, e o arquivo era um beco
   *
   * A regra era "nunca apagar enquanto tiver sócios", com o argumento de que os
   * sócios ficariam sem categoria e ninguém saberia porquê. O que saiu daí foi
   * pior: a consola **escondia o botão** a qualquer categoria com sócios, e não
   * havia caminho nenhum para a tirar da frente. Um clube que criou "Sócio
   * Prata" por engano e lhe atribuiu trinta pessoas ficava com ela para sempre.
   *
   * E o arquivo não guardava o que prometia guardar. `archivedAt` só era
   * escrito, nunca limpo, e a lista de categorias só mostra as não arquivadas:
   * não havia como desarquivar. Era um apagar que deixava a linha escondida na
   * base — com a agravante de a cobrança automática já ignorar quem tem
   * categoria arquivada (ver `emitirAutomaticas`), portanto os sócios já
   * ficavam sem quota sem que a ficha o dissesse.
   *
   * ## O que acontece agora
   *
   * Apaga-se, e os sócios ficam **sem categoria**. É o que quem carrega no
   * botão quer dizer, e é o que a consola avisa antes, com o número à frente.
   *
   * O `tierId` é posto a nulo aqui e não deixado ao `onDelete: SetNull` do
   * esquema: assim a contagem devolvida é a que aconteceu mesmo, e a intenção
   * fica escrita onde se lê, não numa regra da base que uma migração futura
   * pode mudar sem ninguém dar por isso.
   *
   * ## O que **não** se perde
   *
   * As quotas. `MemberFee` guarda o seu próprio `amountCents` e não aponta para
   * a categoria, por isso o histórico de quem pagou o quê fica intacto. O que
   * se perde é o que a categoria dizia — nome, preço, benefícios — e é
   * exactamente isso que se está a pedir para apagar.
   *
   * ## O que passa a estar parado
   *
   * Um sócio sem categoria **não recebe quota automática** (`emitirAutomaticas`
   * exige categoria com preço). Não é efeito secundário deste método, é como o
   * produto funciona — mas é a consequência que ninguém adivinha, e por isso
   * está no aviso da consola.
   */
  async deleteTier(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const tier = await db.memberTier.findFirst({ where: { id }, select: { id: true } });
      if (!tier) throw new NotFoundException("Categoria não encontrada");

      const { count } = await db.member.updateMany({ where: { tierId: id }, data: { tierId: null } });
      await db.memberTier.delete({ where: { id } });

      return { ok: true, members: count };
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

  /**
   * O próximo número, e a marca de água a subir com ele.
   *
   * ## Um buraco não volta à fila
   *
   * Isto era `MAX(number) + 1` sobre as fichas vivas, e respondia bem a um
   * buraco no meio: apagado o 2 de 1-2-3, o máximo continua 3 e a adesão
   * seguinte é a 4. Enganava-se no topo — apagado o 3, o máximo caía para 2 e a
   * adesão seguinte herdava o número de quem tinha acabado de sair. E é o caso
   * mais fácil de provocar sem dar por isso: uma ficha de teste fica sempre com
   * o número mais alto, e apaga-se.
   *
   * `Academy.lastMemberNumber` é o maior número já dado no clube e **só sobe**.
   * O máximo vivo continua na conta como rede: para números escritos à mão
   * acima da marca, e para o dia em que alguém mexa nisto por SQL.
   *
   * Encher um buraco continua a ser possível — mas só à mão, escrevendo o
   * número na ficha. Quem decide se o 2 pode voltar a ser de outra pessoa é o
   * clube.
   */
  private async reservarNumero(db: ScopedClient, academyId: string): Promise<number> {
    const [academia, ultimo] = await Promise.all([
      db.academy.findFirst({ where: { id: academyId }, select: { lastMemberNumber: true } }),
      db.member.findFirst({
        where: { number: { not: null } },
        orderBy: { number: "desc" },
        select: { number: true },
      }),
    ]);

    const proximo = Math.max(academia?.lastMemberNumber ?? 0, ultimo?.number ?? 0) + 1;
    await db.academy.update({ where: { id: academyId }, data: { lastMemberNumber: proximo } });
    return proximo;
  }

  /**
   * Um número escrito à mão também levanta a marca de água — se for acima dela.
   *
   * Sem isto, um clube que escreve o 500 numa ficha (porque o livro de papel ia
   * nesse) recebia o 4 na adesão seguinte, e a numeração automática caminhava
   * anos até bater no 500 já ocupado. `updateMany` com a guarda no `where` faz a
   * comparação do lado da base: duas inscrições ao mesmo tempo não se atropelam.
   */
  private async marcarNumero(db: ScopedClient, academyId: string, numero: number | null | undefined) {
    if (typeof numero !== "number") return;
    await db.academy.updateMany({
      where: { id: academyId, lastMemberNumber: { lt: numero } },
      data: { lastMemberNumber: numero },
    });
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

/* -------------------------------------------------------------------------- */
/* A importação: reconhecer quem já cá está                                    */
/* -------------------------------------------------------------------------- */

type Existente = {
  id: string;
  name: string;
  number: number | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  annualStartMonth: number | null;
  annualStartDay: number | null;
};

/** Uma linha da folha que corresponde a um sócio do livro. */
type LinhaExistente = {
  line: number;
  /** O nome como vem na folha. */
  name: string;
  /** O nome de quem foi encontrado — é o que deixa ver um engano antes de o aplicar. */
  matchedName: string;
  number: number | null;
  /** Os campos que iam mudar, em português, para a confirmação os poder dizer. */
  changes: string[];
};

/**
 * A resposta vazia, que é a forma de todas as outras.
 *
 * Existe para que cada saída — problemas, categorias por criar, pessoas por
 * confirmar, sucesso — tenha os mesmos campos. Um cliente que leia
 * `res.updated` não tem de saber por que ramo a resposta veio.
 */
const VAZIO = {
  ok: false as boolean,
  created: 0,
  updated: 0,
  duplicates: [] as { line: number; name: string }[],
  problems: [] as { line: number; reason: string }[],
  unknownTiers: [] as string[],
  existing: [] as LinhaExistente[],
  /** Quantos ao todo — `existing` vem cortada nos 200 para a resposta não crescer sem fim. */
  existingTotal: 0,
};

/** Um contacto comparável: email em minúsculas, telefone só com dígitos. */
function contactosDe(m: { email: string | null; phone: string | null }): string[] {
  const out: string[] = [];
  const email = m.email?.trim().toLowerCase();
  if (email) out.push(`e:${email}`);
  const phone = m.phone?.replace(/\D/g, "");
  // Menos de nove dígitos não é um telemóvel português: é um campo mal
  // preenchido, e não pode servir para colar duas fichas uma na outra.
  if (phone && phone.length >= 9) out.push(`t:${phone}`);
  return out;
}

/** O sócio que o contacto desta linha identifica — ou `"ambiguo"`, ou nada. */
function contactoDaLinha(
  row: { email?: string; phone: string },
  indice: Map<string, Existente | "ambiguo">,
): Existente | "ambiguo" | undefined {
  for (const chave of contactosDe({ email: row.email ?? null, phone: row.phone })) {
    const achado = indice.get(chave);
    if (achado) return achado;
  }
  return undefined;
}

/** Como se chamam, para quem lê a confirmação, os campos que a folha traz. */
const ROTULO: Record<string, string> = {
  name: "nome",
  email: "email",
  phone: "telemóvel",
  phoneCountry: "indicativo",
  birthdate: "data de nascimento",
  address: "morada",
  postalCode: "código postal",
  city: "localidade",
  country: "país",
  sex: "sexo",
  documentKind: "tipo de documento",
  documentNumber: "n.º de documento",
  taxId: "NIF",
  status: "estado",
  tierId: "categoria",
  /* Os dois lados da mesma data dizem a mesma coisa — `camposQueMudam`
     desduplica, para a confirmação não a listar duas vezes. */
  annualStartMonth: "ano de quotas",
  annualStartDay: "ano de quotas",
};

/**
 * O dia e o mês em que abre o ano de quotas de um sócio novo, a partir do que
 * o formulário mandou (`MM-DD`).
 *
 * Só serve a criação — numa ficha que já existe, a data muda pela porta dela
 * (`PATCH :id/ano-de-quotas`), porque mudá-la refaz o ano.
 *
 * - **ausente**: a data de hoje no relógio do clube. É o pedido do clube — quem
 *   adere hoje começa o ano hoje, e só daqui a um ano volta a ser cobrado. Pelo
 *   relógio do clube e não em UTC: às 00:30 de Lisboa em Setembro o UTC ainda
 *   está no dia anterior, e a data de adesão de uma ficha não pode ser a de
 *   ontem;
 * - **vazio**: herda a abertura do clube.
 */
function aberturaDoDto(
  valor: string | undefined,
  hoje: Date,
): { annualStartMonth: number | null; annualStartDay: number | null } {
  if (valor === undefined) {
    const { mes, dia } = partesNoFuso(hoje);
    return { annualStartMonth: mes, annualStartDay: dia };
  }
  if (valor === "") return { annualStartMonth: null, annualStartDay: null };
  const [mes, dia] = valor.split("-").map(Number);
  return { annualStartMonth: mes, annualStartDay: dia };
}

/**
 * O que muda nesta ficha se a folha for aplicada.
 *
 * Comparado campo a campo e **em português**, porque isto não é para um log: é
 * a frase que se mostra antes de perguntar "substituir?". Uma linha que não
 * muda nada não aparece na confirmação nem chega a escrever.
 *
 * `tierId` fica de fora da comparação por não vir na leitura do livro — a
 * categoria muda-se na mesma ao substituir, e dizer "categoria" em todas as
 * linhas só faria ruído.
 */
function camposQueMudam(actual: Existente, folha: Record<string, unknown>): string[] {
  const mudam: string[] = [];
  const antes = actual as unknown as Record<string, unknown>;

  for (const [campo, valor] of Object.entries(folha)) {
    if (campo === "tierId" || !(campo in antes)) continue;
    const anterior = antes[campo] ?? null;
    const novo = valor ?? null;
    const rotulo = ROTULO[campo] ?? campo;
    if (String(anterior) !== String(novo) && !mudam.includes(rotulo)) mudam.push(rotulo);
  }
  return mudam;
}
