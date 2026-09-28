import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SubscriptionBillingPeriod } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import { subscriptionOrderEmail } from "../mail/mail.templates";
import { can, type RequestContext } from "../common/permissions";
import { responsavelDoClube } from "./responsavel";
import { renovacaoPorOmissao, semFidelizacao } from "./condicoes";
import { gerarDeclaracaoPdf, nomeDoFicheiro, validarDeclaracao, type DadosDaDeclaracao } from "./declaracao";

/**
 * A ordem sem os dados pessoais de quem assinou.
 *
 * O painel das condições é lido por quem entra nas Definições, e a ordem guarda
 * o NIF e a data de nascimento do representante. Esses ficam na declaração em
 * PDF, que só descarrega quem pode assinar; o painel não precisa deles para
 * dizer o que foi assinado e por quem. O IP e o navegador vão pelo mesmo
 * caminho.
 */
function semDadosPessoais<T extends { signerTaxId?: string | null; signerBirthdate?: Date | null; signerIp?: string | null; signerAgent?: string | null }>(
  ordem: T,
): Omit<T, "signerTaxId" | "signerBirthdate" | "signerIp" | "signerAgent"> {
  const { signerTaxId: _nif, signerBirthdate: _nasc, signerIp: _ip, signerAgent: _ua, ...resto } = ordem;
  return resto;
}

/**
 * O desconto de quem paga o ano à cabeça, em pontos percentuais.
 *
 * **Está escrito em três sítios**, e é preciso saber: aqui, em
 * `apps/site/src/lib/content.ts` (`ANNUAL_DISCOUNT`), que é o que o site
 * anuncia, e em `apps/platform/src/components/AcademyActions.tsx`, que mostra o
 * número antes de emitir. São aplicações separadas e não partilham código de
 * domínio; mudar o desconto obriga a mudar os três, ou o site promete uma coisa,
 * o painel mostra outra e o contrato diz uma terceira.
 *
 * A mensalidade de um contrato anual é sempre o ano a dividir por doze
 * (215,89 € → 17,99 €/mês). É esse o número que o clube lê no contrato, no
 * email e no site.
 */
export const DESCONTO_ANUAL_PCT = 10;

/** O que o clube paga por período, a partir do preço de tabela do plano. */
export function precoDaOrdem(listMonthlyCents: number, periodo: SubscriptionBillingPeriod) {
  if (periodo !== "ANNUAL") {
    return { listMonthlyCents, discountPct: 0, amountCents: listMonthlyCents };
  }
  const ano = listMonthlyCents * 12;
  return {
    listMonthlyCents,
    discountPct: DESCONTO_ANUAL_PCT,
    amountCents: Math.round((ano * (100 - DESCONTO_ANUAL_PCT)) / 100),
  };
}

/**
 * O período mínimo que a periodicidade permite.
 *
 * Regra do produto: **mensal não tem fidelização** — quem paga mês a mês sai
 * quando quiser, e o mínimo é o próprio mês. **Anual conta-se em anos**, e quem
 * emite escolhe quantos. Um pedido com 7 meses num contrato anual é um erro de
 * quem o escreveu, e aqui arredonda-se ao ano em vez de guardar uma condição
 * que ninguém sabe explicar ao clube.
 *
 * Vive aqui, e não na plataforma: o contrato é o mesmo seja quem for a emiti-lo.
 */
export function minimoDaPeriodicidade(periodo: SubscriptionBillingPeriod, pedido: number | undefined): number {
  if (periodo !== "ANNUAL") return 1;
  const anos = Math.max(1, Math.round((pedido ?? 12) / 12));
  return Math.min(anos, 5) * 12;
}

/**
 * O plano, como quem contrata o conhece.
 *
 * Passa-se em vez de se ler: ver a nota em `emitir`. Num reenvio vem do
 * instantâneo da própria ordem, que é o que faz "reenviar" não ser
 * "renegociar" — se o preço de tabela subiu entretanto, o papel repetido é o
 * que estava em cima da mesa, não o de hoje.
 */
export type PlanoContratado = { id: string; name: string; amountCents: number };

type Condicoes = {
  billingPeriod: SubscriptionBillingPeriod;
  startsOn: Date;
  minimumMonths: number;
  renewalNote?: string | null;
  notes?: string | null;
};

/**
 * As ordens de adesão — as condições comerciais de um clube, e quem as assinou.
 *
 * ## O buraco que isto tapa
 *
 * Mudar o plano de um clube era um gesto interno: escolhia-se na plataforma,
 * gravava-se, e do outro lado ninguém sabia de nada. Não faltava um aviso —
 * faltava o contrato: qual o plano, quanto custa, desde quando, por quanto
 * tempo, como renova. E faltava alguém do clube a dizer que sim.
 *
 * ## Quem assina
 *
 * Quem tem `legal:club` — a mesma permissão que já decide quem aceita os Termos
 * de Serviço **em nome do clube**. Não se inventa aqui um "presidente": usa-se a
 * definição que o produto já tem, e por isso não há dois sítios a discordarem
 * sobre quem representa o clube.
 *
 * ## O email não assina
 *
 * Leva as condições e um botão para a consola. Assinar exige sessão — um link
 * que assinasse ao ser aberto punha um contrato à mercê de um reencaminhamento.
 */
@Injectable()
export class SubscriptionOrdersService {
  private readonly log = new Logger(SubscriptionOrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailClient,
    private readonly config: ConfigService,
  ) {}

  /**
   * Emite uma ordem e manda-a a quem representa o clube.
   *
   * A anterior por assinar passa a `SUPERSEDED`: o que esteve em cima da mesa
   * fica na história, mas só há uma ordem viva de cada vez — duas por assinar
   * eram duas versões do mesmo contrato à espera do mesmo clique.
   *
   * Nunca atira por causa do email: a ordem existe na mesma, e a plataforma
   * mostra que ficou por enviar. Um contrato que não se emite porque o Resend
   * está em baixo é pior do que um contrato por enviar.
   */
  async emitir(academyId: string, plan: PlanoContratado, condicoes: Condicoes) {
    /*
     * O plano vem de **quem chama**, e não se lê aqui.
     *
     * `Plan` é uma tabela da plataforma: o papel do clube (`academia_app`) não
     * tem permissão nela, e lê-la dentro de um `runAs` dava "permission denied
     * for table Plan". Não se resolve com um `GRANT` — resolve-se não pedindo a
     * um papel de clube que leia o catálogo comercial. Quem emite já o tem.
     */
    const [academy, termos] = await this.prisma.runAs(academyId, (db) => Promise.all([
      db.academy.findFirst({
        where: { id: academyId },
        select: { id: true, slug: true, name: true, shortName: true, signalColor: true, logoUrl: true },
      }),
      db.legalDocument.findFirst({
        where: { type: "TERMS_OF_SERVICE", status: "PUBLISHED", effectiveAt: { lte: new Date() } },
        orderBy: [{ effectiveAt: "desc" }, { publishedAt: "desc" }],
        select: { id: true, version: true },
      }),
    ]));
    if (!academy) throw new BadRequestException("Academia não encontrada");

    const preco = precoDaOrdem(plan.amountCents, condicoes.billingPeriod);
    const minimumMonths = minimoDaPeriodicidade(condicoes.billingPeriod, condicoes.minimumMonths);
    const renewalNote =
      condicoes.renewalNote?.trim() || renovacaoPorOmissao(condicoes.billingPeriod, minimumMonths);

    const [responsavel, anteriores] = await this.prisma.runAs(academyId, async (db) => [
      await responsavelDoClube(db, academyId),
      await db.subscriptionOrder.count({ where: { academyId } }),
    ] as const);

    const ordem = await this.prisma.runAs(academyId, async (db) => {
      await db.subscriptionOrder.updateMany({
        where: { academyId, status: "PENDING" },
        data: { status: "SUPERSEDED" },
      });

      return db.subscriptionOrder.create({
        data: {
          academyId,
          planId: plan.id,
          planName: plan.name,
          billingPeriod: condicoes.billingPeriod,
          listMonthlyCents: preco.listMonthlyCents,
          discountPct: preco.discountPct,
          amountCents: preco.amountCents,
          startsOn: condicoes.startsOn,
          minimumMonths,
          renewalNote,
          notes: condicoes.notes?.trim() || null,
          termsDocumentId: termos?.id ?? null,
          termsVersion: termos?.version ?? null,
          sentToEmail: responsavel?.email ?? null,
          sentToName: responsavel?.name ?? null,
          updatedAt: new Date(),
        },
      });
    });

    /*
     * O email vai **fora** da transacção — a regra da casa. Uma chamada de rede
     * lá dentro segura uma ligação do pool enquanto o serviço de email responde,
     * e com `connection_limit=5` bastam cinco para travar o servidor.
     */
    if (!responsavel) {
      this.log.warn(`Ordem ${ordem.id}: ${academy.slug} não tem ninguém com legal:club — ficou por enviar.`);
      return { ordem, enviado: false, motivo: "O clube não tem ninguém com poderes para o representar." };
    }

    const enviado = await this.mail.send({
      to: responsavel.email,
      ...subscriptionOrderEmail({
        brand: {
          shortName: academy.shortName,
          name: academy.name,
          signalColor: academy.signalColor,
          logoUrl: academy.logoUrl,
        },
        name: responsavel.name,
        title: responsavel.title,
        clientName: academy.name,
        planName: plan.name,
        annual: condicoes.billingPeriod === "ANNUAL",
        amountCents: preco.amountCents,
        listMonthlyCents: preco.listMonthlyCents,
        discountPct: preco.discountPct,
        startsOn: condicoes.startsOn,
        minimumMonths,
        renewalNote,
        notes: condicoes.notes ?? null,
        termsVersion: termos?.version ?? null,
        link: this.linkDaConsola(academy.slug),
        isUpdate: anteriores > 0,
      }),
    });

    if (enviado.sent) {
      await this.prisma.runAs(academyId, (db) =>
        db.subscriptionOrder.update({ where: { id: ordem.id }, data: { sentAt: new Date() } }),
      );
    }

    return { ordem, enviado: enviado.sent, motivo: enviado.sent ? null : enviado.reason };
  }

  /**
   * O que a consola mostra: as condições, e se **esta** pessoa as pode assinar.
   *
   * `podeAssinar` vem do servidor e não se calcula no cliente. A regra é uma só
   * (`legal:club`), e uma cópia dela na consola seria uma segunda verdade — a
   * que decide o que se vê, ao lado da que decide o que se aceita.
   */
  async paraAConsola(ctx: RequestContext) {
    const clube = await this.doClube(ctx.academyId);
    const pendente = clube.pendente ? semDadosPessoais(clube.pendente) : null;
    const assinada = clube.assinada ? semDadosPessoais(clube.assinada) : null;
    /*
     * Os avisos de pagamento vêm com as condições, e não num segundo pedido: são
     * a mesma pergunta ("o que é que eu tenho com a Academias?") e o painel é um
     * só. Os doze mais recentes chegam para um ano de mensalidades.
     */
    const avisos = await this.prisma.runAs(ctx.academyId, (db) =>
      db.subscriptionNotice.findMany({
        where: { academyId: ctx.academyId },
        orderBy: { issuedOn: "desc" },
        take: 12,
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          issuedOn: true,
          dueOn: true,
          amountCents: true,
          planName: true,
          billingPeriod: true,
          toEmail: true,
          sentAt: true,
        },
      }),
    );
    const podeAssinar = can(ctx, "legal:club");
    return {
      pendente,
      assinada,
      avisos,
      podeAssinar,
      // O que o formulário da assinatura traz já escrito — só a quem o vai abrir.
      sugestao: podeAssinar && pendente ? await this.sugestaoParaAssinar(ctx) : null,
    };
  }

  /**
   * A ordem viva do clube, e a última assinada. É o que os dois ecrãs mostram.
   *
   * `temDeclaracao` diz se a assinada tem o PDF — as assinadas antes da
   * declaração existir não têm, e o botão de descarregar não pode prometer um
   * ficheiro que não há.
   */
  async doClube(academyId: string) {
    return this.prisma.runAs(academyId, async (db) => {
      const [pendente, assinada] = await Promise.all([
        db.subscriptionOrder.findFirst({
          where: { academyId, status: "PENDING" },
          orderBy: { createdAt: "desc" },
        }),
        db.subscriptionOrder.findFirst({
          where: { academyId, status: "SIGNED" },
          orderBy: { signedAt: "desc" },
          include: { declaration: { select: { sha256: true, createdAt: true } } },
        }),
      ]);
      return {
        pendente: pendente ? { ...pendente, temDeclaracao: false } : null,
        assinada: assinada
          ? (({ declaration, ...resto }) => ({
              ...resto,
              temDeclaracao: Boolean(declaration),
              declaracaoSha256: declaration?.sha256 ?? null,
            }))(assinada)
          : null,
      };
    });
  }

  /**
   * Assinar — só quem representa o clube.
   *
   * Guarda quem, quando, de onde e com que cargo. O cargo fica **copiado**:
   * quem assina hoje pode já não estar no clube quando alguém for ler isto, e um
   * contrato que vai buscar o cargo à ficha actual muda de assinatura sozinho.
   */
  async assinar(ctx: RequestContext, pedido: DadosDaDeclaracao, meta: { ip?: string; userAgent?: string }) {
    if (!can(ctx, "legal:club")) {
      throw new ForbiddenException("Só quem representa o clube pode assinar as condições.");
    }

    const agora = new Date();
    const validado = validarDeclaracao(pedido, agora);
    if (!validado.ok) throw new BadRequestException(validado.erro);
    const d = validado.dados;

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const ordem = await db.subscriptionOrder.findFirst({
        where: { academyId: ctx.academyId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (!ordem) throw new NotFoundException("Não há condições por assinar.");

      const [quem, termos] = await Promise.all([
        db.membership.findFirst({
          where: { id: ctx.membershipId },
          select: {
            title: true,
            customRole: { select: { name: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        }),
        ordem.termsDocumentId
          ? db.legalDocument.findFirst({ where: { id: ordem.termsDocumentId }, select: { contentHash: true } })
          : null,
      ]);

      const signerTitle = quem?.customRole?.name ?? quem?.title ?? null;

      /*
       * O PDF nasce aqui, com a assinatura, e fica guardado tal como saiu.
       *
       * Gerá-lo a cada download era ter uma declaração que podia mudar de texto
       * com o código — e uma declaração assinada não muda. Vai na mesma
       * transacção da assinatura: não há ordem assinada sem declaração, nem
       * declaração sem ordem assinada.
       */
      const { pdf, sha256 } = gerarDeclaracaoPdf({
        institutionName: d.institutionName,
        institutionTaxId: d.institutionTaxId,
        signerName: d.signerName,
        signerTaxId: d.signerTaxId,
        signerBirthdate: d.nascimento,
        signerEmail: quem?.user.email ?? null,
        signerTitle,
        signedAt: agora,
        signerIp: meta.ip ?? null,
        orderId: ordem.id,
        planName: ordem.planName,
        annual: ordem.billingPeriod === "ANNUAL",
        amountCents: ordem.amountCents,
        listMonthlyCents: ordem.listMonthlyCents,
        discountPct: ordem.discountPct,
        startsOn: ordem.startsOn,
        minimumMonths: ordem.minimumMonths,
        renewalNote: ordem.renewalNote,
        notes: ordem.notes,
        termsVersion: ordem.termsVersion,
        termsHash: termos?.contentHash ?? null,
      });

      const assinada = await db.subscriptionOrder.update({
        where: { id: ordem.id },
        data: {
          status: "SIGNED",
          signedAt: agora,
          signedByUserId: quem?.user.id ?? null,
          // O nome escrito pelo representante, e não o da conta: é o que consta
          // da declaração, e quem assina pode usar a conta com um nome curto.
          signerName: d.signerName,
          signerEmail: quem?.user.email ?? null,
          signerTitle,
          signerIp: meta.ip ?? null,
          signerAgent: meta.userAgent?.slice(0, 300) ?? null,
          institutionName: d.institutionName,
          institutionTaxId: d.institutionTaxId,
          signerTaxId: d.signerTaxId,
          signerBirthdate: d.nascimento,
        },
      });

      await db.subscriptionDeclaration.create({
        data: { academyId: ctx.academyId, orderId: ordem.id, pdf, sha256 },
      });

      return semDadosPessoais({ ...assinada, temDeclaracao: true });
    });
  }

  /**
   * A declaração em PDF, para descarregar na consola.
   *
   * Só a quem pode assinar (`legal:club`): leva o NIF e a data de nascimento de
   * quem assinou, e isso não é para toda a gente que entra nas Definições.
   *
   * Vai em base64 dentro de JSON, e não como ficheiro, para passar pelo mesmo
   * cliente HTTP autenticado da consola — um `<a href>` não leva o token.
   */
  async declaracaoParaAConsola(ctx: RequestContext, orderId: string) {
    if (!can(ctx, "legal:club")) {
      throw new ForbiddenException("Só quem representa o clube pode descarregar a declaração.");
    }
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const dec = await db.subscriptionDeclaration.findFirst({
        where: { orderId, academyId: ctx.academyId },
        select: { pdf: true, sha256: true, order: { select: { signedAt: true } }, academy: { select: { slug: true } } },
      });
      if (!dec) throw new NotFoundException("Esta ordem não tem declaração.");
      return {
        ficheiro: nomeDoFicheiro(dec.academy.slug, dec.order.signedAt ?? new Date()),
        sha256: dec.sha256,
        base64: Buffer.from(dec.pdf).toString("base64"),
      };
    });
  }

  /**
   * O que se sugere no formulário da assinatura.
   *
   * A instituição da última assinatura com declaração, se houver — um clube não
   * muda de NIF de um ano para o outro, e reescrevê-lo a cada renovação é onde
   * nascem os enganos. Sem isso, o nome do clube tal como está na plataforma. Os
   * dados pessoais do representante **não** se sugerem: quem assina pode ser
   * outra pessoa, e ver o NIF de outro pré-preenchido era mostrar-lho.
   */
  private async sugestaoParaAssinar(ctx: RequestContext) {
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [ultima, academy, eu] = await Promise.all([
        db.subscriptionOrder.findFirst({
          where: { academyId: ctx.academyId, status: "SIGNED", NOT: { institutionTaxId: null } },
          orderBy: { signedAt: "desc" },
          select: { institutionName: true, institutionTaxId: true },
        }),
        db.academy.findFirst({ where: { id: ctx.academyId }, select: { name: true } }),
        db.membership.findFirst({ where: { id: ctx.membershipId }, select: { user: { select: { name: true } } } }),
      ]);
      return {
        institutionName: ultima?.institutionName ?? academy?.name ?? "",
        institutionTaxId: ultima?.institutionTaxId ?? "",
        signerName: eu?.user.name ?? "",
      };
    });
  }

  /**
   * Onde o clube vai assinar.
   *
   * O mesmo padrão dos convites (`PUBLIC_BASE_URL` com `{slug}`): em produção
   * cada clube tem o seu subdomínio, e em desenvolvimento cai no servidor local.
   */
  private linkDaConsola(slug: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    if (base) return `${base.replace(/\/$/, "").replace("{slug}", slug)}/consola/definicoes`;
    return "http://localhost:5173/definicoes";
  }
}
