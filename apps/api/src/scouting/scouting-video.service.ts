import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { MomentKind, VideoKind } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { can, type RequestContext } from "../common/permissions";
import { StorageService } from "../storage/storage.service";
import type { AddMomentDto, StartUploadDto, UpdateVideoDto } from "./scouting.dto";

/**
 * A biblioteca de vídeo do scouting.
 *
 * ## O dado mais sensível do produto
 *
 * Imagem de menores que **não pertencem à academia**. Três consequências, e
 * nenhuma delas é opcional:
 *
 *  1. **Permissões próprias.** `scouting:video:read` e `scouting:video:write`, à
 *     parte de `scouting:read`/`write`. Um coordenador pode ler o dossiê sem ter
 *     direito às gravações, e essa distinção só é exprimível com quatro permissões.
 *  2. **Nunca há URLs permanentes.** O bucket é privado. Cada reprodução mina um
 *     link assinado de vida curta que caduca sozinho — um link público, mesmo
 *     "difícil de adivinhar", vive para sempre em qualquer conversa para onde for
 *     reencaminhado.
 *  3. **Tudo tem autor.** Quem carregou fica na linha; carregar e apagar entram no
 *     histórico do dossiê. Um vídeo de um menor que ninguém assume não existe.
 *
 * ## Porque é que os bytes não passam pelo NestJS
 *
 * Um vídeo de um jogo são centenas de megabytes. A atravessar o processo da API
 * seriam centenas de megabytes de memória por upload simultâneo, e o caminho mais
 * curto para derrubar o servidor com três scouts a trabalhar ao mesmo tempo. O
 * servidor autoriza e assina; os bytes vão do browser directamente para o Storage.
 */
@Injectable()
export class ScoutingVideoService {
  private readonly log = new Logger(ScoutingVideoService.name);
  private readonly bucket = "scouting";
  private ensured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  /* ---------------------------------------------------------------------- */

  async list(ctx: RequestContext, prospectId: string) {
    if (!can(ctx, "scouting:video:read")) throw new ForbiddenException("Sem acesso ao vídeo de scouting");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const rows = await db.prospectVideo.findMany({
        where: { prospectId },
        orderBy: [{ recordedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
        select: {
          id: true, title: true, kind: true, recordedOn: true, competition: true, opponent: true,
          durationSec: true, notes: true, tags: true, status: true, sizeBytes: true, createdAt: true,
          observationId: true,
          uploadedBy: { select: { user: { select: { name: true } } } },
          moments: {
            orderBy: { atSec: "asc" },
            select: {
              id: true, atSec: true, kind: true, label: true,
              createdBy: { select: { user: { select: { name: true } } } },
            },
          },
        },
      });

      return rows.map((v) => ({
        ...v,
        uploadedBy: v.uploadedBy?.user.name ?? null,
        moments: v.moments.map((m) => ({ ...m, createdBy: m.createdBy?.user.name ?? null })),
      }));
    });
  }

  /**
   * Passo 1 de 2: autorizar e assinar.
   *
   * A linha nasce em `UPLOADING`. Se os bytes nunca chegarem — rede que cai, aba
   * fechada a meio — fica um registo incompleto e visível, que é melhor do que um
   * ficheiro órfão no bucket sem nada que o explique. A UI mostra-o como falhado.
   */
  async startUpload(ctx: RequestContext, prospectId: string, dto: StartUploadDto) {
    if (!can(ctx, "scouting:video:write")) throw new ForbiddenException("Sem permissão para carregar vídeo");

    // A linha nasce dentro da transação; o endereço de carregamento assina-se depois
    // dela fechar — rede dentro de uma transação seca o pool. Ver `playbackUrl`.
    const created = await this.prisma.runAs(ctx.academyId, async (db) => {
      const prospect = await db.prospect.findFirst({ where: { id: prospectId }, select: { id: true } });
      if (!prospect) throw new NotFoundException("Prospecto não encontrado");

      const ext = extensionFor(dto.mimeType);
      const video = await db.prospectVideo.create({
        data: {
          academyId: ctx.academyId,
          prospectId,
          title: dto.title.trim(),
          kind: (dto.kind as VideoKind) ?? "MATCH",
          recordedOn: dto.recordedOn ? new Date(dto.recordedOn) : null,
          competition: dto.competition?.trim() || null,
          opponent: dto.opponent?.trim() || null,
          notes: dto.notes?.trim() || null,
          tags: (dto.tags ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 12),
          observationId: dto.observationId || null,
          mimeType: dto.mimeType,
          sizeBytes: dto.sizeBytes ?? null,
          // O `academyId` no caminho não é segurança — é forense: ao olhar para o
          // bucket, vê-se a que academia pertence cada ficheiro sem consultar nada.
          storageKey: "",
          uploadedById: ctx.membershipId,
          updatedAt: new Date(),
        },
        select: { id: true },
      });

      const storageKey = `${ctx.academyId}/${prospectId}/${video.id}.${ext}`;
      await db.prospectVideo.update({ where: { id: video.id }, data: { storageKey } });

      return { id: video.id, storageKey };
    });

    const upload = await this.signUpload(created.storageKey);
    return { id: created.id, storageKey: created.storageKey, uploadUrl: upload.url, token: upload.token };
  }

  /** Passo 2 de 2: confirmar que os bytes chegaram. */
  async completeUpload(ctx: RequestContext, videoId: string, durationSec?: number) {
    if (!can(ctx, "scouting:video:write")) throw new ForbiddenException("Sem permissão para carregar vídeo");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const video = await db.prospectVideo.findFirst({
        where: { id: videoId },
        select: { id: true, prospectId: true, title: true },
      });
      if (!video) throw new NotFoundException("Vídeo não encontrado");

      await db.prospectVideo.update({
        where: { id: videoId },
        data: { status: "READY", durationSec: durationSec ?? null, updatedAt: new Date() },
      });

      await db.prospectEvent.create({
        data: { prospectId: video.prospectId, kind: "video", to: video.title, actorId: ctx.membershipId },
      });

      return { ok: true };
    });
  }

  /**
   * Um link para ver, válido durante minutos.
   *
   * Curto de propósito: chega para começar a ver e é inútil no dia seguinte. O
   * player pede outro quando este expirar.
   */
  async playbackUrl(ctx: RequestContext, videoId: string) {
    if (!can(ctx, "scouting:video:read")) throw new ForbiddenException("Sem acesso ao vídeo de scouting");

    /*
     * A consulta dentro da transação; a assinatura **fora**.
     *
     * Assinar é uma ida ao Supabase pela rede, e uma transação aberta segura uma das
     * cinco ligações do pool durante todo esse tempo. Era isto que punha o vídeo
     * eternamente "a carregar": bastavam alguns pedidos ao mesmo tempo para o pool
     * secar, e a partir daí **todos** os pedidos falhavam em `P2028 — Unable to
     * start a transaction in the given time`, porque o `AuthGuard` também precisa de
     * uma transação para montar o contexto de cada pedido.
     */
    // `findFirst` com o tenant injectado: um id de outra academia dá 404, e não
    // 403 — 403 confirmaria que o vídeo existe algures.
    const video = await this.prisma.runAs(ctx.academyId, (db) =>
      db.prospectVideo.findFirst({
        where: { id: videoId, status: "READY" },
        select: { storageKey: true },
      }),
    );
    if (!video) throw new NotFoundException("Vídeo não encontrado");

    return { url: await this.signDownload(video.storageKey, 600), expiresIn: 600 };
  }

  async update(ctx: RequestContext, videoId: string, dto: UpdateVideoDto) {
    if (!can(ctx, "scouting:video:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const video = await db.prospectVideo.findFirst({ where: { id: videoId }, select: { id: true } });
      if (!video) throw new NotFoundException("Vídeo não encontrado");

      await db.prospectVideo.update({
        where: { id: videoId },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.kind !== undefined ? { kind: dto.kind as VideoKind } : {}),
          ...(dto.recordedOn !== undefined ? { recordedOn: dto.recordedOn ? new Date(dto.recordedOn) : null } : {}),
          ...(dto.competition !== undefined ? { competition: dto.competition.trim() || null } : {}),
          ...(dto.opponent !== undefined ? { opponent: dto.opponent.trim() || null } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...(dto.tags !== undefined ? { tags: dto.tags.map((t) => t.trim()).filter(Boolean).slice(0, 12) } : {}),
          ...(dto.observationId !== undefined ? { observationId: dto.observationId || null } : {}),
          updatedAt: new Date(),
        },
      });

      return { ok: true };
    });
  }

  /**
   * Apagar a sério.
   *
   * A linha e o objecto, na mesma acção. Um ficheiro órfão com a imagem de um
   * menor é o pior tipo de dívida que este produto pode acumular: ninguém sabe que
   * existe, ninguém o procura, e continua lá.
   *
   * Se o Storage falhar, a linha **não** é apagada — melhor um vídeo que ainda
   * aparece na ficha do que um objecto que ninguém volta a encontrar para apagar.
   */
  async remove(ctx: RequestContext, videoId: string) {
    if (!can(ctx, "scouting:video:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const video = await db.prospectVideo.findFirst({
        where: { id: videoId },
        select: { id: true, storageKey: true, prospectId: true, title: true },
      });
      if (!video) throw new NotFoundException("Vídeo não encontrado");

      await this.deleteObject(video.storageKey);
      await db.prospectVideo.delete({ where: { id: videoId } });

      await db.prospectEvent.create({
        data: {
          prospectId: video.prospectId,
          kind: "video-removed",
          to: video.title,
          actorId: ctx.membershipId,
        },
      });

      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Momentos                                                               */
  /* ---------------------------------------------------------------------- */

  /**
   * Marcar um instante.
   *
   * É a funcionalidade que faz um scout preferir isto a uma pasta partilhada:
   * "00:42 — excelente passe vertical" é o que ele quer mandar ao director, não um
   * ficheiro de noventa minutos com "vê aí para o meio".
   */
  async addMoment(ctx: RequestContext, videoId: string, dto: AddMomentDto) {
    if (!can(ctx, "scouting:video:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      const video = await db.prospectVideo.findFirst({
        where: { id: videoId },
        select: { id: true, durationSec: true },
      });
      if (!video) throw new NotFoundException("Vídeo não encontrado");
      if (video.durationSec && dto.atSec > video.durationSec + 5) {
        throw new BadRequestException("Esse instante está para lá do fim do vídeo");
      }

      const moment = await db.videoMoment.create({
        data: {
          videoId,
          atSec: Math.max(0, Math.round(dto.atSec)),
          kind: (dto.kind as MomentKind) ?? "HIGHLIGHT",
          label: dto.label.trim(),
          createdById: ctx.membershipId,
        },
        select: { id: true },
      });

      return moment;
    });
  }

  async removeMoment(ctx: RequestContext, momentId: string) {
    if (!can(ctx, "scouting:video:write")) throw new ForbiddenException("Sem permissão");

    return this.prisma.runAs(ctx.academyId, async (db) => {
      // A RLS por junção (`VideoMoment → ProspectVideo.academyId`) é o que impede
      // apagar um momento de outra academia com um id adivinhado.
      const moment = await db.videoMoment.findFirst({ where: { id: momentId }, select: { id: true } });
      if (!moment) throw new NotFoundException("Momento não encontrado");
      await db.videoMoment.delete({ where: { id: momentId } });
      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Supabase Storage                                                       */
  /* ---------------------------------------------------------------------- */

  private get url(): string {
    return this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
  }

  private get key(): string {
    return this.config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY");
  }

  private headers(): Record<string, string> {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" };
  }

  /**
   * O bucket, criado à primeira necessidade e **privado**.
   *
   * `public: false` não é um detalhe de configuração: é a diferença entre um link
   * assinado e um endereço que qualquer pessoa abre. Fica em código, e não numa
   * consola onde alguém o possa mudar sem perceber o que muda.
   *
   * ## O que estava avariado aqui, e vale a pena não repetir
   *
   * Este bucket pedia 2 GB de `file_size_limit`. O Supabase tem um **tecto global
   * por projecto** — 50 MB no plano em uso — e um pedido acima dele não devolve um
   * aviso: devolve 400, o bucket **não chega a ser criado**, e cada carregamento
   * falhava com "o armazenamento de vídeo não está disponível". Verdade, e
   * inútil.
   *
   * `StorageService.ensureBucket` tenta o limite desejado e, se o projecto o
   * recusar, cria o bucket **sem limite explícito** — herdando o do projecto — e
   * regista o que aconteceu. Um bucket que aceita 50 MB serve para alguma coisa;
   * um bucket que não existe não serve para nada.
   */
  private async ensureBucket(): Promise<void> {
    if (this.ensured) return;

    await this.storage.ensureBucket({
      name: this.bucket,
      // O que se gostaria de ter. Quem manda é o projecto — ver acima.
      fileSizeLimit: 2_147_483_648,
      allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"],
    });

    this.ensured = true;
  }

  private async signUpload(storageKey: string): Promise<{ url: string; token: string }> {
    await this.ensureBucket();

    const res = await fetch(`${this.url}/storage/v1/object/upload/sign/${this.bucket}/${storageKey}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      this.log.error(`Assinatura de upload falhou: ${res.status} ${await res.text()}`);
      throw new BadRequestException("Não foi possível preparar o carregamento");
    }

    const body = (await res.json()) as { url?: string; token?: string };
    const token = body.token ?? new URLSearchParams((body.url ?? "").split("?")[1]).get("token") ?? "";
    return { url: `${this.url}/storage/v1${body.url ?? ""}`, token };
  }

  private async signDownload(storageKey: string, expiresIn: number): Promise<string> {
    await this.ensureBucket();

    const res = await fetch(`${this.url}/storage/v1/object/sign/${this.bucket}/${storageKey}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ expiresIn }),
    });
    if (!res.ok) {
      this.log.error(`Assinatura de leitura falhou: ${res.status} ${await res.text()}`);
      throw new NotFoundException("Vídeo indisponível");
    }

    const body = (await res.json()) as { signedURL?: string };
    return `${this.url}/storage/v1${body.signedURL ?? ""}`;
  }

  private async deleteObject(storageKey: string): Promise<void> {
    if (!storageKey) return;
    const res = await fetch(`${this.url}/storage/v1/object/${this.bucket}/${storageKey}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    // 404 é aceitável: o objecto pode nunca ter chegado (upload interrompido).
    if (!res.ok && res.status !== 404) {
      this.log.error(`Não foi possível apagar ${storageKey}: ${res.status}`);
      throw new BadRequestException("Não foi possível apagar o ficheiro — a linha fica, para não ficar órfão");
    }
  }
}

/** A extensão certa para o tipo, para o ficheiro no bucket ser reconhecível. */
function extensionFor(mimeType: string): string {
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
  };
  const ext = map[mimeType];
  if (!ext) throw new BadRequestException("Formato de vídeo não suportado");
  return ext;
}
