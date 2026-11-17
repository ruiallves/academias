import { randomBytes } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import sharp from "sharp";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";
import { can, type RequestContext } from "../common/permissions";
import { EMBLEMAS_BUCKET, urlsDoEmblema, type Emblema } from "./emblemas";

/**
 * O diretório dos clubes federados de Portugal, com o emblema (`KnownClub`).
 *
 * É uma lista da plataforma, a mesma para todos os clubes, carregada pelo
 * importador (`scripts/emblemas-importar.mjs`) a partir dos diretórios da FPF
 * e da FPB. Quem está com sessão num clube procura um nome e recebe os clubes
 * que batem, com o emblema em dois tamanhos.
 *
 * ## Os emblemas que os clubes carregam
 *
 * Um adversário sem emblema no diretório (ou fora dele) pode levar o emblema
 * que o clube carregar: para esse clube vale logo, nos jogos com esse
 * adversário; para a plataforma fica como proposta (`ClubLogoProposal`), que
 * o painel aprova para o diretório ou rejeita. O clube não é avisado de
 * nenhuma das duas: carregou, ficou, está feito.
 *
 * ## Os endereços dos emblemas
 *
 * Saem já montados (`.../emblemas/<id>/<versao>/64.webp`): públicos, fixos e
 * com cache de um ano no Supabase. O browser pede cada um uma vez; uma lista
 * de jogos com vinte adversários custa uns 60 KB a primeira vez e nada
 * depois. Nunca se assina: um endereço assinado novo a cada pedido era o que
 * fazia o egress disparar (ver `StorageService`).
 */

/** Sem acentos, minúsculas, sem pontuação: a mesma regra do importador. */
export function nomeNormalizado(s: string): string {
  const tokens = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const letra = (t: string) => /^[a-z]\.?$/.test(t);
    if (letra(tokens[i])) {
      let j = i;
      while (j < tokens.length && letra(tokens[j])) j++;
      if (j - i >= 2) {
        out.push(tokens.slice(i, j).map((t) => t[0]).join(""));
        i = j - 1;
        continue;
      }
    }
    out.push(tokens[i].replace(/\./g, ""));
  }
  return out.filter(Boolean).join(" ");
}

/**
 * As siglas como os clubes as escrevem no adversário de um jogo, e o que a
 * federação escreve por extenso. "Vitória SC" tem de encontrar "Vitória Sport
 * Clube", "CD Trofense" o "Clube Desportivo Trofense". Cada sigla vira uma
 * lista de alternativas, e basta uma bater.
 */
export const SIGLAS: Record<string, string[]> = {
  sc: ["sport clube", "sporting clube", "sport club", "sporting club", "sc"],
  fc: ["futebol clube", "football club", "fc"],
  cf: ["clube de futebol", "clube futebol", "cf"],
  cd: ["clube desportivo", "centro desportivo", "cd"],
  cdr: ["clube desportivo e recreativo", "clube desportivo recreativo", "cdr"],
  gd: ["grupo desportivo", "gd"],
  gdr: ["grupo desportivo e recreativo", "grupo desportivo recreativo", "gdr"],
  ad: ["associacao desportiva", "atletico desportivo", "ad"],
  ac: ["atletico clube", "associacao cultural", "ac"],
  ar: ["associacao recreativa", "ar"],
  ud: ["uniao desportiva", "ud"],
  uf: ["uniao futebol", "uniao de futebol", "uf"],
  cr: ["clube recreativo", "centro recreativo", "cr"],
  cb: ["clube de basquetebol", "clube basquetebol", "cb"],
  ccd: ["centro cultural e desportivo", "centro cultural desportivo", "ccd"],
  acd: ["associacao cultural e desportiva", "associacao cultural desportiva", "acd"],
  acr: ["associacao cultural e recreativa", "associacao cultural recreativa", "acr"],
  adr: ["associacao desportiva e recreativa", "associacao desportiva recreativa", "adr"],
  afc: ["associacao futebol clube", "atletico futebol clube", "afc"],
  scp: ["sporting clube de portugal", "sporting"],
  slb: ["sport lisboa e benfica", "benfica"],
  fcp: ["futebol clube do porto", "fc porto"],
};

/** Palavras que não ajudam a encontrar o clube: "de", "do", e o sufixo da equipa ("B", "Sub-15"). */
const SEM_PESO = new Set(["de", "do", "da", "dos", "das", "e", "o", "a", "os", "as", "b", "c", "d", "sad"]);

/** As palavras que contam, cada uma com as suas alternativas. */
export function termosDeProcura(q: string): string[][] {
  return nomeNormalizado(q)
    .split(" ")
    .filter((p) => p && !SEM_PESO.has(p) && !/^(sub|s)\d+$/.test(p))
    .slice(0, 6)
    .map((p) => SIGLAS[p] ?? [p]);
}

export type ClubeConhecido = {
  id: string;
  nome: string;
  nomeCurto: string | null;
  associacao: string | null;
  regiao: string | null;
  localidade: string | null;
  /** football, futsal, beach_football, basketball. Vazio num clube da FPF sem provas nacionais (é futebol ou futsal). */
  modalidades: string[];
  federacoes: ("FPF" | "FPB")[];
  emblema: Emblema | null;
  /** O emblema é o que este clube carregou (e não o do diretório). */
  emblemaProposto: boolean;
};

/** O emblema carregado tem de ser pequeno: é um símbolo, não uma fotografia. */
const MAX_BYTES = 2 * 1024 * 1024;
const TIPOS = ["image/png", "image/webp", "image/jpeg"];

@Injectable()
export class DiretorioDeClubesService {
  private readonly log = new Logger(DiretorioDeClubesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  private base(): string {
    return this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
  }

  /**
   * Procurar pelo nome. Todas as palavras escritas têm de aparecer, por
   * qualquer ordem e sem acentos ("braga sc" encontra "Sporting Clube de
   * Braga"). Com `modalidade`, só os clubes dessa modalidade; os da FPF sem
   * modalidade conhecida contam para futebol e futsal, porque são de uma das
   * duas. Um clube sem emblema no diretório traz o que este clube lhe
   * carregou, se houver.
   */
  async procurar(ctx: RequestContext, q: string, modalidade?: string, limite = 20): Promise<ClubeConhecido[]> {
    const termos = termosDeProcura(q);
    if (termos.length === 0) return [];
    const base = this.base();
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const daFpf = modalidade === "football" || modalidade === "futsal";
      const linhas = await db.knownClub.findMany({
        where: {
          AND: [
            ...termos.map((alternativas) => ({ OR: alternativas.map((p) => ({ normalizedName: { contains: p } })) })),
            ...(modalidade ? [{ OR: [{ sports: { has: modalidade } }, ...(daFpf ? [{ AND: [{ fpfId: { not: null } }, { sports: { isEmpty: true } }] }] : [])] }] : []),
          ],
        },
        // Com emblema primeiro, depois os nomes mais curtos (a palavra escrita pesa mais num nome pequeno).
        orderBy: [{ logoKey: { sort: "desc", nulls: "last" } }, { name: "asc" }],
        take: Math.min(Math.max(limite, 1), 50),
      });
      const semEmblema = linhas.filter((c) => !c.logoKey).map((c) => c.id);
      const propostas = semEmblema.length
        ? await db.clubLogoProposal.findMany({ where: { knownClubId: { in: semEmblema }, status: { not: "REJECTED" }, logoKey: { not: null } }, orderBy: { createdAt: "desc" }, select: { knownClubId: true, logoKey: true } })
        : [];
      const proposto = new Map<string, string>();
      for (const p of propostas) if (p.knownClubId && !proposto.has(p.knownClubId)) proposto.set(p.knownClubId, p.logoKey as string);

      return linhas.map((c) => {
        const key = c.logoKey ?? proposto.get(c.id) ?? null;
        return {
          id: c.id,
          nome: c.name,
          nomeCurto: c.shortName,
          associacao: c.association,
          regiao: c.region,
          localidade: c.locality,
          modalidades: c.sports,
          federacoes: [...(c.fpfId !== null ? ["FPF" as const] : []), ...(c.fpbId !== null ? ["FPB" as const] : [])],
          emblema: key ? urlsDoEmblema(base, key) : null,
          emblemaProposto: !c.logoKey && !!key,
        };
      });
    });
  }

  /** Um clube do diretório pelo id, para a ficha de um jogo que já o tem escolhido. */
  async porId(ctx: RequestContext, id: string): Promise<ClubeConhecido> {
    const base = this.base();
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const c = await db.knownClub.findUnique({ where: { id } });
      if (!c) throw new NotFoundException("Clube não encontrado no diretório");
      let key = c.logoKey;
      if (!key) {
        const p = await db.clubLogoProposal.findFirst({ where: { knownClubId: id, status: { not: "REJECTED" }, logoKey: { not: null } }, orderBy: { createdAt: "desc" }, select: { logoKey: true } });
        key = p?.logoKey ?? null;
      }
      return {
        id: c.id,
        nome: c.name,
        nomeCurto: c.shortName,
        associacao: c.association,
        regiao: c.region,
        localidade: c.locality,
        modalidades: c.sports,
        federacoes: [...(c.fpfId !== null ? ["FPF" as const] : []), ...(c.fpbId !== null ? ["FPB" as const] : [])],
        emblema: key ? urlsDoEmblema(base, key) : null,
        emblemaProposto: !c.logoKey && !!key,
      };
    });
  }

  /**
   * O emblema que este clube já carregou para um adversário escrito à mão
   * (sem clube do diretório), para o campo do adversário o mostrar ao abrir.
   */
  async emblemaDoNome(ctx: RequestContext, nome: string): Promise<Emblema | null> {
    const n = nomeNormalizado(nome);
    if (!n) return null;
    const base = this.base();
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.clubLogoProposal.findFirst({ where: { normalizedName: n, status: { not: "REJECTED" }, logoKey: { not: null } }, orderBy: { createdAt: "desc" }, select: { logoKey: true } });
      return p?.logoKey ? urlsDoEmblema(base, p.logoKey) : null;
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Carregar um emblema                                                        */
  /* ------------------------------------------------------------------------ */

  private podeCarregar(ctx: RequestContext) {
    // Quem marca jogos é quem escreve adversários.
    if (!can(ctx, "calendar:write")) throw new ForbiddenException("Sem permissão para carregar emblemas");
  }

  /**
   * Passo 1: a autorização para carregar, direto para o Supabase (o ficheiro
   * não passa pela API, como as fotografias). A proposta nasce já, sem
   * `logoKey`: só o passo 2 a torna visível.
   */
  async pedirCarregamento(ctx: RequestContext, dto: { contentType: string; clubName: string; knownClubId?: string | null }) {
    this.podeCarregar(ctx);
    if (!TIPOS.includes(dto.contentType)) throw new BadRequestException("O emblema tem de ser PNG, WebP ou JPEG");
    const nome = dto.clubName.trim();
    if (nome.length < 2) throw new BadRequestException("Escreve o nome do adversário primeiro");

    await this.storage.ensureBucket({ name: EMBLEMAS_BUCKET, fileSizeLimit: MAX_BYTES, allowedMimeTypes: ["image/webp", "image/png", "image/jpeg", "image/gif"], public: true });

    return this.prisma.runAs(ctx.academyId, async (db) => {
      if (dto.knownClubId) {
        const clube = await db.knownClub.findUnique({ where: { id: dto.knownClubId }, select: { id: true } });
        if (!clube) throw new NotFoundException("Clube não encontrado no diretório");
      }
      const quem = await db.user.findFirst({ where: { id: ctx.userId }, select: { name: true } });
      const proposta = await db.clubLogoProposal.create({
        data: { academyId: ctx.academyId, knownClubId: dto.knownClubId ?? null, clubName: nome, normalizedName: nomeNormalizado(nome), byUserId: ctx.userId, byName: quem?.name ?? null },
        select: { id: true },
      });
      const ext = dto.contentType === "image/png" ? "png" : dto.contentType === "image/webp" ? "webp" : "jpg";
      const key = `propostas/${ctx.academyId}/${proposta.id}/original-${randomBytes(4).toString("hex")}.${ext}`;
      const { url, token } = await this.storage.signUpload(EMBLEMAS_BUCKET, key);
      return { id: proposta.id, url, token, key, maxBytes: MAX_BYTES };
    });
  }

  /**
   * Passo 2: o ficheiro chegou. Lê-se do bucket, trata-se em 256 e 64 px
   * (WebP, sem ampliar) com cache de um ano, e a proposta fica a valer para
   * este clube. A plataforma vê-a no painel.
   */
  async confirmarCarregamento(ctx: RequestContext, id: string, key: string): Promise<{ emblema: Emblema }> {
    this.podeCarregar(ctx);
    const prefixo = `propostas/${ctx.academyId}/${id}/`;
    if (!key.startsWith(prefixo)) throw new ForbiddenException("Chave inválida");

    const original = await this.storage.download(EMBLEMAS_BUCKET, key);
    if (!original) throw new BadRequestException("O ficheiro não chegou. Tenta outra vez.");
    if (original.length > MAX_BYTES) throw new BadRequestException("O emblema tem de ter menos de 2 MB");

    let w256: Buffer;
    let w64: Buffer;
    try {
      const base = sharp(original, { animated: false }).rotate();
      w256 = await base.clone().resize(256, 256, { fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer();
      w64 = await base.clone().resize(64, 64, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
    } catch (e) {
      this.log.warn(`Emblema inválido (${key}): ${e}`);
      throw new BadRequestException("Não foi possível ler a imagem. Tenta um PNG ou JPEG.");
    }
    const logoKey = `propostas/${ctx.academyId}/${id}`;
    const cache = { cacheControl: "max-age=31536000" };
    await this.storage.upload(EMBLEMAS_BUCKET, `${logoKey}/256.webp`, w256, "image/webp", cache);
    await this.storage.upload(EMBLEMAS_BUCKET, `${logoKey}/64.webp`, w64, "image/webp", cache);

    const base = this.base();
    return this.prisma.runAs(ctx.academyId, async (db) => {
      const p = await db.clubLogoProposal.findFirst({ where: { id }, select: { id: true } });
      if (!p) throw new NotFoundException("Proposta não encontrada");
      await db.clubLogoProposal.update({ where: { id }, data: { logoKey, status: "PENDING" } });
      return { emblema: urlsDoEmblema(base, logoKey) };
    });
  }
}
