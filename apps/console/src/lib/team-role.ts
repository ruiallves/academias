/**
 * O cargo de uma pessoa **dentro de uma equipa** — `TeamStaff.title`.
 *
 * Não confundir com o cargo na academia (`Membership.title`, "Diretor
 * desportivo"): uma pessoa é uma coisa no clube e pode ser outra em cada equipa
 * — principal nos sub-11, adjunto nos sub-13. É por isso que o título vive na
 * ligação e não na pessoa.
 *
 * Serve o calendário e as presenças: `headCoaches`, na API, lê daqui de quem é
 * o treino, e dá prioridade a quem tem "principal" no título. Daí a lista
 * começar por ele.
 */
export const TEAM_ROLES = [
  "Treinador principal",
  "Treinador adjunto",
  "Treinador de guarda-redes",
  "Preparador físico",
  "Fisioterapeuta",
  "Coordenador",
  "Delegado",
] as const;

/** A mesma regra do servidor, para o ecrã poder destacar quem manda na equipa. */
export const isHeadCoach = (title: string) => /principal/i.test(title);

/**
 * As opções a mostrar a quem edita.
 *
 * Os títulos são texto livre na base — entram por aqui, pelo convite e pela
 * criação da equipa — por isso o que já lá está entra na lista mesmo que não
 * seja um dos nossos. Um `select` que não sabe mostrar o valor actual mostraria
 * o primeiro da lista, e bastava tocar-lhe para despromover alguém sem querer.
 */
export function roleOptions(atual: string): string[] {
  const base = [...TEAM_ROLES] as string[];
  return base.some((r) => r.toLowerCase() === atual.trim().toLowerCase()) ? base : [atual, ...base];
}
