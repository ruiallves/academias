import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { SubscriptionBillingPeriod } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import { subscriptionOrderEmail } from "../mail/mail.templates";
import { ROLE_PERMISSIONS, can, type RequestContext } from "../common/permissions";
import { renovacaoPorOmissao, semFidelizacao } from "./condicoes";

/**
 * O desconto de quem paga o ano à cabeça, em pontos percentuais.
 *
 * **Está escrito em dois sítios**, e é preciso saber: aqui, e em
 * `apps/site/src/lib/content.ts` (`ANNUAL_DISCOUNT`), que é o que o site
 * anuncia. São aplicações separadas e não partilham código de domínio; mudar o
 * desconto obriga a mudar os dois, ou o site promete uma coisa e o contrato diz
 * outra.
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
      await this.responsavelDoClube(db, academyId),
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
    const { pendente, assinada } = await this.doClube(ctx.academyId);
    return { pendente, assinada, podeAssinar: can(ctx, "legal:club") };
  }

  /** A ordem viva do clube, e a última assinada. É o que os dois ecrãs mostram. */
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
        }),
      ]);
      return { pendente, assinada };
    });
  }

  /**
   * Assinar — só quem representa o clube.
   *
   * Guarda quem, quando, de onde e com que cargo. O cargo fica **copiado**:
   * quem assina hoje pode já não estar no clube quando alguém for ler isto, e um
   * contrato que vai buscar o cargo à ficha actual muda de assinatura sozinho.
   */
  async assinar(ctx: RequestContext, meta: { ip?: string; userAgent?: string }) {
    if (!can(ctx, "legal:club")) {
      throw new ForbiddenException("Só quem representa o clube pode assinar as condições.");
    }

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const ordem = await db.subscriptionOrder.findFirst({
        where: { academyId: ctx.academyId, status: "PENDING" },
        orderBy: { createdAt: "desc" },
      });
      if (!ordem) throw new NotFoundException("Não há condições por assinar.");

      const quem = await db.membership.findFirst({
        where: { id: ctx.membershipId },
        select: {
          title: true,
          customRole: { select: { name: true } },
          user: { select: { id: true, name: true, email: true } },
        },
      });

      return db.subscriptionOrder.update({
        where: { id: ordem.id },
        data: {
          status: "SIGNED",
          signedAt: new Date(),
          signedByUserId: quem?.user.id ?? null,
          signerName: quem?.user.name ?? null,
          signerEmail: quem?.user.email ?? null,
          signerTitle: quem?.customRole?.name ?? quem?.title ?? null,
          signerIp: meta.ip ?? null,
          signerAgent: meta.userAgent?.slice(0, 300) ?? null,
        },
      });
    });
  }

  /**
   * Quem representa o clube — o primeiro responsável.
   *
   * A regra é a do sistema legal: tem `legal:club` quem o cargo lhe der, ou, sem
   * cargo à medida, o papel-base. Entre vários, o mais antigo: é quem inaugurou
   * o clube, e é a pessoa que a plataforma conhece como o presidente.
   */
  private async responsavelDoClube(db: ScopedClient, academyId: string) {
    const vinculos = await db.membership.findMany({
      where: { academyId, isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
      orderBy: { createdAt: "asc" },
      select: {
        title: true,
        role: true,
        customRole: { select: { name: true, permissions: true } },
        user: { select: { name: true, email: true } },
      },
    });

    for (const v of vinculos) {
      const perms: string[] = v.customRole?.permissions ?? ROLE_PERMISSIONS[v.role];
      if (!perms.includes("legal:club")) continue;
      if (!v.user.email) continue;
      return {
        name: v.user.name,
        email: v.user.email,
        title: v.customRole?.name ?? v.title ?? "Presidente",
      };
    }
    return null;
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
