import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "./storage.service";
import { can, teamScopeFilter, type RequestContext } from "../common/permissions";

/**
 * Fotografias de atletas e de staff.
 *
 * ## O caminho, em três passos
 *
 * 1. A consola pede autorização (`.../foto/upload`) e recebe um endereço assinado.
 * 2. O browser carrega o ficheiro **directamente** para o Supabase.
 * 3. A consola confirma (`.../foto`), o servidor verifica que o ficheiro chegou
 *    mesmo e grava a chave.
 *
 * O ficheiro não passa pela API de propósito — atravessar imagens no processo que
 * serve toda a gente é trabalho a mais para nada. O que a API decide é *se pode*:
 * o token assinado vale para **uma** chave, escolhida por nós, e a chave leva o id
 * do atleta lá dentro. Quem tentar reutilizá-lo noutro sítio não vai a lado nenhum.
 *
 * ## Porque é que o passo 3 verifica
 *
 * Porque entre o passo 1 e o 2 pode falhar a rede, e uma chave gravada sem ficheiro
 * por trás é uma fotografia partida em todos os ecrãs onde aquele atleta aparecer.
 * Um `HEAD` ao objecto custa um pedido e evita isso.
 */

/** Fotografias de menores. Privado, e o nome do bucket di-lo a quem for lá ver. */
export const PHOTO_BUCKET = "fotos";

/**
 * Seis horas.
 *
 * Um turno de secretaria inteiro sem o link expirar a meio, e curto o suficiente
 * para que um endereço que escape por um ecrã partilhado deixe de servir no mesmo
 * dia. As páginas recarregam os dados muito antes disso.
 */
export const PHOTO_TTL = 6 * 60 * 60;

/** 8 MB. Uma fotografia de ficha não precisa de mais, e o tecto do projecto é 50. */
const MAX_BYTES = 8 * 1024 * 1024;

const TYPES = ["image/jpeg", "image/png", "image/webp"];

@Injectable()
export class PhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private ensureBucket() {
    return this.storage.ensureBucket({
      name: PHOTO_BUCKET,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: TYPES,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Atletas                                                                   */
  /* ------------------------------------------------------------------------ */

  async athleteUploadUrl(ctx: RequestContext, athleteId: string, contentType: string) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão");
    this.checkType(contentType);

    await this.assertAthleteInScope(ctx, athleteId);
    await this.ensureBucket();

    // A chave leva o id do atleta e um sufixo aleatório: o id para se saber de quem
    // é o ficheiro sem consultar nada, o aleatório para trocar a foto não deixar o
    // browser a mostrar a antiga em cache.
    const key = `atletas/${athleteId}/${randomBytes(8).toString("hex")}${extensionFor(contentType)}`;
    const signed = await this.storage.signUpload(PHOTO_BUCKET, key);

    return { ...signed, key, maxBytes: MAX_BYTES };
  }

  async setAthletePhoto(ctx: RequestContext, athleteId: string, key: string) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão");
    await this.assertAthleteInScope(ctx, athleteId);

    // A chave tem de ser deste atleta. Sem isto, quem obtivesse uma autorização
    // para o seu próprio atleta apontava a ficha de outro para a mesma fotografia.
    if (!key.startsWith(`atletas/${athleteId}/`)) throw new BadRequestException("Chave inválida");
    if (!(await this.storage.exists(PHOTO_BUCKET, key))) {
      throw new BadRequestException("O ficheiro não chegou ao armazenamento");
    }

    /*
     * Dentro da transação, só base de dados.
     *
     * Apagar a anterior e assinar a nova são idas ao Supabase pela rede. Feitas aqui
     * dentro, seguravam uma ligação do pool (que tem cinco) durante todo esse tempo
     * — e o pedido seguinte morria em `P2028 — Unable to start a transaction in the
     * given time`, incluindo os do `AuthGuard`, que precisa de uma transação para
     * montar o contexto de **cada** pedido. O sintoma não aparecia aqui: aparecia na
     * app inteira a ficar pendurada.
     */
    const before = await this.prisma.runAs(ctx.academyId, async (db) => {
      const previous = await db.athlete.findFirst({ where: { id: athleteId }, select: { photoKey: true } });
      await db.athlete.update({ where: { id: athleteId }, data: { photoKey: key } });
      return previous?.photoKey ?? null;
    });

    // A anterior deixa de ter dono — apaga-se, senão o armazenamento enche-se de
    // fotografias de crianças que ninguém sabe que lá estão.
    if (before && before !== key) await this.storage.remove(PHOTO_BUCKET, before);

    return { photoUrl: await this.storage.signDownload(PHOTO_BUCKET, key, PHOTO_TTL) };
  }

  async removeAthletePhoto(ctx: RequestContext, athleteId: string) {
    if (!can(ctx, "athlete:write")) throw new ForbiddenException("Sem permissão");
    await this.assertAthleteInScope(ctx, athleteId);

    const before = await this.prisma.runAs(ctx.academyId, async (db) => {
      const previous = await db.athlete.findFirst({ where: { id: athleteId }, select: { photoKey: true } });
      await db.athlete.update({ where: { id: athleteId }, data: { photoKey: null } });
      return previous?.photoKey ?? null;
    });

    if (before) await this.storage.remove(PHOTO_BUCKET, before);

    return { ok: true };
  }

  /* ------------------------------------------------------------------------ */
  /* Staff                                                                     */
  /* ------------------------------------------------------------------------ */

  /**
   * A fotografia de quem trabalha na academia.
   *
   * Duas portas: `staff:write` (a direção trata da ficha de qualquer pessoa) **ou**
   * ser a própria pessoa. A segunda é o caso normal — um treinador põe a sua foto
   * sem ter de pedir a ninguém — e não precisa de permissão nenhuma para isso:
   * mexer na própria ficha nunca foi um privilégio.
   */
  async staffUploadUrl(ctx: RequestContext, membershipId: string, contentType: string) {
    this.checkType(contentType);
    const userId = await this.assertStaffAllowed(ctx, membershipId);
    await this.ensureBucket();

    const key = `staff/${userId}/${randomBytes(8).toString("hex")}${extensionFor(contentType)}`;
    const signed = await this.storage.signUpload(PHOTO_BUCKET, key);

    return { ...signed, key, maxBytes: MAX_BYTES };
  }

  async setStaffPhoto(ctx: RequestContext, membershipId: string, key: string) {
    const userId = await this.assertStaffAllowed(ctx, membershipId);

    if (!key.startsWith(`staff/${userId}/`)) throw new BadRequestException("Chave inválida");
    if (!(await this.storage.exists(PHOTO_BUCKET, key))) {
      throw new BadRequestException("O ficheiro não chegou ao armazenamento");
    }

    /*
     * `User` não tem `academyId` — é a pessoa, não a ligação dela a uma academia — e
     * a política de RLS deixa ver quem partilha academia connosco. A escrita corre
     * dentro do contexto do tenant, como o resto.
     */
    // Rede fora da transação — ver a explicação em `setAthletePhoto`.
    const before = await this.prisma.runAs(ctx.academyId, async (db) => {
      const previous = await db.user.findFirst({ where: { id: userId }, select: { photoKey: true } });
      await db.user.update({ where: { id: userId }, data: { photoKey: key } });
      return previous?.photoKey ?? null;
    });

    if (before && before !== key) await this.storage.remove(PHOTO_BUCKET, before);

    return { photoUrl: await this.storage.signDownload(PHOTO_BUCKET, key, PHOTO_TTL) };
  }

  async removeStaffPhoto(ctx: RequestContext, membershipId: string) {
    const userId = await this.assertStaffAllowed(ctx, membershipId);

    const before = await this.prisma.runAs(ctx.academyId, async (db) => {
      const previous = await db.user.findFirst({ where: { id: userId }, select: { photoKey: true } });
      await db.user.update({ where: { id: userId }, data: { photoKey: null } });
      return previous?.photoKey ?? null;
    });

    if (before) await this.storage.remove(PHOTO_BUCKET, before);

    return { ok: true };
  }

  /* ------------------------------------------------------------------------ */

  private checkType(contentType: string) {
    if (!TYPES.includes(contentType)) {
      throw new BadRequestException("A fotografia tem de ser JPEG, PNG ou WebP");
    }
  }

  private async assertAthleteInScope(ctx: RequestContext, athleteId: string) {
    const scope = teamScopeFilter(ctx);
    const found = await this.prisma.runAs(ctx.academyId, (db) =>
      db.athlete.findFirst({
        where: { id: athleteId, ...(scope ? { teams: { some: { teamId: scope } } } : {}) },
        select: { id: true },
      }),
    );
    if (!found) throw new NotFoundException("Atleta não encontrado ou fora do teu âmbito");
  }

  /** Devolve o `userId` de quem vai ficar com a fotografia. */
  private async assertStaffAllowed(ctx: RequestContext, membershipId: string): Promise<string> {
    const membership = await this.prisma.runAs(ctx.academyId, (db) =>
      db.membership.findFirst({ where: { id: membershipId }, select: { id: true, userId: true } }),
    );
    if (!membership) throw new NotFoundException("Pessoa não encontrada");

    const eu = membership.id === ctx.membershipId;
    if (!eu && !can(ctx, "staff:write")) throw new ForbiddenException("Sem permissão");

    return membership.userId;
  }
}

/* ---------------------------------------------------------------------------- */

/**
 * A extensão certa para o tipo.
 *
 * O Supabase serve o ficheiro pelo `content-type` do carregamento, mas a extensão
 * na chave é o que faz um humano perceber o que está a ver quando abre o bucket
 * pela consola do Supabase à procura de alguma coisa.
 */
function extensionFor(contentType: string): string {
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}
