import type { Role, StaffDepartment } from "@prisma/client";
import { ROLE_RANK } from "../common/permissions";

/**
 * Uma pessoa, uma ficha de staff por clube.
 *
 * ## O caso que isto fecha
 *
 * A chave de `Membership` é (clube, pessoa, papel-base). Serve para a mesma
 * pessoa ser treinador **e** pai **e** sócio no mesmo clube: são áreas
 * diferentes da app, cada uma com o seu âmbito. Mas tratava também "direção" e
 * "treinador" como coisas diferentes, e são as duas staff.
 *
 * Santa Maria FC, 22/09/2026: o André foi convidado como Coordenador e, um
 * minuto depois, como Treinador. Aceitou os dois e ficou com duas fichas de
 * staff. A cada entrada a API escolhia uma delas pela ordem em que a base as
 * devolvia; a 19/10 a ordem trocou e ele passou a entrar como treinador, só com
 * a equipa dele, depois de semanas a ver o clube todo como coordenador. A
 * Juventude AC tinha o mesmo com a diretora, também treinadora de quatro
 * equipas.
 *
 * Para vários cargos a plataforma já tem o sítio certo: o cargo principal da
 * ficha (que dá o âmbito) e os secundários (`MembershipRole`, que somam
 * permissões e menus). Um segundo convite de staff passa a ir para lá.
 *
 * ## Quem fica principal
 *
 * O de maior alcance. O principal decide o âmbito: um coordenador que também
 * treina continua a ver o clube todo, porque é isso que coordenador quer dizer,
 * e não fica preso às equipas que treina (que entram na mesma, pelas equipas do
 * convite). Em empate fica o que já lá estava: aceitar um convite não deve mudar
 * o que a pessoa vê sem ganhar nada com isso.
 *
 * Puro de propósito, para se testar sem base de dados
 * (`npm run test:ficha-unica`).
 */

export type Cargo = {
  /** O `AcademyRole`, quando existe. Os convites antigos não o têm. */
  roleId: string | null;
  /** A patente do cargo: a do `AcademyRole`, ou a do papel-base sem ele. */
  rank: number;
  role: Role;
  title: string | null;
  department: StaffDepartment | null;
};

export type FichaDeStaff = { principal: Cargo; secundarios: string[] };

/** Os papéis que não são staff: cada um vive na sua ficha, à parte. */
export const PAPEIS_DE_FAMILIA: Role[] = ["GUARDIAN", "ATHLETE"];

export const patente = (roleId: string | null, rankDoCargo: number | null | undefined, role: Role) =>
  roleId && typeof rankDoCargo === "number" ? rankDoCargo : ROLE_RANK[role];

/** O cargo novo entra na ficha que já existe. Devolve o principal e os secundários que ficam. */
export function juntarCargo(atual: FichaDeStaff, novo: Cargo): FichaDeStaff {
  const sobe = novo.rank > atual.principal.rank;
  const principal = sobe ? novo : atual.principal;
  const todos = [...atual.secundarios, atual.principal.roleId, novo.roleId];
  const secundarios = [...new Set(todos)].filter((id): id is string => Boolean(id) && id !== principal.roleId);
  return { principal, secundarios };
}
