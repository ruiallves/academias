import type { ScopedClient } from "../prisma/prisma.service";

/**
 * A fotografia de um sócio-atleta é uma só: a do atleta.
 *
 * ## Porquê
 *
 * Sócio (`Member.photoKey`) e atleta (`Athlete.photoKey`) guardavam cada um a
 * sua fotografia, e ligar as duas fichas (`Member.athleteId`) não mexia em
 * nenhuma. No FC Ferreirense, a 17/11/2026, 21 sócios-atletas tinham foto na
 * ficha de atleta e nenhuma na de sócio (a Olga Maria Lopes Ribeiro, n.º 759,
 * foi o exemplo que o clube mandou). Pedido do Rui: "a foto será sempre a
 * mesma entre perfis".
 *
 * ## A regra
 *
 * - **Ler:** num sócio ligado, vale a fotografia do atleta; a do sócio só
 *   aparece se o atleta não tiver nenhuma. É o que `chaveDaFotoDoSocio` faz,
 *   e todos os sítios que mostram a cara do sócio passam por ela (lista e
 *   ficha na consola, cartão lido na portaria, app do sócio).
 * - **Escrever:** num sócio ligado, carregar ou tirar a foto (na consola ou
 *   na app do sócio) muda a do atleta, e a coluna do sócio fica vazia. Ver
 *   `PhotosService`.
 * - **Ligar:** se o atleta não tem foto e o sócio tem, a do sócio passa para o
 *   atleta (`juntarFotoAoLigar`). Chamado em todos os sítios que ligam.
 *
 * Nenhum ficheiro fica com duas colunas a apontar para ele: apagar ou trocar
 * a foto nunca deixa a outra ficha a apontar para um ficheiro que já não
 * existe.
 */
export function chaveDaFotoDoSocio(m: {
  photoKey: string | null;
  athlete?: { photoKey: string | null } | null;
}): string | null {
  return m.athlete?.photoKey ?? m.photoKey ?? null;
}

/** Para pôr no `select` de um sócio, ao lado de `photoKey: true`. */
export const FOTO_DO_ATLETA_LIGADO = { select: { photoKey: true } } as const;

/**
 * Ao ligar um sócio a um atleta: se só o sócio tem fotografia, passa para o
 * atleta, e a coluna do sócio fica vazia (o ficheiro é o mesmo, só muda quem
 * aponta para ele). Se os dois têm, não se mexe em nada: vale a do atleta, e a
 * do sócio fica guardada sem aparecer, para não se apagar uma fotografia que o
 * clube carregou. Sem efeito num sócio por ligar.
 */
export async function juntarFotoAoLigar(db: ScopedClient, memberId: string): Promise<void> {
  const m = await db.member.findFirst({
    where: { id: memberId },
    select: { photoKey: true, athleteId: true, athlete: FOTO_DO_ATLETA_LIGADO },
  });
  if (!m?.athleteId || !m.photoKey || m.athlete?.photoKey) return;
  await db.athlete.update({ where: { id: m.athleteId }, data: { photoKey: m.photoKey } });
  await db.member.update({ where: { id: memberId }, data: { photoKey: null } });
}
