import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { EspacoService } from "../storage/espaco.service";
import { can, type RequestContext } from "../common/permissions";
import { SITE_BUCKET } from "../site/site.service";
import { siteIncluido } from "../site/plano";
import { SiteRevalidarService } from "../site/site-revalidar.service";
import type { PatrocinadorDaGestaoDto } from "./patrocinadores.dto";

const LOGO_MAX_BYTES = 5 * 1024 * 1024;
const LOGO_TYPES = ["image/png", "image/webp", "image/jpeg"];

/**
 * Os patrocinadores e parceiros do clube (Gestão → Patrocinadores).
 *
 * ## Uma lista só
 *
 * São as linhas de `SiteSponsor`, as mesmas que o menu Website editava. O
 * site do clube (Connect Pro) mostra-as no rodapé, e a app do sócio mostra-as
 * no separador Parcerias com a vantagem de cada um. Não há cópia nenhuma para
 * manter em sincronia: gravar aqui é gravar no site, e cada escrita avisa o
 * site para a página seguinte já a trazer.
 *
 * Ao contrário do menu Website, não exige o site no plano: um clube sem site
 * também tem parceiros para mostrar aos sócios.
 *
 * Quem tem `website:*` continua a poder, porque o menu Website mostra esta
 * mesma lista.
 *
 * Os logótipos vão para o bucket público do site (`site-publico/<clube>/`):
 * endereços estáveis, que o browser guarda, e que o site já sabe mostrar.
 */
@Injectable()
export class PatrocinadoresService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly espaco: EspacoService,
    private readonly config: ConfigService,
    private readonly revalidar: SiteRevalidarService,
  ) {}

  async listar(ctx: RequestContext) {
    if (!podeLer(ctx)) throw new ForbiddenException("Sem acesso aos patrocinadores");
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const [linhas, noSite] = await Promise.all([
        db.siteSponsor.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] }),
        siteIncluido(db, ctx.academyId),
      ]);
      return {
        patrocinadores: linhas.map(paraConsola),
        /** O clube tem o site no plano: a consola diz que a lista também aparece lá. */
        noSite,
      };
    });
  }

  async criar(ctx: RequestContext, dto: PatrocinadorDaGestaoDto) {
    this.mustWrite(ctx);
    const p = await this.prisma.runAs(ctx.academyId, async (db) => {
      const ultimo = await db.siteSponsor.findFirst({ orderBy: { position: "desc" }, select: { position: true } });
      return db.siteSponsor.create({
        data: { academyId: ctx.academyId, ...this.dados(ctx, dto), position: (ultimo?.position ?? -1) + 1 },
      });
    });
    this.avisar(ctx);
    return paraConsola(p);
  }

  async editar(ctx: RequestContext, id: string, dto: PatrocinadorDaGestaoDto) {
    this.mustWrite(ctx);
    const p = await this.prisma.runAs(ctx.academyId, async (db) => {
      if (!(await db.siteSponsor.findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException("Patrocinador não encontrado");
      return db.siteSponsor.update({ where: { id }, data: this.dados(ctx, dto) });
    });
    this.avisar(ctx);
    return paraConsola(p);
  }

  async apagar(ctx: RequestContext, id: string) {
    this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, (db) => db.siteSponsor.deleteMany({ where: { id } }));
    this.avisar(ctx);
    return { ok: true as const };
  }

  /** A ordem por que aparecem, no site e na app. Ids que não são do clube não mexem em nada (RLS). */
  async ordenar(ctx: RequestContext, ids: string[]) {
    this.mustWrite(ctx);
    await this.prisma.runAs(ctx.academyId, async (db) => {
      for (const [position, id] of ids.entries()) await db.siteSponsor.updateMany({ where: { id }, data: { position } });
    });
    this.avisar(ctx);
    return { ok: true as const };
  }

  /** Autorização para carregar um logótipo: do browser para o Supabase, sem passar pela API. */
  async assinarLogotipo(ctx: RequestContext, contentType: string) {
    this.mustWrite(ctx);
    if (!LOGO_TYPES.includes(contentType)) throw new BadRequestException("O logótipo tem de ser PNG, WebP ou JPEG");
    await this.espaco.garantirEspaco(ctx.academyId);
    await this.storage.ensureBucket({ name: SITE_BUCKET, fileSizeLimit: LOGO_MAX_BYTES, allowedMimeTypes: LOGO_TYPES, public: true });
    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const key = `${ctx.academyId}/patrocinador-${randomBytes(8).toString("hex")}.${ext}`;
    const { url, token } = await this.storage.signUpload(SITE_BUCKET, key);
    return { url, token, key, publicUrl: `${this.baseDasImagens()}/${key}` };
  }

  /* ------------------------------------------------------------------------ */

  private dados(ctx: RequestContext, dto: PatrocinadorDaGestaoDto) {
    return {
      name: dto.nome.trim(),
      url: siteDoParceiro(dto.url),
      logoUrl: this.logotipoDoClube(ctx, dto.logo),
      ...(dto.vantagem !== undefined ? { benefit: dto.vantagem.trim().replace(/\s+/g, " ") } : {}),
    };
  }

  private baseDasImagens(): string {
    const base = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
    return `${base}/storage/v1/object/public/${SITE_BUCKET}`;
  }

  /** Um logótipo só entra se for deste clube, no bucket do site. A mesma regra das imagens do site. */
  private logotipoDoClube(ctx: RequestContext, url: string | undefined): string | null {
    const s = (url ?? "").trim();
    if (!s) return null;
    const prefixo = `${this.baseDasImagens()}/${ctx.academyId}/`;
    if (!s.startsWith(prefixo) || /[\s?#]/.test(s.slice(prefixo.length))) {
      throw new BadRequestException("O logótipo tem de ser carregado pela consola");
    }
    return s;
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "sponsor:write") && !can(ctx, "website:write")) throw new ForbiddenException("Sem permissão para mexer nos patrocinadores");
  }

  /** Depois de gravar, sem esperar: o aviso ao site nunca atrasa nem falha uma escrita. */
  private avisar(ctx: RequestContext) {
    void this.prisma
      .runAs(ctx.academyId, (db) => db.academy.findFirst({ where: { id: ctx.academyId }, select: { slug: true } }))
      .then((a) => a && this.revalidar.avisar(a.slug))
      .catch(() => undefined);
  }
}

function podeLer(ctx: RequestContext) {
  return can(ctx, "sponsor:read") || can(ctx, "sponsor:write") || can(ctx, "website:read");
}

function paraConsola(p: { id: string; name: string; url: string | null; logoUrl: string | null; benefit: string }) {
  return { id: p.id, nome: p.name, url: p.url ?? "", logo: p.logoUrl ?? "", vantagem: p.benefit };
}

/**
 * O site do parceiro, como se escreve: "farmaciacentral.pt" chega a
 * `https://farmaciacentral.pt`. Só `http(s)`, sem espaços; o resto fica vazio
 * (nunca um `javascript:` a abrir na app de um sócio).
 */
export function siteDoParceiro(v: string | undefined): string | null {
  let s = (v ?? "").trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s.replace(/^\/+/, "")}`;
  if (!/^https?:\/\/[^\s/?#]+\.[^\s/?#]+[^\s]*$/i.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? s : null;
  } catch {
    return null;
  }
}
