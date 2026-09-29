import type { Role } from "@prisma/client";
import type { ScopedClient } from "../prisma/prisma.service";
import { ROLE_PERMISSIONS } from "../common/permissions";

export type ResponsavelDoClube = { name: string; email: string; title: string };

/** Um vínculo, com o que basta para decidir se é ele que representa o clube. */
export type VinculoDeStaff = {
  title: string | null;
  role: Role;
  customRole: { name: string; permissions: string[] } | null;
  user: { name: string; email: string | null };
};

/**
 * O que é preciso ler para responder à pergunta. Exportado para os dois
 * chamadores lerem o mesmo — ver `escolherResponsavel`.
 */
export const SELECT_RESPONSAVEL = {
  title: true,
  role: true,
  customRole: { select: { name: true, permissions: true } },
  user: { select: { name: true, email: true } },
} as const;

/**
 * Quem representa o clube — a primeira pessoa que lá entrou com poderes para o
 * fazer.
 *
 * A regra é a do sistema legal: tem `legal:club` quem o cargo lhe der ou, sem
 * cargo à medida, o papel-base. Entre vários, **o mais antigo** — é quem
 * inaugurou o clube, e é a pessoa que a plataforma conhece como o presidente.
 *
 * É para aqui que vai o contrato, para aqui que vão os avisos de pagamento da
 * subscrição, e para aqui que vão as novidades da plataforma. Uma segunda
 * definição de "o responsável" num destes caminhos daria um contrato assinado
 * por uma pessoa e uma cobrança mandada a outra.
 *
 * ## Porque é que a regra está separada da consulta
 *
 * Porque tem dois chamadores com ligações diferentes: o servidor das academias
 * lê dentro de um `runAs` (`ScopedClient`), e o painel da plataforma lê com a
 * ligação sem âmbito, que é um `PrismaClient` — e as duas não têm o mesmo tipo,
 * por muito que a consulta seja a mesma. Podia-se forçar com um `as`, e seria
 * um tipo a mentir sobre qual das ligações está ali.
 *
 * Assim, cada lado faz a sua consulta com o `SELECT_RESPONSAVEL`, e **a regra é
 * uma só** — que é o que este ficheiro existe para garantir. De caminho, fica
 * exercitável sem base de dados nenhuma.
 *
 * Recebe os vínculos **já ordenados** do mais antigo para o mais recente.
 */
export function escolherResponsavel(vinculos: VinculoDeStaff[]): ResponsavelDoClube | null {
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

/** A pergunta, pela ligação do tenant. O painel da plataforma tem a sua. */
export async function responsavelDoClube(
  db: ScopedClient,
  academyId: string,
): Promise<ResponsavelDoClube | null> {
  const vinculos = await db.membership.findMany({
    where: { academyId, isActive: true, role: { notIn: ["GUARDIAN", "ATHLETE"] } },
    orderBy: { createdAt: "asc" },
    select: SELECT_RESPONSAVEL,
  });
  return escolherResponsavel(vinculos);
}
