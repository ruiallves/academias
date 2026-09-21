import type { ScopedClient } from "../prisma/prisma.service";
import { ROLE_PERMISSIONS } from "../common/permissions";

export type ResponsavelDoClube = { name: string; email: string; title: string };

/**
 * Quem representa o clube — a primeira pessoa que lá entrou com poderes para o
 * fazer.
 *
 * A regra é a do sistema legal: tem `legal:club` quem o cargo lhe der ou, sem
 * cargo à medida, o papel-base. Entre vários, **o mais antigo** — é quem
 * inaugurou o clube, e é a pessoa que a plataforma conhece como o presidente.
 *
 * É para aqui que vai o contrato, e é para aqui que vão os avisos de pagamento
 * da subscrição. Uma segunda definição de "o responsável" num dos dois caminhos
 * daria um contrato assinado por uma pessoa e uma cobrança mandada a outra.
 */
export async function responsavelDoClube(
  db: ScopedClient,
  academyId: string,
): Promise<ResponsavelDoClube | null> {
  const vinculos = await db.membership.findMany({
    where: { academyId, isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
    orderBy: { createdAt: "asc" },
    select: {
      title: true,
      role: true,
      customRole: { select: { name: true, permissions: true } },
      user: { select: { name: true, email: true } },
    },
  });

  for (const v of vinculos) {
    const perms: string[] = v.customRole?.permissions ?? ROLE_PERMISSIONS[v.role];
    if (!perms.includes("legal:club")) continue;
    if (!v.user.email) continue;
    return {
      name: v.user.name,
      email: v.user.email,
      title: v.customRole?.name ?? v.title ?? "Presidente",
    };
  }
  return null;
}
