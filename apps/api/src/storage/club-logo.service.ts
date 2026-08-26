import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "./storage.service";
import { can, type RequestContext } from "../common/permissions";

/**
 * O símbolo do clube.
 *
 * ## Porque é que este bucket é público e os outros não
 *
 * Porque este ficheiro é lido **sem sessão nenhuma**: vai no
 * `manifest.webmanifest` que o telemóvel de um pai busca ao instalar a app, e na
 * página de adesão a sócio, que é aberta ao mundo. Um endereço assinado com seis
 * horas de validade — como as fotografias dos atletas — dava um ícone partido no
 * ecrã inicial ao fim da tarde.
 *
 * É a única excepção à regra de `StorageService`, e o nome do bucket di-lo:
 * `clube-publico`. Não entra aqui nada que não seja para ser visto por toda a
 * gente.
 *
 * ## O caminho, igual ao das fotografias
 *
 * A consola pede autorização, o browser carrega directamente para o Supabase, e
 * a consola confirma. O ficheiro não passa pela API — ver `PhotosService`.
 */

export const LOGO_BUCKET = "clube-publico";

/** 2 MB. Um emblema não precisa de mais, e mantém o manifest leve no telemóvel. */
const MAX_BYTES = 2 * 1024 * 1024;

const TYPES = ["image/png", "image/webp", "image/jpeg"];

@Injectable()
export class ClubLogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  private ensureBucket() {
    return this.storage.ensureBucket({
      name: LOGO_BUCKET,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: TYPES,
      public: true,
    });
  }

  /** Passo 1: autorização para carregar. A chave é escolhida aqui, nunca pelo cliente. */
  async signUpload(ctx: RequestContext, contentType: string) {
    this.mustWrite(ctx);
    if (!TYPES.includes(contentType)) {
      throw new BadRequestException("O símbolo tem de ser PNG, WebP ou JPEG");
    }

    await this.ensureBucket();

    // O sufixo aleatório é o que faz a cache do browser e do telemóvel largarem
    // o símbolo antigo: sem ele, um clube que trocasse de emblema continuava a
    // ver o anterior no ecrã inicial durante dias.
    const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
    const key = `${ctx.academyId}/simbolo-${randomBytes(6).toString("hex")}.${ext}`;

    const { url, token } = await this.storage.signUpload(LOGO_BUCKET, key);
    return { url, token, key };
  }

  /**
   * Passo 2: confirmar que chegou, e gravar.
   *
   * Verifica-se que o objecto existe mesmo antes de gravar a chave — entre a
   * autorização e o carregamento pode falhar a rede, e uma chave gravada sem
   * ficheiro por trás é um emblema partido em todos os ecrãs do clube.
   */
  async confirm(ctx: RequestContext, key: string) {
    this.mustWrite(ctx);

    // A chave tem de ser desta academia. Sem isto, quem tivesse `settings:write`
    // apontava o símbolo do seu clube para o ficheiro de outro.
    if (!key.startsWith(`${ctx.academyId}/`)) throw new ForbiddenException("Chave inválida");

    const exists = await this.storage.exists(LOGO_BUCKET, key);
    if (!exists) throw new BadRequestException("O ficheiro não chegou. Tenta outra vez.");

    const base = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
    const logoUrl = `${base}/storage/v1/object/public/${LOGO_BUCKET}/${key}`;

    await this.prisma.runAs(ctx.academyId, async (db) => {
      await db.academy.update({ where: { id: ctx.academyId }, data: { logoUrl } });
    });

    return { logoUrl };
  }

  /** Tirar o símbolo. O ficheiro fica — é barato, e um clube que se arrependa repõe-no. */
  async remove(ctx: RequestContext) {
    this.mustWrite(ctx);

    await this.prisma.runAs(ctx.academyId, async (db) => {
      await db.academy.update({ where: { id: ctx.academyId }, data: { logoUrl: null } });
    });

    return { ok: true };
  }

  private mustWrite(ctx: RequestContext) {
    if (!can(ctx, "settings:write")) throw new ForbiddenException("Sem permissão para mudar as definições");
  }
}
