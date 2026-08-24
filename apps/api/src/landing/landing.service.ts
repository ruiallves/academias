import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import type { AcademyBranding } from "./landing.template";

/**
 * A identidade do clube, para as páginas públicas.
 *
 * ## Isto era uma constante
 *
 * E era um problema por dois motivos. O óbvio: só existia um clube. O menos
 * óbvio, e pior: a cor, o nome e o emblema que o mundo via na página de adesão
 * não eram os que o clube tinha configurado na consola — eram os que estavam
 * escritos aqui. Um clube podia mudar a sua cor e a página pública continuava
 * verde.
 *
 * ## Como se lê sem sessão
 *
 * A landing é pública: quem a abre não tem conta nenhuma, e por isso não há
 * contexto de tenant para a RLS usar. O slug resolve-se pela mesma função
 * estreita que o `AuthService` usa — a que só sabe devolver um id — e só depois
 * se abre o contexto para ler. É a mesma disciplina do webhook de pagamentos,
 * que também chega de fora.
 */
@Injectable()
export class LandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async findBySlug(slug: string): Promise<AcademyBranding | null> {
    const academyId = await this.auth.academyIdBySlug(slug);
    if (!academyId) return null;

    return this.prisma.runAs(academyId, async (db) => {
      const a = await db.academy.findFirst({
        where: { id: academyId },
        select: {
          slug: true,
          name: true,
          shortName: true,
          signalColor: true,
          logoUrl: true,
          membershipHeadline: true,
          membershipIntro: true,
          membershipPoints: true,
        },
      });
      if (!a) return null;

      return {
        slug: a.slug,
        name: a.name,
        shortName: a.shortName,
        // O monograma deriva do nome curto: duas letras é o que cabe no badge, e
        // é o mesmo que a consola e a PWA desenham quando não há logótipo.
        mark: monogram(a.shortName),
        signalColor: a.signalColor,
        logoUrl: a.logoUrl ?? undefined,
        membershipHeadline: a.membershipHeadline ?? undefined,
        membershipIntro: a.membershipIntro ?? undefined,
        membershipPoints: a.membershipPoints,
      };
    });
  }
}

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return letters.toUpperCase();
}
