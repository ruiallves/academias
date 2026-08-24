import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * O armazenamento de ficheiros — Supabase Storage, por trás de uma porta estreita.
 *
 * ## Porquê um serviço e não `fetch` espalhado
 *
 * Porque há três sítios a precisar do mesmo (vídeos de scouting, fotografias de
 * atletas, fotografias de staff) e uma regra que não pode divergir entre eles:
 * **nada é público**. Um bucket criado com `public: true` num deles seria uma
 * fotografia de uma criança com endereço permanente, e ninguém daria por isso até
 * alguém partilhar o link.
 *
 * ## O limite do projecto, e a lição que custou
 *
 * O Supabase tem um **tecto global por projecto** (50 MB no plano em uso). Pedir um
 * bucket com `file_size_limit` acima desse tecto não devolve um aviso: devolve 400,
 * o bucket **não é criado**, e tudo o que dependia dele falha com "o armazenamento
 * não está disponível" — que é verdade e não ajuda nada.
 *
 * Foi exactamente isso que manteve os carregamentos avariados: o bucket de vídeo
 * pedia 2 GB. Por isso `ensureBucket` tenta o limite desejado e, se o projecto o
 * recusar, **cria o bucket sem limite explícito** — herdando o do projecto — e
 * regista o que aconteceu. Um bucket que aceita ficheiros até 50 MB é infinitamente
 * mais útil do que um bucket que não existe.
 */

export type BucketSpec = {
  name: string;
  /** O limite que se **gostaria** de ter. O projecto tem a última palavra. */
  fileSizeLimit?: number;
  allowedMimeTypes?: string[];
};

@Injectable()
export class StorageService {
  private readonly log = new Logger(StorageService.name);
  private readonly ready = new Map<string, Promise<void>>();

  constructor(private readonly config: ConfigService) {}

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
   * Garante o bucket, uma vez por processo.
   *
   * A promessa fica em cache — e não um booleano — para dois pedidos simultâneos no
   * arranque não criarem o bucket duas vezes e não passarem os dois por um 409.
   */
  async ensureBucket(spec: BucketSpec): Promise<void> {
    const cached = this.ready.get(spec.name);
    if (cached) return cached;

    const work = this.createBucket(spec).catch((error) => {
      // Uma falha não fica em cache: a próxima tentativa volta a tentar, porque o
      // que falhou pode ter sido a rede.
      this.ready.delete(spec.name);
      throw error;
    });

    this.ready.set(spec.name, work);
    return work;
  }

  /**
   * Criar, com duas armadilhas do Supabase pelo meio.
   *
   * **Uma:** um bucket que já existe responde `HTTP 400` — com um corpo a dizer
   * `409` lá dentro. Olhar só para o estado HTTP faz o caso mais normal de todos (a
   * segunda vez que o servidor arranca) parecer uma avaria, e foi o que fez isto
   * falhar depois de já ter funcionado uma vez.
   *
   * **Outra:** um `file_size_limit` acima do tecto do projecto responde `400` com
   * `EntityTooLarge`, e o bucket **não é criado**. Nesse caso cria-se sem limite
   * explícito, herdando o do projecto.
   *
   * Daí ler-se sempre o corpo antes de decidir. O estado HTTP, aqui, não chega.
   */
  private async createBucket(spec: BucketSpec): Promise<void> {
    /*
     * Primeiro perguntar se já existe.
     *
     * Sem isto, cada arranque do servidor tentava criar um bucket que já lá estava —
     * e o Supabase valida o `file_size_limit` **antes** de reparar na duplicação, o
     * que fazia sair um aviso a dizer que o projecto recusou 2 GB. O bucket estava
     * bem; o aviso é que mandava procurar um problema que não existe.
     *
     * Um `GET` é mais barato do que dois `POST` falhados, e cala o ruído.
     */
    const found = await fetch(`${this.url}/storage/v1/bucket/${encodeURIComponent(spec.name)}`, {
      headers: this.headers(),
    }).catch(() => null);
    if (found?.ok) return;

    const attempt = async (withLimit: boolean) => {
      const res = await fetch(`${this.url}/storage/v1/bucket`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          id: spec.name,
          name: spec.name,
          // Nunca público. Ver o cabeçalho deste ficheiro.
          public: false,
          ...(withLimit && spec.fileSizeLimit ? { file_size_limit: spec.fileSizeLimit } : {}),
          ...(spec.allowedMimeTypes ? { allowed_mime_types: spec.allowedMimeTypes } : {}),
        }),
      });
      return { ok: res.ok, status: res.status, detail: res.ok ? "" : await res.text() };
    };

    const exists = (detail: string) => /already exists|BucketAlreadyExists|Duplicate/i.test(detail);
    const tooLarge = (detail: string) => /EntityTooLarge|exceeded the maximum/i.test(detail);

    let res = await attempt(true);
    if (res.ok || exists(res.detail)) return;

    if (spec.fileSizeLimit && tooLarge(res.detail)) {
      this.log.warn(
        `O projecto recusou ${spec.fileSizeLimit} bytes em "${spec.name}" — a criar com o limite do projecto.`,
      );
      res = await attempt(false);
      if (res.ok || exists(res.detail)) return;
    }

    this.log.error(`Não foi possível criar o bucket "${spec.name}": ${res.status} ${res.detail}`);
    throw new BadRequestException("O armazenamento não está disponível");
  }

  /**
   * Um endereço com token para o browser carregar **directamente** para o Supabase.
   *
   * O ficheiro não passa pela nossa API de propósito: um vídeo de scouting são
   * centenas de megabytes, e atravessá-los no processo que serve toda a gente é a
   * forma mais fácil de o pôr de joelhos. O que a API decide é *se pode* — o token
   * assinado vale para uma chave só.
   */
  async signUpload(bucket: string, key: string): Promise<{ url: string; token: string }> {
    const res = await fetch(`${this.url}/storage/v1/object/upload/sign/${bucket}/${key}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({}),
    });

    if (!res.ok) {
      this.log.error(`Assinatura de carregamento falhou (${bucket}/${key}): ${res.status} ${await res.text()}`);
      throw new BadRequestException("Não foi possível preparar o carregamento");
    }

    const body = (await res.json()) as { url?: string; token?: string };
    const token = body.token ?? new URLSearchParams((body.url ?? "").split("?")[1]).get("token") ?? "";
    return { url: `${this.url}/storage/v1${body.url ?? ""}`, token };
  }

  /**
   * Um link de leitura com prazo.
   *
   * Devolve `null` em vez de rebentar: uma fotografia que não abre não pode partir a
   * lista de atletas. O ecrã cai para as iniciais, como se nunca tivesse havido foto.
   */
  async signDownload(bucket: string, key: string, expiresIn: number): Promise<string | null> {
    try {
      const res = await fetch(`${this.url}/storage/v1/object/sign/${bucket}/${key}`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ expiresIn }),
      });
      if (!res.ok) {
        this.log.warn(`Assinatura de leitura falhou (${bucket}/${key}): ${res.status}`);
        return null;
      }
      const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
      const path = body.signedURL ?? body.signedUrl;
      return path ? `${this.url}/storage/v1${path}` : null;
    } catch (error) {
      this.log.warn(`Assinatura de leitura rebentou (${bucket}/${key}): ${error}`);
      return null;
    }
  }

  /**
   * Vários de uma vez.
   *
   * A lista de atletas tem trinta fotografias e cada assinatura é um pedido ao
   * Supabase; em série seriam trinta idas e voltas antes de a página abrir.
   */
  async signMany(bucket: string, keys: string[], expiresIn: number): Promise<Map<string, string>> {
    const unique = [...new Set(keys.filter(Boolean))];
    const signed = await Promise.all(unique.map((k) => this.signDownload(bucket, k, expiresIn)));

    const out = new Map<string, string>();
    unique.forEach((k, i) => {
      const url = signed[i];
      if (url) out.set(k, url);
    });
    return out;
  }

  /** Apagar. Silencioso: um ficheiro que já não existe é o resultado que se queria. */
  async remove(bucket: string, key: string): Promise<void> {
    try {
      await fetch(`${this.url}/storage/v1/object/${bucket}/${key}`, {
        method: "DELETE",
        headers: this.headers(),
      });
    } catch (error) {
      this.log.warn(`Não foi possível apagar ${bucket}/${key}: ${error}`);
    }
  }

  /** Confirma que o ficheiro chegou mesmo. Sem isto, gravava-se a chave de um upload que falhou. */
  async exists(bucket: string, key: string): Promise<boolean> {
    const url = await this.signDownload(bucket, key, 60);
    if (!url) return false;

    try {
      const res = await fetch(url, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }
}
