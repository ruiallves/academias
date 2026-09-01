import type { ScopedClient } from "../prisma/prisma.service";

/**
 * O treinador de cada equipa — o que um evento herda quando não tem o seu.
 *
 * ## Porque é que isto não é uma coluna
 *
 * Um treino e um jogo podem ter treinador próprio (`coachId`), e quase nunca
 * têm: quem marca o jogo no calendário não escolhe quem o dirige, porque isso já
 * está decidido na ficha da equipa. Guardar o nome no evento seria fotografar uma
 * decisão que muda — e um clube que atribuísse um treinador em Setembro ficava
 * com todos os jogos de Agosto a dizer "sem treinador" para sempre.
 *
 * Por isso deriva-se na leitura: o evento mostra o treinador que a equipa **tem
 * hoje**, e atribuir um treinador arruma o calendário inteiro de uma vez.
 *
 * ## Porque é que vive num ficheiro só
 *
 * Era um método privado do `AcademyService`, usado pelos treinos e pelos eventos
 * do calendário. Os **jogos** vivem noutro serviço e ficaram de fora — não por
 * decisão, por distância: a função não estava ao alcance de quem a devia chamar.
 * O resultado foi um calendário onde os treinos sabiam de quem eram e os jogos
 * não, e ninguém percebia porquê.
 *
 * ## Como se escolhe, quando há vários
 *
 * Pelo título: "Treinador principal" ganha a "Treinador adjunto", que ganha a
 * "Delegado". Sem isto, a escolha era a ordem alfabética do título — que dá o
 * adjunto antes do principal, e ninguém saberia porquê.
 */
export async function headCoaches(db: ScopedClient, teamIds: (string | null)[]) {
  const ids = [...new Set(teamIds.filter((id): id is string => id !== null))];
  const found = new Map<string, { id: string; name: string }>();
  if (ids.length === 0) return found;

  const rows = await db.teamStaff.findMany({
    where: { teamId: { in: ids }, membership: { isActive: true } },
    orderBy: { title: "asc" },
    select: { teamId: true, title: true, membership: { select: { id: true, user: { select: { name: true } } } } },
  });

  const rank = (title: string) => (/principal/i.test(title) ? 2 : /treinad/i.test(title) ? 1 : 0);
  const best = new Map<string, number>();
  for (const r of rows) {
    const k = rank(r.title);
    if (found.has(r.teamId) && k <= (best.get(r.teamId) ?? -1)) continue;
    best.set(r.teamId, k);
    found.set(r.teamId, { id: r.membership.id, name: r.membership.user.name });
  }
  return found;
}
