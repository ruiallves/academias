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
 * Pelo título: "Treinador principal" ganha a "Treinador adjunto" e a "Treinador
 * de GR". Sem isto, a escolha era a ordem alfabética do título — que dá o
 * adjunto antes do principal, e ninguém saberia porquê.
 *
 * ## Quem não treina não é treinador
 *
 * A regra aceitava "Delegado" como treinador à falta de melhor, e o que isso
 * dava na prática era uma **médica** a aparecer como treinadora de uma equipa
 * que só a tinha a ela na equipa técnica. O mesmo tipo de erro de que um clube
 * se queixou: um nome no sítio do treinador que não é quem treina. Um título que
 * não diga "treinador" (ou "técnico principal") não conta — e a equipa fica
 * "sem treinador", que é verdade e é um aviso que alguém resolve.
 *
 * ## E quem lê a equipa técnica de outro sítio usa a mesma regra
 *
 * `/api/teams` também diz quem é o treinador de cada equipa (`headCoach`), com
 * `escolherTreinador` e não com "o primeiro da lista". O primeiro da lista era o
 * que a app dos pais e a folha em PDF usavam, e a lista vem da base sem ordem
 * nenhuma — num clube, calhou ao treinador de guarda-redes.
 */

/**
 * O peso de um título na equipa técnica.
 *
 * `2` treinador principal (ou técnico principal), `1` outro treinador, `0` quem
 * não treina — delegado, médica, coordenador. "Delegado principal" é `0`: o
 * "principal" só promove quem já é treinador.
 */
export function pesoDoTitulo(titulo: string): number {
  const treina = /treinad|t[ée]cnic/i.test(titulo);
  if (!treina) return 0;
  return /principal/i.test(titulo) ? 2 : 1;
}

/**
 * De uma equipa técnica, quem é o treinador — ou `null` se ninguém lá treina.
 *
 * Em empate ganha o primeiro: quem chama passa as linhas numa ordem estável
 * (por título), para a mesma equipa dar sempre a mesma resposta.
 */
export function escolherTreinador<T extends { title: string }>(linhas: T[]): T | null {
  let melhor: T | null = null;
  let peso = 0;
  for (const l of linhas) {
    const k = pesoDoTitulo(l.title);
    if (k > peso) {
      melhor = l;
      peso = k;
    }
  }
  return melhor;
}

export async function headCoaches(db: ScopedClient, teamIds: (string | null)[]) {
  const ids = [...new Set(teamIds.filter((id): id is string => id !== null))];
  const found = new Map<string, { id: string; name: string }>();
  if (ids.length === 0) return found;

  const rows = await db.teamStaff.findMany({
    where: { teamId: { in: ids }, membership: { isActive: true } },
    orderBy: { title: "asc" },
    select: { teamId: true, title: true, membership: { select: { id: true, user: { select: { name: true } } } } },
  });

  const porEquipa = new Map<string, typeof rows>();
  for (const r of rows) porEquipa.set(r.teamId, [...(porEquipa.get(r.teamId) ?? []), r]);

  for (const [teamId, linhas] of porEquipa) {
    const t = escolherTreinador(linhas);
    if (t) found.set(teamId, { id: t.membership.id, name: t.membership.user.name });
  }
  return found;
}
