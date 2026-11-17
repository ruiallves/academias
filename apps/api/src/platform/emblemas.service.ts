import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PlatformPrisma } from "./platform.prisma";
import { StorageService } from "../storage/storage.service";
import { EMBLEMAS_BUCKET, urlsDoEmblema } from "../clubes/emblemas";
import { nomeNormalizado } from "../clubes/diretorio.service";

/**
 * Os emblemas que os clubes carregaram para os adversários, vistos do painel.
 *
 * O clube carregou e ficou logo a valer para ele; aqui faz-se o "double
 * check" sem o clube saber. Aprovar passa o emblema ao diretório
 * (`KnownClub`), para toda a gente: copia-se a imagem para
 * `<clube>/<versao>/` (a versão sobe, o endereço muda) e, se o adversário
 * foi escrito à mão, cria-se o clube no diretório com esse nome e ligam-se os
 * jogos desse clube que o têm. Rejeitar deixa de o mostrar, e mais nada.
 */
@Injectable()
export class EmblemasPropostosService {
  private readonly log = new Logger(EmblemasPropostosService.name);

  constructor(
    private readonly prisma: PlatformPrisma,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
  ) {}

  private base(): string {
    return this.config.getOrThrow<string>("SUPABASE_URL").replace(/\/$/, "");
  }

  /** Por rever primeiro, depois as últimas tratadas. */
  async listar() {
    const base = this.base();
    const linhas = await this.prisma.clubLogoProposal.findMany({
      where: { logoKey: { not: null } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      take: 300,
      select: {
        id: true, clubName: true, status: true, logoKey: true, byName: true, createdAt: true, reviewedAt: true, reviewedBy: true, reviewNote: true,
        academy: { select: { id: true, name: true, slug: true } },
        knownClub: { select: { id: true, name: true, association: true, logoKey: true } },
      },
    });
    return linhas.map((p) => ({
      id: p.id,
      clube: p.clubName,
      estado: p.status,
      emblema: urlsDoEmblema(base, p.logoKey as string),
      quem: p.byName,
      em: p.createdAt.toISOString(),
      academia: p.academy,
      noDiretorio: p.knownClub ? { id: p.knownClub.id, nome: p.knownClub.name, associacao: p.knownClub.association, emblema: p.knownClub.logoKey ? urlsDoEmblema(base, p.knownClub.logoKey) : null } : null,
      revisto: p.reviewedAt ? { em: p.reviewedAt.toISOString(), por: p.reviewedBy, nota: p.reviewNote } : null,
    }));
  }

  async aprovar(admin: { name: string }, id: string) {
    const p = await this.prisma.clubLogoProposal.findUnique({ where: { id }, select: { id: true, academyId: true, knownClubId: true, clubName: true, normalizedName: true, logoKey: true, status: true } });
    if (!p || !p.logoKey) throw new NotFoundException("Proposta não encontrada");
    if (p.status === "APPROVED") throw new BadRequestException("Já está aprovada");

    const [w256, w64] = await Promise.all([this.storage.download(EMBLEMAS_BUCKET, `${p.logoKey}/256.webp`), this.storage.download(EMBLEMAS_BUCKET, `${p.logoKey}/64.webp`)]);
    if (!w256 || !w64) throw new BadRequestException("A imagem da proposta já não está no bucket");

    // O clube do diretório: o escolhido, ou um novo com o nome escrito à mão.
    let clube = p.knownClubId ? await this.prisma.knownClub.findUnique({ where: { id: p.knownClubId }, select: { id: true, logoVersion: true } }) : null;
    if (!clube) {
      clube = await this.prisma.knownClub.create({
        data: { name: p.clubName, normalizedName: nomeNormalizado(p.clubName), sports: [], fetchedAt: new Date() },
        select: { id: true, logoVersion: true },
      });
    }
    const versao = clube.logoVersion + 1;
    const logoKey = `${clube.id}/${versao}`;
    const cache = { cacheControl: "max-age=31536000" };
    await this.storage.upload(EMBLEMAS_BUCKET, `${logoKey}/256.webp`, w256, "image/webp", cache);
    await this.storage.upload(EMBLEMAS_BUCKET, `${logoKey}/64.webp`, w64, "image/webp", cache);

    await this.prisma.$transaction([
      this.prisma.knownClub.update({ where: { id: clube.id }, data: { logoKey, logoVersion: versao, logoHash: null, sourceLogoUrl: `proposta:${p.id}` } }),
      this.prisma.clubLogoProposal.update({ where: { id }, data: { status: "APPROVED", knownClubId: clube.id, reviewedAt: new Date(), reviewedBy: admin.name, reviewNote: null } }),
      // Os jogos do clube que o escreveu à mão passam a apontar para o clube do diretório.
      this.prisma.match.updateMany({ where: { academyId: p.academyId, opponentClubId: null, opponent: { equals: p.clubName, mode: "insensitive" } }, data: { opponentClubId: clube.id } }),
    ]);
    this.log.log(`Emblema aprovado: ${p.clubName} → ${clube.id} v${versao} (por ${admin.name})`);
    return { ok: true as const, knownClubId: clube.id };
  }

  async rejeitar(admin: { name: string }, id: string, nota?: string) {
    const p = await this.prisma.clubLogoProposal.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!p) throw new NotFoundException("Proposta não encontrada");
    await this.prisma.clubLogoProposal.update({ where: { id }, data: { status: "REJECTED", reviewedAt: new Date(), reviewedBy: admin.name, reviewNote: nota?.trim() || null } });
    return { ok: true as const };
  }
}
