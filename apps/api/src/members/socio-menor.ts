import type { Prisma } from "@prisma/client";
import type { ScopedClient } from "../prisma/prisma.service";

/**
 * Sócios menores e sócios-atletas: quem paga as quotas.
 *
 * Uma **categoria de menores** é uma categoria com idade máxima até 18 anos
 * (decisão do Rui, 17/10/2026: "preencher a idade máxima = 18 indica que é
 * categoria de sócio menor"). Não há marca à parte: é a idade máxima que diz.
 *
 * Uma ficha de sócio **ligada a um atleta** (`Member.athleteId`) numa categoria
 * de menores é **paga pela família**:
 *
 *   - as quotas aparecem aos encarregados desse atleta, na área da família, em
 *     Pagamentos, junto das mensalidades (`GET /api/billing/quotas`);
 *   - a ficha nunca se liga a uma conta (`Member.userId`), e se estiver ligada
 *     é como se não estivesse;
 *   - **o atleta vê a área de sócio na app** pela conta de atleta, por
 *     `Member.athleteId` (ver `fichaDeSocioDaConta`): o cartão, os jogos, as
 *     novidades e as sondagens, **sem o separador das quotas** e sem botão de
 *     pagar (decisão do Rui, 17/10/2026: "quero que um atleta que seja sócio
 *     consiga ver a app; o que não quero é que tenha acesso às quotas", porque
 *     quem paga é o pai);
 *   - os avisos de quota nova vão para os encarregados.
 *
 * Um atleta adulto convertido em sócio, ou numa categoria sem limite de idade,
 * é um sócio como os outros e paga ele.
 *
 * Por decidir (ver a memória `academia-socio-atleta`): o menor que **não** é
 * atleta, com um encarregado sem a app.
 */

/** Até esta idade máxima, inclusive, a categoria é de menores. */
export const IDADE_MAXIMA_DE_MENORES = 18;

export function categoriaDeMenores(tier: { maxAge: number | null } | null | undefined): boolean {
  return tier?.maxAge != null && tier.maxAge <= IDADE_MAXIMA_DE_MENORES;
}

export function pagoPelaFamilia(member: { athleteId: string | null; tier: { maxAge: number | null } | null }): boolean {
  return !!member.athleteId && categoriaDeMenores(member.tier);
}

/** O mesmo, numa consulta: as fichas pagas pela família. */
export const FICHAS_PAGAS_PELA_FAMILIA: Prisma.MemberWhereInput = {
  athleteId: { not: null },
  tier: { maxAge: { lte: IDADE_MAXIMA_DE_MENORES } },
};

/** E o contrário: as fichas que se pagam a si mesmas (e por isso se podem ligar a uma conta). */
export const FICHAS_PAGAS_PELO_SOCIO: Prisma.MemberWhereInput = { NOT: FICHAS_PAGAS_PELA_FAMILIA };

/**
 * A ficha de sócio que esta conta vê na app, e quem lhe paga as quotas.
 *
 * Por ordem:
 *  1. a ficha ligada à conta (`Member.userId`) que se paga a si mesma: um sócio
 *     como os outros, com o separador das quotas;
 *  2. senão, a ficha de sócio-atleta menor **do atleta desta conta** (a conta
 *     de atleta é `Athlete.account`, e a ficha aponta para o atleta por
 *     `Member.athleteId`): o atleta vê a área de sócio, e `pagoPelaFamilia`
 *     diz à app para não mostrar quotas nem pagar.
 *
 * Usada em `contexts` (para a área aparecer) e em `socioDe` (para cada rota da
 * área de sócio): a mesma regra nos dois lados, senão a área aparecia e
 * depois as rotas respondiam 404.
 */
export async function fichaDeSocioDaConta(db: ScopedClient, userId: string) {
  const propria = await db.member.findFirst({ where: { userId, ...FICHAS_PAGAS_PELO_SOCIO } });
  if (propria) return { ...propria, pagoPelaFamilia: false };

  const atleta = await db.athlete.findFirst({
    where: { account: { userId, isActive: true } },
    select: { id: true },
  });
  if (!atleta) return null;

  /*
   * `AND`, e não `{ athleteId: atleta.id, ...FICHAS_PAGAS_PELA_FAMILIA }`: o
   * filtro também tem a chave `athleteId` (`{ not: null }`) e, espalhado por
   * cima, apagava a condição do atleta. A consulta passava a ser "uma ficha
   * qualquer paga pela família", e o atleta via a de outro. O teste
   * `test:ficha-de-socio-da-conta` guarda isto.
   */
  const doAtleta = await db.member.findFirst({ where: { AND: [{ athleteId: atleta.id }, FICHAS_PAGAS_PELA_FAMILIA] } });
  return doAtleta ? { ...doAtleta, pagoPelaFamilia: true } : null;
}
