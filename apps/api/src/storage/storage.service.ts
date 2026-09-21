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
  /**
   * A excepção, e é uma só.
   *
   * Tudo o que este ficheiro guarda é privado — são fotografias de crianças e
   * vídeo de scouting, e o cabeçalho acima explica porquê. O símbolo do clube é
   * a única coisa que **tem** de ser pública, e não por conveniência: vai no
   * `manifest.webmanifest` que o telemóvel de um pai lê **antes** de haver
   * sessão nenhuma, e na página de adesão a sócio, que é aberta ao mundo. Um
   * endereço assinado com validade de seis horas dava um ícone partido no ecrã
   * inicial ao fim da tarde.
   *
   * Tem de ser pedido explicitamente, e o nome do bucket que o usa di-lo.
   */
  public?: boolean;
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
          // Privado por omissão. A única excepção é o símbolo do clube, que tem
          // de ser lido sem sessão — ver `BucketSpec.public`.
          public: spec.public === true,
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
    const emCache = this.assinaturaEmCache(bucket, key, expiresIn);
    if (emCache) return emCache;

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
      if (!path) return null;

      const url = `${this.url}/storage/v1${path}`;
      this.guardarAssinatura(bucket, key, expiresIn, url);
      return url;
    } catch (error) {
      this.log.warn(`Assinatura de leitura rebentou (${bucket}/${key}): ${error}`);
      return null;
    }
  }

  /* ------------------------------------------------------------------------ */
  /* O mesmo ficheiro, o mesmo endereço                                        */
  /* ------------------------------------------------------------------------ */

  /**
   * ## A conta de egress que isto veio pagar
   *
   * O token de um endereço assinado leva lá dentro o instante em que foi
   * emitido. Dois pedidos com mais de um segundo de intervalo devolvem tokens
   * diferentes — portanto **endereços diferentes para o mesmo ficheiro**. Para
   * o browser são recursos novos, e a cache dele nunca acerta: cada abertura da
   * lista de atletas voltava a descarregar as 108 fotografias do princípio.
   *
   * Em números reais deste produto: 57 MB por abertura da lista de atletas, 23
   * MB pela de sócios, 22 MB pela de staff. Uma recarga de página custava o
   * mesmo outra vez. Com o refrescamento automático da app dos pais, de minuto
   * a minuto, a mesma fotografia saía do Supabase sessenta vezes por hora.
   *
   * ## O que a cache faz
   *
   * Guarda o endereço já assinado e devolve **o mesmo** enquanto ele for válido
   * com folga. Não é uma cache de bytes: são umas centenas de strings, e o que
   * ela poupa são gigabytes.
   *
   * Funciona porque o Supabase serve a descarga assinada com um `Expires` igual
   * ao prazo do próprio endereço (medido: sem `cache-control`, com `Expires`).
   * Com o endereço a repetir-se, esse `Expires` passa a valer alguma coisa e o
   * browser guarda a imagem até ao fim do prazo. Com um endereço novo de cada
   * vez, não valia nada — e revalidar também não salva: um `If-None-Match`
   * devolve 200 e os bytes todos, não 304.
   *
   * ## Porquê a margem
   *
   * Devolve-se o endereço guardado só enquanto faltar mais do que `MARGEM` para
   * expirar. Sem isso, o último pedido antes do prazo recebia um endereço com
   * dois segundos de vida e a fotografia partia-se no ecrã de quem o recebeu.
   * Cinco minutos chegam para qualquer página acabar de carregar.
   *
   * ## Porquê um tecto
   *
   * Porque isto vive na memória do processo e um clube com muitos ficheiros
   * encheria-a sem limite. Ao chegar ao tecto deita-se fora a metade mais
   * antiga: as entradas são baratas de refazer, e o que interessa é o que anda
   * a ser pedido agora.
   */
  private readonly assinaturas = new Map<string, { url: string; validoAte: number }>();

  /** Cinco minutos de folga antes do prazo. */
  private static readonly MARGEM_MS = 5 * 60 * 1000;

  /** Umas centenas de strings. Muito acima do que qualquer clube usa de uma vez. */
  private static readonly TECTO = 2000;

  private assinaturaEmCache(bucket: string, key: string, expiresIn: number): string | null {
    const guardada = this.assinaturas.get(`${bucket}|${key}|${expiresIn}`);
    if (!guardada) return null;
    if (guardada.validoAte <= Date.now()) {
      this.assinaturas.delete(`${bucket}|${key}|${expiresIn}`);
      return null;
    }
    return guardada.url;
  }

  private guardarAssinatura(bucket: string, key: string, expiresIn: number, url: string): void {
    /*
     * Um prazo curto não sobrevive à margem — o `signDownload(…, 60)` do
     * `publicUrlFor`, ou os 120 segundos de um vídeo. Nesses casos não se
     * guarda: são poucos, e um endereço quase expirado é pior do que assinar
     * outra vez.
     */
    const vida = expiresIn * 1000 - StorageService.MARGEM_MS;
    if (vida <= 0) return;

    if (this.assinaturas.size >= StorageService.TECTO) {
      const metade = Math.floor(StorageService.TECTO / 2);
      for (const k of [...this.assinaturas.keys()].slice(0, metade)) this.assinaturas.delete(k);
    }

    this.assinaturas.set(`${bucket}|${key}|${expiresIn}`, { url, validoAte: Date.now() + vida });
  }

  /**
   * Esquecer o endereço de um ficheiro.
   *
   * Chama-se quando o ficheiro **muda de conteúdo na mesma chave** — hoje isso
   * não acontece (cada carregamento gera uma chave nova, ver `photos.service`),
   * mas apagar sem esquecer deixaria um endereço a apontar para o que já não
   * existe até ao fim do prazo.
   */
  forgetSigned(bucket: string, key: string): void {
    const prefixo = `${bucket}|${key}|`;
    for (const k of this.assinaturas.keys()) {
      if (k.startsWith(prefixo)) this.assinaturas.delete(k);
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

  /**
   * Apagar. Silencioso quanto ao 404: um ficheiro que já não existe é o
   * resultado que se queria.
   *
   * ## Sem `Content-Type` — a lição
   *
   * Isto mandava os cabeçalhos de sempre, com `Content-Type: application/json`
   * e corpo nenhum — e o Supabase (Fastify) responde 400 *"Body cannot be
   * empty when content-type is set to application/json"*. Como o estado não
   * era lido e o `catch` só apanhava falhas de rede, **nenhuma fotografia foi
   * alguma vez apagada do bucket**: trocar a foto de um atleta deixava a
   * anterior lá para sempre, sem uma linha de log. Descoberto pelo teste das
   * fotografias de sócio, que confirma que a anterior desaparece.
   */
  async remove(bucket: string, key: string): Promise<void> {
    /* O endereço guardado deixa de valer no instante em que o ficheiro sai. */
    this.forgetSigned(bucket, key);
    try {
      const { "Content-Type": _json, ...headers } = this.headers();
      const res = await fetch(`${this.url}/storage/v1/object/${bucket}/${key}`, { method: "DELETE", headers });
      if (!res.ok && res.status !== 404) {
        this.log.warn(`Não foi possível apagar ${bucket}/${key}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
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
