import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlatformPrisma } from "../platform/platform.prisma";
import { PlatformService } from "../platform/platform.service";
import type { PlatformAdminContext } from "../platform/platform.guard";
import { dominioLimpo, dominioValido } from "./site.tipos";
import { SiteRevalidarService } from "./site-revalidar.service";

/**
 * O domínio próprio do site de um clube, ligado a partir do painel da
 * plataforma.
 *
 * ## O que "Ligar" faz
 *
 *   1. Acrescenta `adfafe.pt` e `www.adfafe.pt` ao projeto do site no Vercel
 *      (o `www` redireciona para o domínio sem `www`), pela API do Vercel.
 *   2. Grava `Academy.siteDomain`. É por ele que o site responde ao domínio
 *      (`app.resolve_site_by_domain`).
 *
 * O registo do domínio e os nameservers continuam fora daqui: registar com o
 * clube como titular e os nameservers em `ns1/ns2.vercel-dns.com` (ou, se o
 * clube mantém o DNS dele, um `A` e um `CNAME`). Ver `docs/08-site-do-clube.md`.
 *
 * ## Sem token do Vercel
 *
 * `VERCEL_TOKEN`, `VERCEL_SITE_PROJECT_ID` e `VERCEL_TEAM_ID` (opcional numa
 * conta pessoal). Sem token, o domínio grava-se na mesma e o painel diz que o
 * passo do Vercel fica por fazer à mão: é melhor do que recusar e obrigar a
 * mexer na base.
 */

export type EstadoNoVercel =
  | { estado: "sem-token" }
  | { estado: "erro"; mensagem: string }
  | { estado: "ok"; verificado: boolean; configurado: boolean };

const API = "https://api.vercel.com";

@Injectable()
export class SiteDominioService {
  private readonly log = new Logger(SiteDominioService.name);

  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly platform: PlatformService,
    private readonly config: ConfigService,
    private readonly revalidar: SiteRevalidarService,
  ) {}

  async ler(academyId: string) {
    const a = await this.prisma.academy.findUnique({
      where: { id: academyId },
      select: {
        slug: true,
        siteDomain: true,
        siteDomainRenewsAt: true,
        siteConfig: { select: { published: true } },
        subscription: { select: { status: true, plan: { select: { name: true, includesWebsite: true } } } },
        status: true, trialEndsAt: true, suspendedAt: true,
      },
    });
    if (!a) throw new BadRequestException("Academia não encontrada");
    // As mesmas regras de `app.academy_website_by_plan` e `app.academy_in_trial`, lidas aqui sem RLS.
    const noPlano = !!a.subscription && a.subscription.status !== "CANCELLED" && a.subscription.plan.includesWebsite;
    const emAvaliacao =
      !!a.trialEndsAt &&
      a.trialEndsAt > new Date() &&
      a.status !== "CANCELLED" &&
      !a.suspendedAt &&
      !(a.subscription && (a.subscription.status === "ACTIVE" || a.subscription.status === "PAST_DUE"));
    return {
      noPlano,
      /** Sem o plano, mas com o site enquanto a avaliação corre. O domínio próprio continua a pedir o plano. */
      naExperiencia: !noPlano && emAvaliacao,
      experienciaAte: !noPlano && emAvaliacao ? a.trialEndsAt!.toISOString().slice(0, 10) : null,
      plano: a.subscription?.plan.name ?? null,
      dominio: a.siteDomain,
      renovaEm: a.siteDomainRenewsAt?.toISOString().slice(0, 10) ?? null,
      publicado: a.siteConfig?.published ?? false,
      preVisualizacao: this.preVisualizacao(a.slug),
      vercel: a.siteDomain ? await this.estado(a.siteDomain) : null,
    };
  }

  async ligar(admin: PlatformAdminContext, academyId: string, bruto: string, renovaEm: string | null, ip?: string) {
    const dominio = dominioLimpo(bruto);
    if (!dominioValido(dominio)) throw new BadRequestException("Domínio inválido. Escreve só o domínio, por exemplo adfafe.pt");
    if (dominio === "academias.pt" || dominio.endsWith(".academias.pt")) {
      throw new BadRequestException("Os endereços academias.pt não se ligam aqui: o site do clube já está em <slug>.website.academias.pt");
    }

    const a = await this.prisma.academy.findUnique({
      where: { id: academyId },
      select: { slug: true, siteDomain: true, subscription: { select: { status: true, plan: { select: { includesWebsite: true } } } } },
    });
    if (!a) throw new BadRequestException("Academia não encontrada");
    if (!a.subscription || a.subscription.status === "CANCELLED" || !a.subscription.plan.includesWebsite) {
      // Também em avaliação: o site funciona na pré-visualização, mas um domínio regista-se e paga-se.
      throw new BadRequestException("O plano deste clube não inclui o site. Passa-o para o Connect Pro antes de ligar o domínio (em avaliação, o site funciona no endereço de pré-visualização).");
    }
    const outro = await this.prisma.academy.findFirst({ where: { siteDomain: dominio, NOT: { id: academyId } }, select: { name: true } });
    if (outro) throw new BadRequestException(`Esse domínio já está ligado a ${outro.name}`);

    // Primeiro o Vercel: se falhar, nada fica gravado a meio.
    if (this.temToken()) {
      await this.acrescentar({ name: dominio });
      await this.acrescentar({ name: `www.${dominio}`, redirect: dominio, redirectStatusCode: 308 });
    }

    // Trocar de domínio tira o antigo do projeto.
    if (a.siteDomain && a.siteDomain !== dominio && this.temToken()) await this.tirarDoVercel(a.siteDomain);

    await this.prisma.academy.update({
      where: { id: academyId },
      data: { siteDomain: dominio, siteDomainRenewsAt: renovaEm ? new Date(`${renovaEm}T00:00:00Z`) : null },
    });
    await this.platform.audit(admin, "academy.siteDomain", "academy", academyId, { slug: a.slug, de: a.siteDomain, para: dominio }, ip);
    this.revalidar.avisar(a.slug);
    return this.ler(academyId);
  }

  async desligar(admin: PlatformAdminContext, academyId: string, ip?: string) {
    const a = await this.prisma.academy.findUnique({ where: { id: academyId }, select: { slug: true, siteDomain: true } });
    if (!a) throw new BadRequestException("Academia não encontrada");
    if (a.siteDomain && this.temToken()) await this.tirarDoVercel(a.siteDomain);
    await this.prisma.academy.update({ where: { id: academyId }, data: { siteDomain: null, siteDomainRenewsAt: null } });
    await this.platform.audit(admin, "academy.siteDomain", "academy", academyId, { slug: a.slug, de: a.siteDomain, para: null }, ip);
    this.revalidar.avisar(a.slug);
    return this.ler(academyId);
  }

  /* ------------------------------------------------------------------------ */
  /* O Vercel                                                                   */
  /* ------------------------------------------------------------------------ */

  private temToken() {
    return !!this.config.get<string>("VERCEL_TOKEN") && !!this.config.get<string>("VERCEL_SITE_PROJECT_ID");
  }

  private url(caminho: string) {
    const team = this.config.get<string>("VERCEL_TEAM_ID");
    return `${API}${caminho}${team ? `${caminho.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(team)}` : ""}`;
  }

  private pedido(caminho: string, init: RequestInit = {}) {
    return fetch(this.url(caminho), {
      ...init,
      headers: { Authorization: `Bearer ${this.config.get<string>("VERCEL_TOKEN")}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(10_000),
    });
  }

  private get projeto() {
    return encodeURIComponent(this.config.get<string>("VERCEL_SITE_PROJECT_ID") ?? "");
  }

  /** Acrescentar ao projeto. Já lá estar não é erro. */
  private async acrescentar(corpo: Record<string, unknown>) {
    const r = await this.pedido(`/v10/projects/${this.projeto}/domains`, { method: "POST", body: JSON.stringify(corpo) });
    if (r.ok) return;
    const erro = (await r.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (erro.error?.code === "domain_already_in_use" || erro.error?.code === "domain_exists") {
      // Já está neste projeto? Então está feito. Noutro projeto é um problema real.
      const v = await this.pedido(`/v9/projects/${this.projeto}/domains/${encodeURIComponent(String(corpo.name))}`);
      if (v.ok) return;
    }
    this.log.warn(`Vercel recusou ${String(corpo.name)}: ${r.status} ${erro.error?.code} ${erro.error?.message}`);
    throw new BadRequestException(`O Vercel recusou o domínio: ${erro.error?.message ?? `HTTP ${r.status}`}`);
  }

  private async tirarDoVercel(dominio: string) {
    for (const nome of [`www.${dominio}`, dominio]) {
      const r = await this.pedido(`/v9/projects/${this.projeto}/domains/${encodeURIComponent(nome)}`, { method: "DELETE" }).catch(() => null);
      if (r && !r.ok && r.status !== 404) this.log.warn(`Não foi possível tirar ${nome} do Vercel: ${r.status}`);
    }
  }

  /** Se o Vercel já confirmou o domínio, e se o DNS aponta para ele. */
  private async estado(dominio: string): Promise<EstadoNoVercel> {
    if (!this.temToken()) return { estado: "sem-token" };
    try {
      const [p, c] = await Promise.all([
        this.pedido(`/v9/projects/${this.projeto}/domains/${encodeURIComponent(dominio)}`),
        this.pedido(`/v6/domains/${encodeURIComponent(dominio)}/config`),
      ]);
      if (p.status === 404) return { estado: "erro", mensagem: "O domínio não está no projeto do site no Vercel" };
      if (!p.ok) return { estado: "erro", mensagem: `O Vercel respondeu ${p.status}` };
      const proj = (await p.json()) as { verified?: boolean };
      const conf = c.ok ? ((await c.json()) as { misconfigured?: boolean }) : { misconfigured: true };
      return { estado: "ok", verificado: proj.verified === true, configurado: conf.misconfigured === false };
    } catch (e) {
      return { estado: "erro", mensagem: `Sem resposta do Vercel: ${String(e)}` };
    }
  }

  private preVisualizacao(slug: string) {
    const dominio = this.config.get<string>("SITE_PREVIEW_DOMAIN") ?? "website.academias.pt";
    return `https://${slug}.${dominio}`;
  }
}
