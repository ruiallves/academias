import type { ScopedClient } from "../prisma/prisma.service";

/**
 * As contas dos próprios atletas — quem avisar além dos encarregados.
 *
 * ## Porque é que isto existe
 *
 * Tudo o que avisava uma família ia por `GuardianLink`: convocatória, avaliação,
 * relatório, aviso do clube. Com a área de atleta, a mesma notícia tem mais um
 * destinatário — o próprio, quando tem conta. Em vez de cada serviço voltar a
 * escrever a consulta (e um deles se esquecer), fica aqui, ao lado da
 * definição da ligação (`Athlete.accountMembershipId`).
 *
 * "Viva" quer dizer `Membership.isActive`: uma conta desligada na ficha (ver
 * `AthleteInvitesService.desligarConta`) deixa de receber seja o que for.
 */

/** A conta do próprio atleta, quando existe e está viva. */
export async function contaDoAtleta(db: ScopedClient, athleteId: string): Promise<string | null> {
  const a = await db.athlete.findFirst({
    where: { id: athleteId },
    select: { account: { select: { userId: true, isActive: true } } },
  });
  return a?.account?.isActive ? a.account.userId : null;
}

/** As contas dos atletas destas equipas — uma pessoa uma vez, mesmo em duas equipas. */
export async function contasDasEquipas(db: ScopedClient, teamIds: string[]): Promise<string[]> {
  if (teamIds.length === 0) return [];
  const rows = await db.teamMembership.findMany({
    where: { teamId: { in: teamIds } },
    select: { athlete: { select: { account: { select: { userId: true, isActive: true } } } } },
  });
  return [...new Set(rows.flatMap((r) => (r.athlete.account?.isActive ? [r.athlete.account.userId] : [])))];
}
