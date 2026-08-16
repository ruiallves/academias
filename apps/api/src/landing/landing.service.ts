import { Injectable } from "@nestjs/common";
import type { AcademyBranding } from "./landing.template";

/**
 * Só existe esta academia de demonstração enquanto a Prisma não estiver ligada.
 * Trocar por `prisma.academy.findFirst({ where: { slug } })` é a única mudança
 * que este ficheiro precisa quando a base de dados entrar — o controlador e o
 * template não sabem de onde os dados vêm.
 */
const DEMO_ACADEMY: AcademyBranding = {
  slug: "life-club",
  name: "Academia Life Club",
  shortName: "Life Club",
  mark: "LC",
  signalColor: "#0f6b62",
};

@Injectable()
export class LandingService {
  async findBySlug(slug: string): Promise<AcademyBranding | null> {
    return slug === DEMO_ACADEMY.slug ? DEMO_ACADEMY : null;
  }
}
