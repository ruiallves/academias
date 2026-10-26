/**
 * A faturação automática: de um pagamento pago a uma fatura no programa do
 * clube e a um email com o PDF a quem pagou.
 *
 * ## O caminho de um pagamento
 *
 * 1. O webhook dá o pagamento por pago (`BillingService.confirmPayment`). Na
 *    **mesma transação**, `registar` lê o que ele liquida, monta o documento
 *    (`documento.ts`) e grava uma `Invoice` em `PENDING`. Se a transação se
 *    desfizer, a fatura desfaz-se com ela: nunca há uma fatura de um
 *    pagamento que não ficou pago.
 * 2. Depois do commit, `processar` emite-a no programa, vai buscar o PDF e
 *    manda o email. Nada disto corre dentro de uma transação: é HTTP, e a
 *    regra da casa é que HTTP nunca entra num `runAs`.
 * 3. O que falhar fica para a volta seguinte da fila (`varrer`, de cinco em
 *    cinco minutos), com o intervalo a crescer; o que falhar por uma razão
 *    que repetir não cura fica `FAILED` para alguém ver na consola.
 *
 * ## Uma fatura por pagamento, mesmo com duas voltas ao mesmo tempo
 *
 * A fila e o "emitir já" podem apanhar a mesma fatura. Quem a quer tratar
 * **reclama-a** primeiro, numa transação curta que só avança se ela ainda
 * estiver por tratar e sem ninguém em cima (`nextAttemptAt` no futuro); a
 * outra volta vê-a reclamada e passa à frente. E antes de criar no programa,
 * pergunta-se-lhe se já lá está um documento com a nossa referência: um
 * servidor que morra entre o "criar" e o "gravar o id" não emite duas vezes.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit, BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InvoiceStatus, InvoicingProvider, PaymentStatus, Prisma } from "@prisma/client";
import { PrismaService, type ScopedClient } from "../prisma/prisma.service";
import { MailClient } from "../mail/mail.client";
import { faturaEmail, type MailBrand } from "../mail/mail.templates";
import { identidadeValida } from "../site/site.tipos";
import { matchTitle } from "../common/match-title";
import { can, type RequestContext } from "../common/permissions";
import { Cofre } from "./cofre";
import { InvoiceXpress } from "./invoicexpress";
import { Moloni } from "./moloni";
import { SageOne } from "./sage-one";
import { PhcGo } from "./phc-go";
import { Vendus } from "./vendus";
import {
  clienteDe,
  dadosDeFaturacao,
  montarDocumento,
  nifOuNada,
  nomeDoMetodo,
  nomeDoPeriodo,
  regraDe,
  regrasCompletas,
  regrasFiscais,
  type ItemPago,
} from "./documento";
import {
  ErroDeFaturacao,
  NOME_DO_PROGRAMA,
  REGRAS_SUGERIDAS,
  TIPOS_DE_VENDA,
  euros,
  type ClienteAFaturar,
  type Conector,
  type Credenciais,
  type DefinicoesDaConta,
  type DocumentoAFaturar,
  type Emitido,
  type Opcoes,
  type RegrasFiscais,
  type TipoDeVenda,
} from "./tipos";

/** Quanto se espera depois de cada falha de passagem: 1 min, 5, 15, 1 h, 4 h, 12 h, e depois um dia. */
const ESPERAS_MIN = [1, 5, 15, 60, 240, 720];
const TENTATIVAS_MAXIMAS = 10;
/** Quem reclama uma fatura tem este tempo para a tratar antes de outra volta a poder apanhar. */
const RECLAMADA_MIN = 10;

const ESTADO_PAGO_DA_ENCOMENDA = ["PAID", "READY", "SHIPPED", "DELIVERED"];

export type EstadoDaFaturacao = {
  /** Que programas este servidor sabe ligar (os OAuth precisam das chaves da nossa aplicação no ambiente). */
  programas: { provider: InvoicingProvider; nome: string; disponivel: boolean; comoLiga: "chave" | "oauth" }[];
  ligacao: null | {
    provider: InvoicingProvider;
    nome: string;
    pronta: boolean;
    desde: Date | null;
    porDefinir: string[];
    definicoes: Omit<DefinicoesDaConta, "interno">;
    regras: RegrasFiscais;
    sugeridas: typeof REGRAS_SUGERIDAS;
    tipos: typeof TIPOS_DE_VENDA;
    erro: { mensagem: string; quando: Date } | null;
  };
  resumo: { porEmitir: number; falhadas: number; emitidasEsteMes: number };
};

@Injectable()
export class FaturacaoService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(FaturacaoService.name);
  private readonly cofre: Cofre;
  private readonly conectores: Record<InvoicingProvider, Conector>;
  /** Uma coisa de cada vez por clube: duas emissões ao mesmo tempo renovavam o mesmo token e uma perdia. */
  private readonly filaPorClube = new Map<string, Promise<unknown>>();
  private varredura: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailClient,
  ) {
    this.cofre = new Cofre(config.get<string>("INVOICING_SECRET"));
    const env = (k: string) => config.get<string>(k)?.trim() ?? "";
    this.conectores = {
      INVOICEXPRESS: new InvoiceXpress(),
      MOLONI: new Moloni({ clientId: env("MOLONI_CLIENT_ID"), clientSecret: env("MOLONI_CLIENT_SECRET") }),
      SAGE_ONE: new SageOne({ clientId: env("SAGE_CLIENT_ID"), clientSecret: env("SAGE_CLIENT_SECRET"), signingSecret: env("SAGE_SIGNING_SECRET") }),
      PHC_GO: new PhcGo({ appId: env("PHC_GO_APP_ID") }),
      VENDUS: new Vendus(),
    };
  }

  onModuleInit() {
    if (!this.cofre.pronto) this.log.warn("INVOICING_SECRET por configurar: a faturação por API fica desligada.");
    const minutos = Number(this.config.get<string>("INVOICING_SWEEP_INTERVAL_MIN") ?? "5");
    if (!Number.isFinite(minutos) || minutos <= 0 || !this.cofre.pronto) return;
    const passe = () => this.varrer().catch((e) => this.log.error(`A fila da faturação falhou: ${e instanceof Error ? e.message : e}`));
    setTimeout(passe, 45_000).unref();
    this.varredura = setInterval(passe, minutos * 60_000);
    this.varredura.unref();
  }

  onModuleDestroy() {
    if (this.varredura) clearInterval(this.varredura);
  }

  /* ------------------------------------------------------------------------ */
  /* A ligação do clube (Definições › Faturação)                               */
  /* ------------------------------------------------------------------------ */

  private conector(provider: InvoicingProvider): Conector {
    const c = this.conectores[provider];
    if (!c.disponivel) throw new BadRequestException(`${NOME_DO_PROGRAMA[provider]} ainda não está disponível neste servidor.`);
    return c;
  }

  private exigirConfiguracao(ctx: RequestContext) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");
    if (!this.cofre.pronto) throw new BadRequestException("A faturação por API não está configurada neste servidor.");
  }

  async estado(ctx: RequestContext): Promise<EstadoDaFaturacao> {
    if (!can(ctx, "billing:read") && !can(ctx, "settings:write")) throw new ForbiddenException();
    return this.prisma.runAs(ctx.academyId, async (db) => this.estadoEm(db, ctx.academyId));
  }

  private async estadoEm(db: ScopedClient, academyId: string): Promise<EstadoDaFaturacao> {
    const conta = await db.invoicingAccount.findUnique({ where: { academyId } });
    const inicioDoMes = new Date();
    inicioDoMes.setUTCDate(1);
    inicioDoMes.setUTCHours(0, 0, 0, 0);
    const [porEmitir, falhadas, emitidasEsteMes] = await Promise.all([
      db.invoice.count({ where: { academyId, status: { in: [InvoiceStatus.PENDING, InvoiceStatus.ISSUED] } } }),
      db.invoice.count({ where: { academyId, status: InvoiceStatus.FAILED } }),
      db.invoice.count({ where: { academyId, status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.SENT] }, createdAt: { gte: inicioDoMes } } }),
    ]);

    const programas = (Object.keys(this.conectores) as InvoicingProvider[]).map((p) => ({
      provider: p,
      nome: NOME_DO_PROGRAMA[p],
      disponivel: this.cofre.pronto && this.conectores[p].disponivel,
      comoLiga: (this.conectores[p].urlDeAutorizacao ? "oauth" : "chave") as "chave" | "oauth",
    }));

    if (!conta) return { programas, ligacao: null, resumo: { porEmitir, falhadas, emitidasEsteMes } };

    const def = this.definicoes(conta.settings);
    const regras = regrasFiscais(conta.taxRules);
    const { interno: _interno, ...semInterno } = def;
    return {
      programas,
      ligacao: {
        provider: conta.provider,
        nome: NOME_DO_PROGRAMA[conta.provider],
        pronta: conta.readyAt !== null,
        desde: conta.readyAt,
        porDefinir: this.oQueFalta(conta.provider, def, regras),
        definicoes: semInterno,
        regras,
        sugeridas: REGRAS_SUGERIDAS,
        tipos: TIPOS_DE_VENDA,
        erro: conta.lastError && conta.lastErrorAt ? { mensagem: conta.lastError, quando: conta.lastErrorAt } : null,
      },
      resumo: { porEmitir, falhadas, emitidasEsteMes },
    };
  }

  private oQueFalta(provider: InvoicingProvider, def: DefinicoesDaConta, regras: RegrasFiscais): string[] {
    const falta = [...this.conectores[provider].porDefinir(def)];
    if (!regras.confirmadas) falta.push("confirmar as regras de IVA");
    else if (!regrasCompletas(regras)) falta.push("um motivo de isenção em cada tipo a 0 %");
    return falta;
  }

  /** Ligar por chave: a InvoiceXpress. Verifica antes de guardar; guardar cifrado. */
  async ligarInvoiceXpress(ctx: RequestContext, dto: { accountName: string; apiKey: string }) {
    this.exigirConfiguracao(ctx);
    const cred: Credenciais = { provider: "INVOICEXPRESS", accountName: dto.accountName.trim().toLowerCase(), apiKey: dto.apiKey.trim() };
    if (!cred.accountName || !cred.apiKey) throw new BadRequestException("Faltam o nome da conta e a chave da API.");
    await this.guardarLigacao(ctx.academyId, cred);
    return this.estado(ctx);
  }

  /** Ligar a Vendus: a chave da API de um utilizador do clube. */
  async ligarVendus(ctx: RequestContext, dto: { apiKey: string }) {
    this.exigirConfiguracao(ctx);
    const cred: Credenciais = { provider: "VENDUS", apiKey: dto.apiKey.trim() };
    if (!cred.apiKey) throw new BadRequestException("Falta a chave da API.");
    await this.guardarLigacao(ctx.academyId, cred);
    return this.estado(ctx);
  }

  /** Ligar o PHC GO: a instalação do clube e um utilizador dela. O token pede-se na verificação e fica guardado. */
  async ligarPhcGo(ctx: RequestContext, dto: { backendUrl: string; userCode: string; password: string; company?: string }) {
    this.exigirConfiguracao(ctx);
    const cred: Credenciais = { provider: "PHC_GO", backendUrl: dto.backendUrl.trim(), userCode: dto.userCode.trim(), password: dto.password, company: dto.company?.trim() ?? "" };
    if (!cred.backendUrl || !cred.userCode || !cred.password) throw new BadRequestException("Faltam o endereço da instalação, o utilizador e a palavra-passe.");
    await this.guardarLigacao(ctx.academyId, cred);
    return this.estado(ctx);
  }

  /** OAuth, passo 1: para onde mandar o clube. O `state` leva o clube e quem pediu, assinado, por 15 minutos. */
  urlDeAutorizacao(ctx: RequestContext, provider: InvoicingProvider): { url: string } {
    this.exigirConfiguracao(ctx);
    const c = this.conector(provider);
    if (!c.urlDeAutorizacao) throw new BadRequestException(`${NOME_DO_PROGRAMA[provider]} liga-se com uma chave, não por autorização.`);
    const state = this.cofre.assinar({ a: ctx.academyId, u: ctx.userId, p: provider }, 15 * 60_000);
    return { url: c.urlDeAutorizacao(this.redirectUri(provider), state) };
  }

  /**
   * OAuth, passo 2: o programa devolveu o clube ao nosso callback com um
   * código. Troca-se por credenciais e guarda-se; o clube volta às Definições
   * com o resultado na barra de endereço. Nunca se mostra o erro do programa
   * aqui: a rota é pública.
   */
  async callbackOAuth(provider: InvoicingProvider, query: { code?: string; state?: string; error?: string }): Promise<string> {
    const dados = query.state ? this.cofre.verificar(query.state) : null;
    const academyId = typeof dados?.a === "string" ? dados.a : null;
    if (!academyId || dados?.p !== provider) {
      this.log.warn(`Callback OAuth de ${provider} com state inválido`);
      return this.enderecoDaConsola(null, "erro");
    }
    const slug = await this.prisma.runAs(academyId, async (db) => (await db.academy.findFirst({ where: { id: academyId }, select: { slug: true } }))?.slug ?? null);
    if (query.error || !query.code) return this.enderecoDaConsola(slug, "recusado");
    try {
      const c = this.conector(provider);
      if (!c.trocarCodigo) return this.enderecoDaConsola(slug, "erro");
      const cred = await c.trocarCodigo(query.code, this.redirectUri(provider));
      await this.guardarLigacao(academyId, cred);
      return this.enderecoDaConsola(slug, "ligado");
    } catch (e) {
      this.log.error(`Callback OAuth de ${provider} falhou no clube ${academyId}: ${e instanceof Error ? e.message : e}`);
      return this.enderecoDaConsola(slug, "erro");
    }
  }

  private redirectUri(provider: InvoicingProvider): string {
    const base = (this.config.get<string>("PUBLIC_API_URL") ?? "http://localhost:3000").replace(/\/$/, "");
    return `${base}/api/faturacao/callback/${provider.toLowerCase()}`;
  }

  private enderecoDaConsola(slug: string | null, resultado: string): string {
    const base = this.config.get<string>("PUBLIC_BASE_URL");
    const raiz = base && slug ? base.replace(/\/$/, "").replace("{slug}", slug) : slug ? `https://${slug}.academias.pt` : (this.config.get<string>("CONSOLE_ORIGIN") ?? "http://localhost:5173");
    return `${raiz}/consola/definicoes?secao=faturacao&oauth=${resultado}`;
  }

  /**
   * Guarda a ligação, verificada. Trocar de programa apaga as definições
   * do anterior (não se aplicam); ligar o mesmo outra vez mantém-nas (é o
   * caso de voltar a autorizar quando os tokens caducam).
   */
  private async guardarLigacao(academyId: string, pedidas: Credenciais) {
    const conector = this.conector(pedidas.provider);
    let nome: string;
    let cred = pedidas;
    try {
      const v = await conector.verificar(pedidas);
      nome = v.nome;
      if (v.cred) cred = v.cred;
    } catch (e) {
      throw new BadRequestException(e instanceof ErroDeFaturacao ? e.message : "Não foi possível verificar a ligação.");
    }

    const credentials = this.cofre.cifrar(JSON.stringify(cred));
    await this.prisma.runAs(academyId, async (db) => {
      const anterior = await db.invoicingAccount.findUnique({ where: { academyId } });
      const mesmo = anterior?.provider === cred.provider;
      const settings: DefinicoesDaConta = mesmo ? this.definicoes(anterior!.settings) : {};
      const taxRules = mesmo ? anterior!.taxRules : {};
      await db.invoicingAccount.upsert({
        where: { academyId },
        create: { academyId, provider: cred.provider, credentials, settings: settings as Prisma.InputJsonValue, taxRules: taxRules as Prisma.InputJsonValue },
        update: { provider: cred.provider, credentials, settings: settings as Prisma.InputJsonValue, taxRules: taxRules as Prisma.InputJsonValue, lastError: null, lastErrorAt: null, readyAt: null },
      });
    });
    this.log.log(`Faturação ligada a ${NOME_DO_PROGRAMA[cred.provider]} (${nome}) no clube ${academyId}`);
    await this.tentarFicarPronta(academyId);
  }

  async opcoes(ctx: RequestContext): Promise<Opcoes> {
    this.exigirConfiguracao(ctx);
    const conta = await this.lerConta(ctx.academyId);
    if (!conta) throw new NotFoundException("O clube não tem faturação ligada");
    return this.comConta(ctx.academyId, async () => {
      try {
        return await this.conectores[conta.provider].opcoes(conta.cred, conta.def);
      } catch (e) {
        await this.registarErro(ctx.academyId, e);
        throw new BadRequestException(e instanceof ErroDeFaturacao ? e.message : "Não foi possível ler as opções do programa.");
      }
    });
  }

  /** As escolhas do clube: a série, a empresa, o método, as regras de IVA. Guarda e tenta deixar a ligação pronta. */
  async definir(ctx: RequestContext, dto: Partial<Omit<DefinicoesDaConta, "interno">> & { regras?: RegrasFiscais }) {
    this.exigirConfiguracao(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      const conta = await db.invoicingAccount.findUnique({ where: { academyId: ctx.academyId } });
      if (!conta) throw new NotFoundException("O clube não tem faturação ligada");
      const atual = this.definicoes(conta.settings);
      const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : undefined);
      const novas: DefinicoesDaConta = {
        ...atual,
        ...("serieId" in dto ? { serieId: texto(dto.serieId), serieNome: texto(dto.serieNome) } : {}),
        ...("companyId" in dto ? { companyId: texto(dto.companyId), companyNome: texto(dto.companyNome) } : {}),
        ...("paymentMethodId" in dto ? { paymentMethodId: texto(dto.paymentMethodId) } : {}),
        ...("bankAccountId" in dto ? { bankAccountId: texto(dto.bankAccountId) } : {}),
        ...("paymentTypeId" in dto ? { paymentTypeId: texto(dto.paymentTypeId) } : {}),
      };
      // Mudar de empresa na Moloni muda os produtos e as taxas: o que estava preparado deixa de valer.
      if (dto.companyId !== undefined && dto.companyId !== atual.companyId) novas.interno = {};
      const regras = dto.regras ? regrasFiscais(dto.regras) : regrasFiscais(conta.taxRules);
      await db.invoicingAccount.update({
        where: { academyId: ctx.academyId },
        data: { settings: novas as Prisma.InputJsonValue, taxRules: regras as unknown as Prisma.InputJsonValue },
      });
    });
    await this.tentarFicarPronta(ctx.academyId);
    return this.estado(ctx);
  }

  /**
   * Fica pronta quando não falta nada e o programa aceita o que o clube
   * escolheu. É aqui que se corre `preparar` (taxas, produtos genéricos) e se
   * marca o clube como "fatura": `Academy.invoicingSystem/ConfirmedAt`, que é
   * o que a bilheteira e a loja leem para vender.
   */
  private async tentarFicarPronta(academyId: string): Promise<void> {
    const conta = await this.lerConta(academyId);
    if (!conta) return;
    const regras = regrasFiscais(conta.taxRules);
    const falta = this.oQueFalta(conta.provider, conta.def, regras);
    if (falta.length > 0) {
      await this.prisma.runAs(academyId, (db) => db.invoicingAccount.update({ where: { academyId }, data: { readyAt: null } }));
      return;
    }
    await this.comConta(academyId, async () => {
      try {
        const conector = this.conectores[conta.provider];
        const def = conector.preparar ? await conector.preparar(conta.cred, conta.def) : conta.def;
        await this.prisma.runAs(academyId, async (db) => {
          const agora = new Date();
          await db.invoicingAccount.update({
            where: { academyId },
            data: { settings: def as Prisma.InputJsonValue, readyAt: conta.readyAt ?? agora, lastError: null, lastErrorAt: null },
          });
          await db.academy.update({ where: { id: academyId }, data: { invoicingSystem: NOME_DO_PROGRAMA[conta.provider], invoicingConfirmedAt: conta.readyAt ?? agora } });
        });
      } catch (e) {
        await this.registarErro(academyId, e);
      }
    });
  }

  /** Desligar: apaga a ligação (e as credenciais com ela). As faturas já emitidas ficam. O clube deixa de vender no site. */
  async desligar(ctx: RequestContext) {
    this.exigirConfiguracao(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      await db.invoicingAccount.deleteMany({ where: { academyId: ctx.academyId } });
      await db.academy.update({ where: { id: ctx.academyId }, data: { invoicingSystem: null, invoicingConfirmedAt: null } });
      // O que estava por emitir não vai sair: fica dito, em vez de ficar para sempre "por emitir".
      await db.invoice.updateMany({
        where: { academyId: ctx.academyId, status: { in: [InvoiceStatus.PENDING, InvoiceStatus.ISSUED] } },
        data: { status: InvoiceStatus.FAILED, lastError: "A faturação foi desligada antes de esta fatura sair." },
      });
    });
    return this.estado(ctx);
  }

  /* ------------------------------------------------------------------------ */
  /* Os dados de faturação de quem paga na app                                 */
  /* ------------------------------------------------------------------------ */

  async meusDados(ctx: RequestContext): Promise<Partial<ClienteAFaturar> & { faturaLigada: boolean }> {
    const m = await this.prisma.runAs(ctx.academyId, async (db) => ({
      membership: await db.membership.findFirst({ where: { id: ctx.membershipId }, select: { invoiceDetails: true } }),
      conta: await db.invoicingAccount.findUnique({ where: { academyId: ctx.academyId }, select: { readyAt: true } }),
    }));
    return { ...dadosDeFaturacao(m.membership?.invoiceDetails), faturaLigada: m.conta?.readyAt != null };
  }

  async guardarMeusDados(ctx: RequestContext, dto: { nome?: string; nif?: string; morada?: string; codigoPostal?: string; localidade?: string }) {
    const nif = dto.nif?.trim() ?? "";
    if (nif && !nifOuNada(nif)) throw new BadRequestException("Esse NIF não é válido. Confere os nove algarismos.");
    const dados = {
      nome: dto.nome?.trim().slice(0, 100) || null,
      nif: nif || null,
      morada: dto.morada?.trim().slice(0, 200) || null,
      codigoPostal: dto.codigoPostal?.trim().slice(0, 12) || null,
      localidade: dto.localidade?.trim().slice(0, 80) || null,
    };
    const vazio = Object.values(dados).every((v) => v === null);
    await this.prisma.runAs(ctx.academyId, (db) =>
      db.membership.update({ where: { id: ctx.membershipId }, data: { invoiceDetails: vazio ? Prisma.DbNull : (dados as Prisma.InputJsonValue) } }),
    );
    return this.meusDados(ctx);
  }

  /* ------------------------------------------------------------------------ */
  /* As faturas, na consola                                                    */
  /* ------------------------------------------------------------------------ */

  async faturas(ctx: RequestContext, filtro: { estado?: string; take?: number }) {
    if (!can(ctx, "billing:read")) throw new ForbiddenException();
    const pedidos = (filtro.estado ?? "").split(",").map((s) => s.trim()).filter((s): s is InvoiceStatus => s in InvoiceStatus);
    const estados = pedidos.length ? pedidos : undefined;
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const lista = await db.invoice.findMany({
        where: { academyId: ctx.academyId, ...(estados ? { status: { in: estados } } : {}) },
        orderBy: { createdAt: "desc" },
        take: Math.min(Math.max(filtro.take ?? 100, 1), 500),
        include: { payment: { select: { method: true, paidAt: true, amountCents: true, identificador: true } } },
      });
      return lista.map((f) => this.faturaParaConsola(f));
    });
  }

  private faturaParaConsola(f: {
    id: string; status: InvoiceStatus; provider: InvoicingProvider; number: string | null; atcud: string | null; permalink: string | null;
    document: unknown; sentTo: string | null; sentAt: Date | null; attempts: number; nextAttemptAt: Date | null; lastError: string | null; createdAt: Date;
    payment: { method: string; paidAt: Date | null; amountCents: number; identificador: string | null };
  }) {
    const doc = f.document as DocumentoAFaturar;
    return {
      id: f.id,
      status: f.status,
      programa: NOME_DO_PROGRAMA[f.provider],
      numero: f.number,
      atcud: f.atcud,
      permalink: f.permalink,
      cliente: { nome: doc.cliente.nome, nif: doc.cliente.nif, email: doc.cliente.email },
      resumo: doc.resumo,
      totalCents: doc.totalCents,
      metodo: nomeDoMetodo(f.payment.method),
      pagoEm: f.payment.paidAt,
      referencia: doc.referencia,
      enviadaPara: f.sentTo,
      enviadaEm: f.sentAt,
      tentativas: f.attempts,
      proximaTentativa: f.nextAttemptAt,
      erro: f.lastError,
      criadaEm: f.createdAt,
    };
  }

  /** Voltar a tentar uma falhada, já. */
  async repetir(ctx: RequestContext, id: string) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException();
    await this.prisma.runAs(ctx.academyId, async (db) => {
      const f = await db.invoice.findFirst({ where: { id, academyId: ctx.academyId } });
      if (!f) throw new NotFoundException("Fatura não encontrada");
      if (f.status === InvoiceStatus.SENT || f.status === InvoiceStatus.CANCELLED) throw new BadRequestException("Esta fatura já está tratada.");
      await db.invoice.update({ where: { id }, data: { status: f.externalId ? InvoiceStatus.ISSUED : InvoiceStatus.PENDING, nextAttemptAt: null, attempts: 0, lastError: null } });
    });
    await this.processar(ctx.academyId, id);
    return this.prisma.runAs(ctx.academyId, async (db) => this.faturaParaConsola(await db.invoice.findFirstOrThrow({ where: { id }, include: { payment: { select: { method: true, paidAt: true, amountCents: true, identificador: true } } } })));
  }

  /** Mandar o email outra vez (ou para outro endereço). O PDF vem do programa. */
  async reenviar(ctx: RequestContext, id: string, email?: string) {
    if (!can(ctx, "billing:write")) throw new ForbiddenException();
    const para = email?.trim();
    if (para && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) throw new BadRequestException("Esse email não parece válido.");
    const f = await this.prisma.runAs(ctx.academyId, (db) => db.invoice.findFirst({ where: { id, academyId: ctx.academyId } }));
    if (!f) throw new NotFoundException("Fatura não encontrada");
    if (!f.externalId || (f.status !== InvoiceStatus.SENT && f.status !== InvoiceStatus.ISSUED)) throw new BadRequestException("Esta fatura ainda não foi emitida.");
    await this.comConta(ctx.academyId, async () => {
      const conta = await this.lerConta(ctx.academyId);
      if (!conta) throw new BadRequestException("O clube não tem faturação ligada.");
      try {
        await this.enviar(ctx.academyId, f.id, conta, para);
      } catch (e) {
        throw new BadRequestException(e instanceof ErroDeFaturacao ? e.message : "Não foi possível reenviar.");
      }
    });
    return { ok: true };
  }

  /* ------------------------------------------------------------------------ */
  /* O registo, na transação do pagamento                                      */
  /* ------------------------------------------------------------------------ */

  /**
   * Chamado por `confirmPayment`, dentro da transação, depois de o pagamento
   * ficar pago. Devolve o que correr depois do commit, ou nulo se não há
   * fatura a passar (clube sem faturação pronta, pagamento sem dono pago).
   * Nunca atira: um problema a montar a fatura não pode desfazer um
   * pagamento que entrou; fica no log e a fatura fica `FAILED` com o motivo.
   */
  async registar(db: ScopedClient, academyId: string, paymentId: string): Promise<(() => void) | null> {
    try {
      const conta = await db.invoicingAccount.findUnique({ where: { academyId }, select: { provider: true, readyAt: true, taxRules: true } });
      if (!conta?.readyAt) return null;
      const existente = await db.invoice.findUnique({ where: { paymentId }, select: { id: true } });
      if (existente) return null;

      const montado = await this.montar(db, academyId, paymentId, regrasFiscais(conta.taxRules));
      if (!montado) return null;

      const fatura = await db.invoice.create({
        data: { academyId, paymentId, provider: conta.provider, status: InvoiceStatus.PENDING, document: montado as unknown as Prisma.InputJsonValue },
        select: { id: true },
      });
      return () => void this.processar(academyId, fatura.id).catch((e) => this.log.error(`Fatura ${fatura.id}: ${e instanceof Error ? e.message : e}`));
    } catch (e) {
      const motivo = e instanceof Error ? e.message : String(e);
      this.log.error(`Não foi possível preparar a fatura do pagamento ${paymentId}: ${motivo}`);
      await db.invoice
        .create({
          data: {
            academyId, paymentId,
            provider: (await db.invoicingAccount.findUnique({ where: { academyId }, select: { provider: true } }))?.provider ?? "INVOICEXPRESS",
            status: InvoiceStatus.FAILED,
            document: { cliente: { nome: "?" }, linhas: [], totalCents: 0, referencia: paymentId, resumo: "pagamento" } as unknown as Prisma.InputJsonValue,
            lastError: `Não foi possível montar a fatura: ${motivo}`.slice(0, 500),
          },
        })
        .catch(() => undefined);
      return null;
    }
  }

  /** O documento de um pagamento, a partir do que ele liquida. Nulo = nada a faturar. */
  private async montar(db: ScopedClient, academyId: string, paymentId: string, regras: RegrasFiscais): Promise<DocumentoAFaturar | null> {
    const p = await db.payment.findFirst({
      where: { id: paymentId },
      include: {
        charge: {
          include: {
            athlete: { select: { name: true, guardians: { select: { membership: { select: { id: true, invoiceDetails: true, user: { select: { name: true, email: true } } } } } } } },
          },
        },
        memberFee: {
          include: {
            member: {
              select: {
                name: true, email: true, taxId: true, address: true, postalCode: true, city: true,
                athlete: { select: { guardians: { select: { membership: { select: { invoiceDetails: true, user: { select: { name: true, email: true } } } } } } } },
              },
            },
          },
        },
        memberFees: { include: { memberFee: { select: { period: true, label: true, amountCents: true } } }, orderBy: { memberFee: { period: "asc" } } },
        ticketOrder: {
          select: {
            status: true, buyerName: true, buyerEmail: true, buyerTaxId: true, totalCents: true, matchId: true,
            tickets: { select: { typeName: true, priceCents: true } },
          },
        },
        siteOrder: {
          select: { status: true, number: true, buyerName: true, buyerEmail: true, buyerTaxId: true, itemsCents: true, shippingCents: true, totalCents: true, items: { select: { productName: true, size: true, quantity: true, unitPriceCents: true } } },
        },
      },
    });
    if (!p || p.status !== PaymentStatus.PAID || !p.paidAt) return null;

    const base = { surchargeCents: p.surchargeCents, totalCents: p.amountCents, regras, referencia: p.identificador ?? p.id, pagoEm: p.paidAt, metodo: nomeDoMetodo(p.method) };
    const comoFamilia = (guardians: { membership: { invoiceDetails: unknown; user: { name: string | null; email: string | null } } }[], payerName: string | null) => {
      const escolhido = guardians.find((g) => payerName && g.membership.user.name?.trim() === payerName.trim()) ?? guardians[0];
      return escolhido ? clienteDe({ nome: escolhido.membership.user.name, email: escolhido.membership.user.email }, dadosDeFaturacao(escolhido.membership.invoiceDetails)) : null;
    };

    if (p.charge) {
      const c = p.charge;
      const cliente = comoFamilia(c.athlete.guardians, p.payerName) ?? clienteDe({ nome: p.payerName, email: null });
      const mensal = c.kind === "FEE";
      const descricao = mensal ? `Mensalidade de ${nomeDoPeriodo(c.period)} · ${c.athlete.name}` : `${c.title ?? "Cobrança"} · ${c.athlete.name}`;
      return montarDocumento({
        ...base,
        cliente,
        itens: [{ tipo: mensal ? "MENSALIDADE" : "EXTRA", descricao, quantidade: 1, unitarioCents: c.amountCents }],
        resumo: mensal ? `a mensalidade de ${nomeDoPeriodo(c.period)} de ${c.athlete.name}` : `${c.title ?? "a cobrança"} de ${c.athlete.name}`,
      });
    }

    if (p.memberFee) {
      const m = p.memberFee.member;
      const quotas = p.memberFees.length ? p.memberFees.map((x) => x.memberFee) : [p.memberFee];
      // Paga pela família (sócio menor): a fatura é do encarregado que pagou. Senão, do sócio, com o que a ficha dele tem.
      const cliente =
        (p.payerRelation && m.athlete ? comoFamilia(m.athlete.guardians, p.payerName) : null) ??
        clienteDe({ nome: m.name, email: m.email }, { nif: nifOuNada(m.taxId), morada: m.address, codigoPostal: m.postalCode, localidade: m.city });
      return montarDocumento({
        ...base,
        cliente,
        itens: quotas.map((q) => ({ tipo: "QUOTA" as TipoDeVenda, descricao: `Quota de sócio · ${q.label ?? nomeDoPeriodo(q.period)} · ${m.name}`, quantidade: 1, unitarioCents: q.amountCents })),
        resumo: quotas.length === 1 ? `a quota de ${quotas[0]!.label ?? nomeDoPeriodo(quotas[0]!.period)}` : `${quotas.length} quotas de sócio`,
      });
    }

    if (p.ticketOrder) {
      const o = p.ticketOrder;
      if (o.status !== "PAID") return null;
      const m = await db.match.findFirst({ where: { id: o.matchId }, select: { opponent: true, isHome: true, team: { select: { name: true } } } });
      const jogo = m ? matchTitle({ isHome: m.isHome, opponent: m.opponent, teamName: m.team.name }) : "o jogo";
      const grupos = new Map<string, ItemPago>();
      for (const t of o.tickets) {
        const chave = `${t.typeName}|${t.priceCents}`;
        const g = grupos.get(chave) ?? { tipo: "BILHETE" as TipoDeVenda, descricao: `Bilhete ${t.typeName} · ${jogo}`, quantidade: 0, unitarioCents: t.priceCents };
        g.quantidade += 1;
        grupos.set(chave, g);
      }
      return montarDocumento({
        ...base,
        cliente: clienteDe({ nome: o.buyerName, email: o.buyerEmail }, { nif: nifOuNada(o.buyerTaxId) }),
        itens: [...grupos.values()].filter((g) => g.unitarioCents > 0),
        resumo: `${o.tickets.length === 1 ? "o bilhete" : `${o.tickets.length} bilhetes`} para ${jogo}`,
      });
    }

    if (p.siteOrder) {
      const o = p.siteOrder;
      if (!ESTADO_PAGO_DA_ENCOMENDA.includes(o.status)) return null;
      const itens: ItemPago[] = o.items.map((i) => ({ tipo: "LOJA", descricao: i.size ? `${i.productName} · ${i.size}` : i.productName, quantidade: i.quantity, unitarioCents: i.unitPriceCents }));
      if (o.shippingCents > 0) itens.push({ tipo: "ENVIO", descricao: "Portes de envio", quantidade: 1, unitarioCents: o.shippingCents });
      return montarDocumento({
        ...base,
        cliente: clienteDe({ nome: o.buyerName, email: o.buyerEmail }, { nif: nifOuNada(o.buyerTaxId) }),
        itens,
        resumo: `a encomenda n.º ${o.number} da loja`,
      });
    }

    return null;
  }

  /* ------------------------------------------------------------------------ */
  /* A emissão, fora de qualquer transação                                     */
  /* ------------------------------------------------------------------------ */

  /** A fila: todos os clubes com faturação, um de cada vez; em cada um, renova os tokens e trata o que está por tratar. */
  async varrer(): Promise<void> {
    if (!this.cofre.pronto) return;
    const clubes = await this.prisma.$queryRaw<{ academy_id: string }[]>`SELECT * FROM app.academies_with_invoicing()`;
    for (const { academy_id } of clubes) {
      try {
        await this.renovarSePreciso(academy_id);
        const agora = new Date();
        const pendentes = await this.prisma.runAs(academy_id, (db) =>
          db.invoice.findMany({
            where: { academyId: academy_id, status: { in: [InvoiceStatus.PENDING, InvoiceStatus.ISSUED] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: agora } }] },
            orderBy: { createdAt: "asc" },
            take: 25,
            select: { id: true },
          }),
        );
        for (const { id } of pendentes) await this.processar(academy_id, id);
      } catch (e) {
        this.log.error(`Fila da faturação no clube ${academy_id}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  /** Uma fatura, do estado em que está até `SENT`, ou até à próxima falha. */
  async processar(academyId: string, invoiceId: string): Promise<void> {
    if (!this.cofre.pronto) return;
    await this.comConta(academyId, async () => {
      const reclamada = await this.reclamar(academyId, invoiceId);
      if (!reclamada) return;
      const conta = await this.lerConta(academyId);
      if (!conta?.readyAt) {
        await this.falhou(academyId, invoiceId, new ErroDeFaturacao("O clube não tem a faturação pronta.", true), reclamada.attempts);
        return;
      }
      try {
        let emitido: Emitido | null = reclamada.externalId
          ? { externalId: reclamada.externalId, number: reclamada.number, atcud: reclamada.atcud, permalink: reclamada.permalink, receiptExternalId: reclamada.receiptExternalId }
          : null;
        if (!emitido) {
          emitido = await this.emitir(academyId, invoiceId, conta, reclamada.document as DocumentoAFaturar);
        }
        await this.enviar(academyId, invoiceId, conta);
      } catch (e) {
        await this.falhou(academyId, invoiceId, e, reclamada.attempts);
      }
    });
  }

  private async emitir(academyId: string, invoiceId: string, conta: ContaLida, doc: DocumentoAFaturar): Promise<Emitido> {
    const conector = this.conectores[conta.provider];
    // Já lá está? Um servidor que caiu entre o "criar" e o "gravar" não emite duas vezes.
    const emitido = (await conector.procurar(conta.cred, conta.def, doc.referencia)) ?? (await conector.emitir(conta.cred, conta.def, doc));
    await this.prisma.runAs(academyId, (db) =>
      db.invoice.update({
        where: { id: invoiceId },
        data: { status: InvoiceStatus.ISSUED, externalId: emitido.externalId, number: emitido.number, atcud: emitido.atcud, permalink: emitido.permalink, receiptExternalId: emitido.receiptExternalId ?? null, lastError: null },
      }),
    );
    await this.limparErro(academyId);
    return emitido;
  }

  /** O PDF do programa, no email do clube a quem pagou. `para` força outro endereço (o "Reenviar" da consola). */
  private async enviar(academyId: string, invoiceId: string, conta: ContaLida, para?: string): Promise<void> {
    const f = await this.prisma.runAs(academyId, (db) => db.invoice.findFirstOrThrow({ where: { id: invoiceId } }));
    if (!f.externalId) throw new ErroDeFaturacao("A fatura ainda não foi emitida.", true);
    const doc = f.document as DocumentoAFaturar;
    const destino = para ?? doc.cliente.email;
    if (!destino) {
      // Sem email não há para quem mandar: a fatura está emitida, e a consola mostra-a para o clube a entregar como entender.
      await this.prisma.runAs(academyId, (db) => db.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.SENT, sentAt: new Date(), sentTo: null, lastError: "Quem pagou não tem email: a fatura ficou por entregar." } }));
      return;
    }

    const emitido: Emitido = { externalId: f.externalId, number: f.number, atcud: f.atcud, permalink: f.permalink, receiptExternalId: f.receiptExternalId };
    const pdf = await this.conectores[conta.provider].pdf(conta.cred, conta.def, emitido);

    const { brand, replyTo } = await this.prisma.runAs(academyId, async (db) => {
      const a = await db.academy.findFirst({ where: { id: academyId }, select: { name: true, shortName: true, signalColor: true, logoUrl: true } });
      const site = await db.siteConfig.findUnique({ where: { academyId }, select: { identity: true } });
      const email = identidadeValida(site?.identity).email.trim();
      const brand: MailBrand = { shortName: a?.shortName ?? "Clube", name: a?.name ?? "Clube", signalColor: a?.signalColor, logoUrl: a?.logoUrl };
      return { brand, replyTo: email ? { email, name: brand.shortName } : undefined };
    });

    const numero = f.number ?? `n.º ${f.externalId}`;
    const corpo = faturaEmail({ brand, nome: doc.cliente.nome, numero, valor: euros(doc.totalCents), resumo: doc.resumo, programa: NOME_DO_PROGRAMA[conta.provider], semFaturaRecibo: conta.provider === "SAGE_ONE" });
    const resultado = await this.mail.send({
      to: destino,
      toName: doc.cliente.nome,
      ...corpo,
      replyTo,
      kind: "fatura",
      attachments: [{ filename: `${numero.replace(/[^\w.-]+/g, "-")}.pdf`, content: pdf.toString("base64"), type: "application/pdf" }],
    });
    if (!resultado.sent) throw new ErroDeFaturacao(`O email não saiu: ${resultado.reason ?? "sem motivo"}.`, false);

    await this.prisma.runAs(academyId, (db) => db.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.SENT, sentAt: new Date(), sentTo: destino, lastError: null, nextAttemptAt: null } }));
  }

  /** Anular a fatura de um pagamento devolvido. Chamado depois do commit do reembolso; falhar fica no log e na fatura. */
  async anularDoPagamento(academyId: string, paymentId: string, motivo: string): Promise<void> {
    await this.comConta(academyId, async () => {
      const f = await this.prisma.runAs(academyId, (db) => db.invoice.findUnique({ where: { paymentId } }));
      if (!f || !f.externalId || f.status === InvoiceStatus.CANCELLED) return;
      const conta = await this.lerConta(academyId);
      if (!conta) return;
      try {
        await this.conectores[conta.provider].anular(
          conta.cred,
          conta.def,
          { externalId: f.externalId, number: f.number, atcud: f.atcud, permalink: f.permalink, receiptExternalId: f.receiptExternalId },
          motivo,
          f.document as DocumentoAFaturar,
        );
        await this.prisma.runAs(academyId, (db) => db.invoice.update({ where: { id: f.id }, data: { status: InvoiceStatus.CANCELLED, lastError: null } }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.error(`Não foi possível anular a fatura ${f.number ?? f.id}: ${msg}`);
        await this.prisma.runAs(academyId, (db) => db.invoice.update({ where: { id: f.id }, data: { lastError: `Reembolsada, mas a anulação no programa falhou: ${msg}`.slice(0, 500) } }));
      }
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Os pedaços                                                                */
  /* ------------------------------------------------------------------------ */

  /** Reclama a fatura para esta volta. Nulo = já tratada, ou alguém está em cima dela. */
  private async reclamar(academyId: string, invoiceId: string) {
    return this.prisma.runAs(academyId, async (db) => {
      const agora = new Date();
      const n = await db.invoice.updateMany({
        where: { id: invoiceId, status: { in: [InvoiceStatus.PENDING, InvoiceStatus.ISSUED] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: agora } }] },
        data: { nextAttemptAt: new Date(agora.getTime() + RECLAMADA_MIN * 60_000), attempts: { increment: 1 } },
      });
      if (n.count !== 1) return null;
      return db.invoice.findFirstOrThrow({ where: { id: invoiceId } });
    });
  }

  private async falhou(academyId: string, invoiceId: string, e: unknown, tentativas: number): Promise<void> {
    const erro = e instanceof ErroDeFaturacao ? e : new ErroDeFaturacao(e instanceof Error ? e.message : String(e), false);
    const desistir = erro.definitivo || tentativas >= TENTATIVAS_MAXIMAS;
    const espera = ESPERAS_MIN[Math.min(tentativas, ESPERAS_MIN.length - 1)] ?? 1440;
    this.log[desistir ? "error" : "warn"](`Fatura ${invoiceId}: ${erro.message}${erro.detalhe ? ` [${erro.detalhe.slice(0, 200)}]` : ""}`);
    await this.prisma.runAs(academyId, (db) =>
      db.invoice.update({
        where: { id: invoiceId },
        data: desistir
          ? { status: InvoiceStatus.FAILED, lastError: erro.message.slice(0, 500), nextAttemptAt: null }
          : { lastError: erro.message.slice(0, 500), nextAttemptAt: new Date(Date.now() + espera * 60_000) },
      }),
    );
    if (erro.definitivo) await this.registarErro(academyId, erro);
  }

  private async registarErro(academyId: string, e: unknown): Promise<void> {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await this.prisma.runAs(academyId, (db) => db.invoicingAccount.updateMany({ where: { academyId }, data: { lastError: msg, lastErrorAt: new Date() } })).catch(() => undefined);
  }

  private async limparErro(academyId: string): Promise<void> {
    await this.prisma.runAs(academyId, (db) => db.invoicingAccount.updateMany({ where: { academyId, lastError: { not: null } }, data: { lastError: null, lastErrorAt: null } })).catch(() => undefined);
  }

  private async renovarSePreciso(academyId: string): Promise<void> {
    await this.comConta(academyId, async () => {
      const conta = await this.lerConta(academyId);
      const conector = conta ? this.conectores[conta.provider] : null;
      if (!conta || !conector?.renovar) return;
      try {
        const novas = await conector.renovar(conta.cred);
        if (novas) await this.prisma.runAs(academyId, (db) => db.invoicingAccount.update({ where: { academyId }, data: { credentials: this.cofre.cifrar(JSON.stringify(novas)) } }));
      } catch (e) {
        await this.registarErro(academyId, e);
      }
    });
  }

  private async lerConta(academyId: string): Promise<ContaLida | null> {
    const conta = await this.prisma.runAs(academyId, (db) => db.invoicingAccount.findUnique({ where: { academyId } }));
    if (!conta) return null;
    const cred = JSON.parse(this.cofre.decifrar(conta.credentials)) as Credenciais;
    return { provider: conta.provider, cred, def: this.definicoes(conta.settings), taxRules: conta.taxRules, readyAt: conta.readyAt };
  }

  private definicoes(json: unknown): DefinicoesDaConta {
    if (!json || typeof json !== "object") return {};
    const o = json as Record<string, unknown>;
    const texto = (v: unknown) => (typeof v === "string" && v ? v : undefined);
    const interno = o.interno && typeof o.interno === "object" ? Object.fromEntries(Object.entries(o.interno as Record<string, unknown>).filter(([, v]) => typeof v === "string") as [string, string][]) : undefined;
    return {
      serieId: texto(o.serieId), serieNome: texto(o.serieNome),
      companyId: texto(o.companyId), companyNome: texto(o.companyNome),
      paymentMethodId: texto(o.paymentMethodId),
      bankAccountId: texto(o.bankAccountId), paymentTypeId: texto(o.paymentTypeId),
      ...(interno ? { interno } : {}),
    };
  }

  /** Serializa por clube: o que vier enquanto outra coisa corre espera pela vez. */
  private comConta<T>(academyId: string, trabalho: () => Promise<T>): Promise<T> {
    const anterior = this.filaPorClube.get(academyId) ?? Promise.resolve();
    const minha = anterior.catch(() => undefined).then(trabalho);
    this.filaPorClube.set(academyId, minha);
    void minha.catch(() => undefined).finally(() => {
      if (this.filaPorClube.get(academyId) === minha) this.filaPorClube.delete(academyId);
    });
    return minha;
  }

  /** A regra fiscal de um tipo, para quem quiser mostrar o IVA antes de vender. */
  regraDoTipo(regras: unknown, tipo: TipoDeVenda) {
    return regraDe(regrasFiscais(regras), tipo);
  }
}

type ContaLida = { provider: InvoicingProvider; cred: Credenciais; def: DefinicoesDaConta; taxRules: unknown; readyAt: Date | null };
