import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { StorageService } from "../storage/storage.service";

/**
 * O armazenamento da Academias AI.
 *
 * O mesmo desenho do vídeo de scouting, pela mesma razão — imagem de menores:
 *
 *  1. **Bucket privado.** Nunca há URLs permanentes; cada leitura assina um
 *     link curto que caduca sozinho.
 *  2. **Os bytes não passam pelo NestJS.** O servidor autoriza e assina; o
 *     browser carrega directo para o Storage, e o worker descarrega directo
 *     de lá. Noventa minutos de vídeo a atravessar o processo da API era o
 *     caminho mais curto para o derrubar.
 *  3. **Apagar é apagar tudo.** Uma análise apagada leva o vídeo, os tracks,
 *     os clips e os embeddings — `deletePrefix` varre a pasta inteira, porque
 *     um ficheiro órfão com imagem de crianças é dívida que ninguém encontra.
 *
 * Chaves: `{academyId}/{analysisId}/{videoId}.{ext}` para o vídeo de origem,
 * `{academyId}/{analysisId}/derived/…` para o que o worker produz (tracks,
 * clips, heatmaps, embeddings).
 */
@Injectable()
export class AiVideoService {
  private readonly log = new Logger(AiVideoService.name);
  readonly bucket = "ai-videos";
  private ensured = false;

  constructor(
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  /**
   * O bucket, criado à primeira necessidade e **privado**. O tecto pedido é o
   * desejado; quem manda é o projecto — o `StorageService` cai para o limite do
   * projecto se este recusar. Sem lista de MIME: além do vídeo, o worker guarda
   * aqui JSON de tracks, clips e imagens derivadas.
   */
  private async ensureBucket(): Promise<void> {
    if (this.ensured) return;
    await this.storage.ensureBucket({ name: this.bucket, fileSizeLimit: 4_294_967_296 });
    this.ensured = true;
  }

  async signUpload(storageKey: string): Promise<{ url: string; token: string }> {
    await this.ensureBucket();
    return this.storage.signUpload(this.bucket, storageKey);
  }

  async signDownload(storageKey: string, expiresIn: number): Promise<string> {
    await this.ensureBucket();
    const url = await this.storage.signDownload(this.bucket, storageKey, expiresIn);
    if (!url) throw new NotFoundException("Ficheiro indisponível");
    return url;
  }

  async exists(storageKey: string): Promise<boolean> {
    await this.ensureBucket();
    return this.storage.exists(this.bucket, storageKey);
  }

  /**
   * Apaga tudo debaixo de um prefixo — a pasta de uma análise inteira.
   *
   * O Storage não tem "apagar pasta": lista-se e apaga-se em lotes, descendo às
   * subpastas, até a listagem vir vazia. Se algo falhar, o erro sobe e a linha
   * da análise **não** é apagada — melhor uma análise que ainda aparece do que
   * ficheiros de menores que ninguém volta a encontrar para apagar.
   */
  async deletePrefix(prefix: string): Promise<void> {
    await this.ensureBucket();

    const base = this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
    const key = this.config.getOrThrow<string>("SUPABASE_SERVICE_ROLE_KEY");
    const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

    // Tecto de voltas por segurança: 50 × 100 ficheiros chega para qualquer
    // análise real, e um ciclo infinito contra o Storage seria pior.
    for (let volta = 0; volta < 50; volta++) {
      const res = await fetch(`${base}/storage/v1/object/list/${this.bucket}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prefix, limit: 100, offset: 0 }),
      });
      if (!res.ok) {
        this.log.error(`Listagem de ${prefix} falhou: ${res.status}`);
        throw new BadRequestException("Não foi possível listar os ficheiros da análise");
      }

      const items = (await res.json()) as { name: string; id?: string }[];
      if (items.length === 0) return;

      // A listagem devolve também "subpastas" (entradas sem id): desce-se a elas
      // primeiro; as pastas desaparecem sozinhas quando ficam vazias.
      const files = items.filter((i) => i.id).map((i) => `${prefix}/${i.name}`);
      for (const folder of items.filter((i) => !i.id)) {
        await this.deletePrefix(`${prefix}/${folder.name}`);
      }
      if (files.length === 0) return;

      const del = await fetch(`${base}/storage/v1/object/${this.bucket}`, {
        method: "DELETE",
        headers,
        body: JSON.stringify({ prefixes: files }),
      });
      if (!del.ok) {
        this.log.error(`Apagar lote de ${prefix} falhou: ${del.status}`);
        throw new BadRequestException("Não foi possível apagar os ficheiros da análise");
      }
    }
  }
}

/** A extensão certa para o tipo, para o ficheiro no bucket ser reconhecível. */
export function videoExtensionFor(mimeType: string): string {
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
