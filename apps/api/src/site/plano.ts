import type { ScopedClient } from "../prisma/prisma.service";

/** O que se diz a quem chega ao menu Website sem o plano. */
export const SEM_PLANO = "O plano do clube não inclui o site. O site vem com o Connect Pro.";

/**
 * Este clube tem o site?
 *
 * Tem com um plano que o inclua (Connect Pro) e tem durante o período
 * experimental (os 30 dias), para o clube ver como o site ia ficar. As tabelas
 * dos planos estão fechadas ao `academia_app`; a pergunta passa pela função
 * `app.academy_has_website` (migrações `20261013160000_connect_pro` e
 * `20261026120000_site_na_experiencia`), que só devolve o sim ou não. Um clube
 * que desce de plano, ou cuja avaliação acaba sem o Connect Pro, deixa de ter o
 * menu e o site público sem ninguém os ter de desligar.
 */
export async function siteIncluido(db: Pick<ScopedClient, "$queryRaw">, academyId: string): Promise<boolean> {
  const rows = await db.$queryRaw<{ ok: boolean }[]>`SELECT app.academy_has_website(${academyId}) AS ok`;
  return rows[0]?.ok === true;
}

/**
 * O site está cá só por causa do período experimental? A consola usa-o para
 * dizer até quando, e que depois é preciso o Connect Pro.
 */
export async function siteSoNaExperiencia(db: Pick<ScopedClient, "$queryRaw">, academyId: string): Promise<boolean> {
  /*
   * As duas funções vêm da migração `20261026120000_site_na_experiencia`. Se
   * a API sair antes dela, chamá-las dava erro dentro da transação do
   * arranque e partia a consola a toda a gente (já aconteceu com outra
   * migração). `to_regprocedure` nunca dá erro: devolve nulo se não existir.
   */
  const [existe] = await db.$queryRaw<{ ok: boolean }[]>`
    SELECT to_regprocedure('app.academy_in_trial(text)') IS NOT NULL
       AND to_regprocedure('app.academy_website_by_plan(text)') IS NOT NULL AS ok`;
  if (!existe?.ok) return false;
  const rows = await db.$queryRaw<{ plano: boolean; experiencia: boolean }[]>`
    SELECT app.academy_website_by_plan(${academyId}) AS plano, app.academy_in_trial(${academyId}) AS experiencia`;
  return rows[0]?.plano === false && rows[0]?.experiencia === true;
}
