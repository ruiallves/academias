import { BadRequestException, ForbiddenException } from "@nestjs/common";
import type { ScopedClient } from "../prisma/prisma.service";
import type { EquipaDoAtletaDto } from "./athletes.dto";

/**
 * As equipas de um atleta — em quantas está, com que número e em que posição.
 *
 * ## Um atleta, várias equipas
 *
 * Um atleta pode praticar várias modalidades (futebol e futsal) ou jogar em dois
 * escalões da mesma (um Sub-13 que também joga nos Sub-14). Cada equipa é uma
 * passagem (`TeamMembership`) com o seu número e a sua posição: o 10 no futebol
 * pode ser o 7 no futsal.
 *
 * A **principal** é a passagem viva mais antiga. É a que aparece quando só cabe
 * uma equipa (a linha da lista, o título da ficha), e o número dela é o que fica
 * em `Athlete.squadNumber` para quem ainda lê essa coluna.
 *
 * ## Porque é que vive aqui
 *
 * A inscrição, a edição e a importação escrevem equipas, e as três têm de
 * aplicar as mesmas regras: o número não se repete dentro de uma equipa, a mesma
 * equipa não entra duas vezes, e ninguém mexe numa equipa fora do seu âmbito.
 */

export type Equipa = { teamId: string; squadNumber: number | null; position: string | null };

/** A ordem da principal: a passagem mais antiga primeiro. */
export const ORDEM_DAS_PASSAGENS = [{ joinedAt: "asc" as const }, { id: "asc" as const }];

/** O que o pedido traz, arrumado. Vazio de texto é nulo. */
export function normalizarEquipas(lista: EquipaDoAtletaDto[]): Equipa[] {
  return lista.map((e) => ({
    teamId: e.teamId,
    squadNumber: e.squadNumber ?? null,
    position: e.position?.trim() || null,
  }));
}

/**
 * As equipas de uma inscrição nova: a lista, ou a equipa só da forma antiga (e
 * da linha da importação). Pelo menos uma, e nenhuma repetida.
 */
export function equipasDaInscricao(dto: {
  equipas?: EquipaDoAtletaDto[];
  teamId?: string;
  squadNumber?: number;
  position?: string;
}): Equipa[] | { error: string } {
  const equipas = dto.equipas?.length
    ? normalizarEquipas(dto.equipas)
    : dto.teamId
      ? [{ teamId: dto.teamId, squadNumber: dto.squadNumber ?? null, position: dto.position?.trim() || null }]
      : [];
  if (equipas.length === 0) return { error: "Falta a equipa" };
  const repetida = equipasRepetidas(equipas);
  if (repetida) return { error: "A mesma equipa aparece duas vezes" };
  return equipas;
}

function equipasRepetidas(equipas: Equipa[]): boolean {
  return new Set(equipas.map((e) => e.teamId)).size !== equipas.length;
}

/**
 * O número já é de outro atleta nesta equipa?
 *
 * Só entre as passagens vivas: o 7 de quem saiu do Sub-13 no ano passado fica
 * livre. Devolve a frase a mostrar, ou nulo.
 */
export async function choqueDeNumeros(
  db: ScopedClient,
  athleteId: string | null,
  equipas: Equipa[],
  nomes: Map<string, string>,
): Promise<string | null> {
  for (const e of equipas) {
    if (e.squadNumber === null) continue;
    const outro = await db.teamMembership.findFirst({
      where: {
        teamId: e.teamId,
        squadNumber: e.squadNumber,
        leftAt: null,
        ...(athleteId ? { athleteId: { not: athleteId } } : {}),
      },
      select: { athlete: { select: { name: true } } },
    });
    if (outro) return `O número ${e.squadNumber} já é do ${outro.athlete.name} em ${nomes.get(e.teamId) ?? "essa equipa"}`;
  }
  return null;
}

/**
 * Pôr o atleta exactamente nestas equipas.
 *
 * - Uma equipa que sai da lista **sai**: a passagem fica com data de saída, que
 *   é o percurso ("por onde este miúdo já passou"), e não se apaga.
 * - Uma equipa nova ganha uma passagem nova.
 * - Nas que ficam, muda-se o número e a posição. Não é uma passagem nova: é a
 *   mesma equipa.
 *
 * Só se mexe no que está no âmbito de quem edita. Uma equipa fora dele pode vir
 * na lista (é do atleta, e o treinador do futsal vê-a), desde que fique como
 * estava — tirá-la, pô-la ou mudar-lhe o número é de quem a gere.
 *
 * Devolve os nomes das equipas antes e depois, para o histórico da ficha.
 */
export async function aplicarEquipas(
  db: ScopedClient,
  athleteId: string,
  desejadas: Equipa[],
  noAmbito: Map<string, string>,
): Promise<{ antes: string[]; depois: string[] }> {
  if (desejadas.length === 0) throw new BadRequestException("O atleta tem de ficar pelo menos numa equipa");
  if (equipasRepetidas(desejadas)) throw new BadRequestException("A mesma equipa aparece duas vezes");

  const vivas = await db.teamMembership.findMany({
    where: { athleteId, leftAt: null },
    select: { id: true, teamId: true, squadNumber: true, position: true, team: { select: { name: true } } },
    orderBy: ORDEM_DAS_PASSAGENS,
  });
  const porEquipa = new Map(vivas.map((v) => [v.teamId, v]));
  const querida = new Map(desejadas.map((d) => [d.teamId, d]));

  const foraDoAmbito = (teamId: string) => !noAmbito.has(teamId);

  const saem = vivas.filter((v) => !querida.has(v.teamId));
  const entram = desejadas.filter((d) => !porEquipa.has(d.teamId));
  const mudam = desejadas.filter((d) => {
    const v = porEquipa.get(d.teamId);
    return v && (v.squadNumber !== d.squadNumber || (v.position ?? null) !== d.position);
  });

  for (const e of [...saem.map((s) => s.teamId), ...entram.map((e) => e.teamId), ...mudam.map((m) => m.teamId)]) {
    if (foraDoAmbito(e)) throw new ForbiddenException("Há uma equipa fora do teu âmbito nesta alteração");
  }

  const nomes = new Map(noAmbito);
  for (const v of vivas) nomes.set(v.teamId, v.team.name);
  const choque = await choqueDeNumeros(db, athleteId, [...entram, ...mudam], nomes);
  if (choque) throw new BadRequestException(choque);

  const agora = new Date();
  for (const s of saem) {
    await db.teamMembership.update({ where: { id: s.id }, data: { leftAt: agora } });
  }
  for (const m of mudam) {
    await db.teamMembership.update({
      where: { id: porEquipa.get(m.teamId)!.id },
      data: { squadNumber: m.squadNumber, position: m.position },
    });
  }
  for (const e of entram) await entrarNaEquipa(db, athleteId, e, agora);

  await sincronizarNumeroPrincipal(db, athleteId);

  const depois = await db.teamMembership.findMany({
    where: { athleteId, leftAt: null },
    select: { team: { select: { name: true } } },
    orderBy: ORDEM_DAS_PASSAGENS,
  });
  return { antes: vivas.map((v) => v.team.name), depois: depois.map((d) => d.team.name) };
}

/**
 * O atleta entra numa equipa em que não está agora.
 *
 * Quem volta a uma equipa por onde já passou reutiliza a passagem antiga: o
 * índice único `teamId + athleteId` só deixa haver uma linha por equipa, e criar
 * outra rebentava. A linha reabre com a entrada de agora; a saída anterior
 * perde-se, que é o preço desse índice.
 */
export async function entrarNaEquipa(db: ScopedClient, athleteId: string, e: Equipa, quando = new Date()): Promise<void> {
  const antiga = await db.teamMembership.findFirst({ where: { teamId: e.teamId, athleteId }, select: { id: true } });
  if (antiga) {
    await db.teamMembership.update({
      where: { id: antiga.id },
      data: { leftAt: null, joinedAt: quando, squadNumber: e.squadNumber, position: e.position },
    });
  } else {
    await db.teamMembership.create({
      data: { teamId: e.teamId, athleteId, joinedAt: quando, squadNumber: e.squadNumber, position: e.position },
    });
  }
}

/**
 * `Athlete.squadNumber` passa a ser o número da equipa principal.
 *
 * A coluna ficou para quem ainda a lê (a app em produção até ao deploy, a
 * scouting). Sem isto, mudar o número no futebol deixava-a com o antigo.
 */
export async function sincronizarNumeroPrincipal(db: ScopedClient, athleteId: string): Promise<void> {
  const principal = await db.teamMembership.findFirst({
    where: { athleteId, leftAt: null },
    select: { squadNumber: true },
    orderBy: ORDEM_DAS_PASSAGENS,
  });
  await db.athlete.update({ where: { id: athleteId }, data: { squadNumber: principal?.squadNumber ?? null } });
}
