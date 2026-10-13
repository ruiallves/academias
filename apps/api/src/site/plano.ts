import type { ScopedClient } from "../prisma/prisma.service";

/** O que se diz a quem chega ao menu Website sem o plano. */
export const SEM_PLANO = "O plano do clube não inclui o site. O site vem com o Connect Pro.";

/**
 * Este clube tem o site no plano (Connect Pro)?
 *
 * As tabelas dos planos estão fechadas ao `academia_app`; a pergunta passa
 * pela função `app.academy_has_website` (migração `20261013160000_connect_pro`),
 * que só devolve o sim ou não. Um clube que desce de plano deixa de ter o menu
 * e o site público sem ninguém os ter de desligar.
 */
export async function siteIncluido(db: Pick<ScopedClient, "$queryRaw">, academyId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: boolean }[]>`SELECT app.academy_has_website(${academyId}) AS ok`;
  return rows[0]?.ok === true;
}
